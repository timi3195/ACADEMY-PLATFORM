const { GoogleGenerativeAI } = require("@google/generative-ai");
const User = require("../models/User");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_PROMPT_LENGTH = 12000;
const MAX_OUTPUT_TOKENS = 800;
const FREE_DAILY_LIMIT = 5;
const FREE_MONTHLY_LIMIT = 100;
const PREMIUM_DAILY_LIMIT = 50;
const PREMIUM_MONTHLY_LIMIT = 1000;
const MIN_REQUEST_INTERVAL_MS = 10000;

const quotaError = (message, statusCode = 429) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const consumeQuota = async (userId, prompt = "") => {
  if (String(prompt).length > MAX_PROMPT_LENGTH) {
    throw quotaError(`AI prompt is too long. Maximum length is ${MAX_PROMPT_LENGTH} characters.`, 400);
  }

  const user = await User.findById(userId).select("role subscriptionType plan aiUsage");
  if (!user) throw quotaError("Authenticated user not found.", 401);

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const usage = user.aiUsage || {};
  const dailyRequests = usage.dailyRequestDate === day ? usage.dailyRequests || 0 : 0;
  const monthlyRequests = usage.monthlyRequestMonth === month ? usage.monthlyRequests || 0 : 0;
  const isPremium = user.role === "admin" || user.subscriptionType === "premium" || user.plan === "premium";
  const dailyLimit = isPremium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;
  const monthlyLimit = isPremium ? PREMIUM_MONTHLY_LIMIT : FREE_MONTHLY_LIMIT;

  if (usage.lastRequestAt && now.getTime() - new Date(usage.lastRequestAt).getTime() < MIN_REQUEST_INTERVAL_MS) {
    throw quotaError("Please wait a few seconds before sending another AI request.");
  }
  if (dailyRequests >= dailyLimit) {
    throw quotaError(`Daily AI limit reached (${dailyLimit} requests). Try again tomorrow.`);
  }
  if (monthlyRequests >= monthlyLimit) {
    throw quotaError(`Monthly AI limit reached (${monthlyLimit} requests).`);
  }

  user.aiUsage.dailyRequests = dailyRequests + 1;
  user.aiUsage.dailyRequestDate = day;
  user.aiUsage.monthlyRequests = monthlyRequests + 1;
  user.aiUsage.monthlyRequestMonth = month;
  user.aiUsage.messagesThisMonth = monthlyRequests + 1;
  user.aiUsage.lastRequestAt = now;
  await user.save({ validateBeforeSave: false });
};

const requestGemini = async (contents, systemInstruction, userId) => {
  if (!GEMINI_API_KEY) {
    const error = new Error("Gemini is not configured. Set GEMINI_API_KEY on the server.");
    error.statusCode = 503;
    throw error;
  }

  const prompt = `${systemInstruction}\n${contents.map((content) => content.parts?.map((part) => part.text || "").join(" ") || "").join("\n")}`;
  await consumeQuota(userId, prompt);

  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction
  });
  const result = await model.generateContent({
    contents,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
  });
  const response = result.response;
  const text = response.text()?.trim();
  if (!text) throw new Error("Gemini returned no study response");

  return {
    message: text,
    tokens: {
      input: response.usageMetadata?.promptTokenCount || 0,
      output: response.usageMetadata?.candidatesTokenCount || 0,
      total: response.usageMetadata?.totalTokenCount || 0
    },
    cost: 0
  };
};

const courseScope = (courseContext = {}) => {
  const sources = Array.isArray(courseContext.sources) ? courseContext.sources : [];
  const sourceText = sources.length
    ? sources.map((source) => `- ${source.type}: ${source.title}${source.description ? ` — ${source.description}` : ""}`).join("\n")
    : "No uploaded course material or past-question paper is available for this course.";

  return `Course: ${courseContext.courseName || "Unknown"} (${courseContext.courseCode || ""})
Department: ${courseContext.departmentName || "Unknown"}
Academic level: ${courseContext.academicLevel || "Unknown"}
Available database sources:
${sourceText}`;
};

const buildSystemInstruction = (courseContext) => `You are the Academy Platform study assistant powered by Google Gemini.
Only use facts from the supplied course context and database sources. If the requested answer is not present in those sources, say that the platform has no uploaded source for it and ask the student to provide or select an available course. Never invent access to a PDF, image, note, or past question that is not listed.
${courseScope(courseContext)}
Explain clearly for an ND/HND student. You may teach general concepts, but label them as general explanation rather than claiming they came from an uploaded source.`;

class GeminiService {
  async chatWithStudent(messages, courseContext, userId) {
    const contents = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
    return { success: true, ...(await requestGemini(contents, buildSystemInstruction(courseContext), userId)) };
  }

  async explainQuestion(question, correctAnswer, courseContext, userId) {
    const prompt = `Explain this past-question item using only the supplied context.\nQuestion: ${question.question}\nOptions: ${(question.options || []).join(" | ")}\nCorrect answer: ${correctAnswer}\nExisting explanation: ${question.explanation || "None"}`;
    const response = await requestGemini([{ role: "user", parts: [{ text: prompt }] }], buildSystemInstruction(courseContext), userId);
    return { success: true, explanation: { explanation: response.message, stepByStepSolution: [] }, tokens: response.tokens, cost: response.cost };
  }

  async enhanceNoteContent(noteText, courseName, courseCharacteristics, userId) {
    const response = await requestGemini([{ role: "user", parts: [{ text: `Summarize and organize these notes for ${courseName}.\n\n${noteText}` }] }], buildSystemInstruction({ courseName, ...courseCharacteristics }), userId);
    return { success: true, enhancements: { summary: response.message, keyPoints: [], flashcards: [] }, tokens: response.tokens.total, cost: response.cost };
  }

  async generateLearningPath(courseContext, userId) {
    const response = await requestGemini([{ role: "user", parts: [{ text: "Create a concise revision path from the available course sources." }] }], buildSystemInstruction(courseContext), userId);
    return {
      success: true,
      path: {
        title: `Revision path for ${courseContext.courseName || "this course"}`,
        description: response.message,
        steps: []
      },
      tokens: response.tokens,
      cost: response.cost
    };
  }

  getUsageStats() {
    return { provider: "gemini", model: GEMINI_MODEL, configured: Boolean(GEMINI_API_KEY) };
  }
}

module.exports = new GeminiService();
