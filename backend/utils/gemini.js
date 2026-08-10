const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const requestGemini = async (contents, systemInstruction) => {
  if (!GEMINI_API_KEY) {
    const error = new Error("Gemini is not configured. Set GEMINI_API_KEY on the server.");
    error.statusCode = 503;
    throw error;
  }

  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction
  });
  const result = await model.generateContent({ contents });
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
  async chatWithStudent(messages, courseContext) {
    const contents = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
    return { success: true, ...(await requestGemini(contents, buildSystemInstruction(courseContext))) };
  }

  async explainQuestion(question, correctAnswer, courseContext) {
    const prompt = `Explain this past-question item using only the supplied context.\nQuestion: ${question.question}\nOptions: ${(question.options || []).join(" | ")}\nCorrect answer: ${correctAnswer}\nExisting explanation: ${question.explanation || "None"}`;
    const response = await requestGemini([{ role: "user", parts: [{ text: prompt }] }], buildSystemInstruction(courseContext));
    return { success: true, explanation: { explanation: response.message, stepByStepSolution: [] }, tokens: response.tokens, cost: response.cost };
  }

  async enhanceNoteContent(noteText, courseName, courseCharacteristics) {
    const response = await requestGemini([{ role: "user", parts: [{ text: `Summarize and organize these notes for ${courseName}.\n\n${noteText}` }] }], buildSystemInstruction({ courseName, ...courseCharacteristics }));
    return { success: true, enhancements: { summary: response.message, keyPoints: [], flashcards: [] }, tokens: response.tokens.total, cost: response.cost };
  }

  async generateLearningPath(courseContext) {
    const response = await requestGemini([{ role: "user", parts: [{ text: "Create a concise revision path from the available course sources." }] }], buildSystemInstruction(courseContext));
    return { success: true, path: response.message, tokens: response.tokens, cost: response.cost };
  }

  getUsageStats() {
    return { provider: "gemini", model: GEMINI_MODEL, configured: Boolean(GEMINI_API_KEY) };
  }
}

module.exports = new GeminiService();
