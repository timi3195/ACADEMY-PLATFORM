const { OpenAI } = require("openai");

/**
 * OpenAI Integration Service
 * Handles all AI interactions with cost tracking and error handling
 */

class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Pricing as of June 2024 (adjust as needed)
    this.pricing = {
      "gpt-4": {
        input: 0.03 / 1000,    // $0.03 per 1K input tokens
        output: 0.06 / 1000    // $0.06 per 1K output tokens
      },
      "gpt-3.5-turbo": {
        input: 0.0005 / 1000,  // $0.0005 per 1K input tokens
        output: 0.0015 / 1000  // $0.0015 per 1K output tokens
      }
    };

    this.tokenUsage = {
      total: 0,
      totalCost: 0,
      byModel: {}
    };
  }

  /**
   * Chat completion for AI Study Assistant
   */
  async chatWithStudent(messages, courseContext, modelChoice = "gpt-3.5-turbo") {
    try {
      // Build system prompt with course context
      const systemPrompt = this._buildStudyAssistantPrompt(courseContext);

      const response = await this.client.chat.completions.create({
        model: modelChoice,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 1500,
        top_p: 0.9
      });

      const usage = response.usage;
      this._trackUsage(modelChoice, usage);

      return {
        success: true,
        message: response.choices[0].message.content,
        tokens: {
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          total: usage.total_tokens
        },
        cost: this._calculateCost(modelChoice, usage)
      };
    } catch (error) {
      console.error("OpenAI chat error:", error);
      throw new Error(`AI chat failed: ${error.message}`);
    }
  }

  /**
   * Process and enhance lecture notes
   */
  async enhanceNoteContent(noteText, courseName, courseCharacteristics) {
    try {
      const systemPrompt = this._buildNoteEnhancerPrompt(courseCharacteristics);

      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Process and enhance these lecture notes for ${courseName}:\n\n${noteText}`
          }
        ],
        temperature: 0.5,
        max_tokens: 3000
      });

      const usage = response.usage;
      this._trackUsage("gpt-3.5-turbo", usage);

      try {
        const jsonResponse = JSON.parse(response.choices[0].message.content);
        return {
          success: true,
          enhancements: jsonResponse,
          tokens: usage.total_tokens,
          cost: this._calculateCost("gpt-3.5-turbo", usage)
        };
      } catch (parseError) {
        console.warn("Could not parse JSON response, returning as text");
        return {
          success: true,
          enhancements: {
            summary: response.choices[0].message.content,
            keyPoints: [],
            mindMap: {},
            flashcards: [],
            knowledgeGaps: [],
            examFocus: ""
          },
          tokens: usage.total_tokens,
          cost: this._calculateCost("gpt-3.5-turbo", usage)
        };
      }
    } catch (error) {
      console.error("Note enhancement error:", error);
      throw new Error(`Note enhancement failed: ${error.message}`);
    }
  }

  /**
   * Generate detailed explanation for a past question
   */
  async explainQuestion(question, correctAnswer, courseContext) {
    try {
      const systemPrompt = this._buildQuestionExplainerPrompt();

      const questionText = `
Question: ${question.question}
Options:
A) ${question.options[0]}
B) ${question.options[1]}
${question.options[2] ? `C) ${question.options[2]}` : ""}
${question.options[3] ? `D) ${question.options[3]}` : ""}

Correct Answer: ${correctAnswer}
${question.explanation ? `Context: ${question.explanation}` : ""}
`;

      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: questionText
          }
        ],
        temperature: 0.5,
        max_tokens: 2000
      });

      const usage = response.usage;
      this._trackUsage("gpt-3.5-turbo", usage);

      try {
        const jsonResponse = JSON.parse(response.choices[0].message.content);
        return {
          success: true,
          explanation: jsonResponse,
          tokens: usage.total_tokens,
          cost: this._calculateCost("gpt-3.5-turbo", usage)
        };
      } catch (parseError) {
        return {
          success: true,
          explanation: {
            explanation: response.choices[0].message.content,
            stepByStepSolution: [],
            alternativeSolutions: [],
            commonMistakes: [],
            similarQuestions: []
          },
          tokens: usage.total_tokens,
          cost: this._calculateCost("gpt-3.5-turbo", usage)
        };
      }
    } catch (error) {
      console.error("Question explanation error:", error);
      throw new Error(`Question explanation failed: ${error.message}`);
    }
  }

  /**
   * Generate personalized learning path
   */
  async generateLearningPath(studentPerformance, courseName, examDate, studyHours) {
    try {
      const systemPrompt = `You are an expert personalized learning path generator for Nigerian university students.

Generate a structured 7-day learning path based on:
- Current performance weaknesses: ${JSON.stringify(studentPerformance.areasToImprove)}
- Strengths to maintain: ${JSON.stringify(studentPerformance.topStrengths)}
- Exam in: ${examDate}
- Available study hours: ${studyHours}/day

Return ONLY valid JSON with this structure:
{
  "title": "X-Day Learning Path",
  "schedule": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "activities": [
        {
          "type": "chat-ai|practice-questions|take-mini-test|read-notes",
          "title": "Activity Title",
          "description": "What to do",
          "topic": "Topic Name",
          "duration": 30,
          "difficulty": "easy|medium|hard"
        }
      ],
      "summary": "Day summary"
    }
  ]
}`;

      const response = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Generate learning path for ${courseName}`
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      });

      const usage = response.usage;
      this._trackUsage("gpt-3.5-turbo", usage);

      try {
        const jsonResponse = JSON.parse(response.choices[0].message.content);
        return {
          success: true,
          path: jsonResponse,
          tokens: usage.total_tokens,
          cost: this._calculateCost("gpt-3.5-turbo", usage)
        };
      } catch (parseError) {
        throw new Error("Failed to parse learning path JSON");
      }
    } catch (error) {
      console.error("Learning path generation error:", error);
      throw new Error(`Learning path generation failed: ${error.message}`);
    }
  }

  /**
   * Build system prompt for study assistant
   */
  _buildStudyAssistantPrompt(courseContext) {
    return `You are an expert academic tutor helping Nigerian university students master their courses.

CONTEXT:
- Course: ${courseContext.courseName} (${courseContext.courseCode})
- Department: ${courseContext.departmentName}
- Student Level: ${courseContext.academicLevel}
- Current Topics Mastery: ${JSON.stringify(courseContext.topicsMastery)}

YOUR ROLE:
You explain complex concepts in simple, clear language. You:
1. Break down topics into digestible chunks
2. Provide real-world Nigerian examples (e.g., economics policies, tech market)
3. Link new concepts to what the student already knows
4. Use step-by-step explanations for problem-solving
5. Anticipate common misconceptions
6. Always relate explanations back to exam preparation

TEACHING STYLE:
- Start with the "why" before the "what"
- Use analogies and visual descriptions
- Include worked examples
- Ask clarifying questions if needed
- Keep responses concise but thorough
- Use simple vocabulary; explain jargon

EXAM FOCUS:
- Prioritize topics that appear frequently in past exams
- Mention exam-relevant details
- Point out common exam traps
- Suggest practice questions

TONE:
- Encouraging and supportive
- Patient and non-judgmental
- Professional but approachable

DO NOT:
- Provide direct exam answers without explanation
- Generate plagiarism-prone content
- Go off-topic
- Use unnecessarily complex language

ALWAYS END WITH:
- Summary of key points
- A suggestion for the next topic to study
- An invitation for follow-up questions`;
  }

  /**
   * Build system prompt for note enhancer
   */
  _buildNoteEnhancerPrompt(courseCharacteristics) {
    return `You are an expert academic content processor. Your job is to take raw lecture notes and transform them into study-ready materials.

TASK: Process the lecture notes and provide ONLY valid JSON with this structure:
{
  "summary": "2-3 paragraph summary of main concepts",
  "keyPoints": ["point1", "point2", "point3", "..."],
  "mindMap": {
    "Central Topic": {
      "Branch 1": ["sub1", "sub2"],
      "Branch 2": ["sub1", "sub2"]
    }
  },
  "flashcards": [
    {
      "question": "What is X?",
      "answer": "Brief answer (1-2 sentences)",
      "difficulty": "easy"
    }
  ],
  "knowledgeGaps": ["topic1", "topic2"],
  "examFocus": "Critical concepts and formulas to memorize"
}

Course is: ${courseCharacteristics.isMathHeavy ? "Math-heavy" : "Non-math"}
Requires code examples: ${courseCharacteristics.requiresCodeExamples}
Exam format: ${courseCharacteristics.examFormat}

Return ONLY valid JSON. No other text.`;
  }

  /**
   * Build system prompt for question explainer
   */
  _buildQuestionExplainerPrompt() {
    return `You are an expert exam question analyst for Nigerian university students. Your job is to deeply explain past exam questions.

Return ONLY valid JSON with this structure:
{
  "explanation": "Clear explanation of why this question is asked and why the answer is correct",
  "stepByStepSolution": [
    {
      "step": 1,
      "description": "First step description",
      "formula": "Any formulas used"
    }
  ],
  "alternativeSolutions": ["Alternative approach 1", "Alternative approach 2"],
  "commonMistakes": ["Mistake 1", "Mistake 2"],
  "similarQuestions": [
    {
      "question": "Similar question text",
      "options": ["A", "B", "C", "D"],
      "answer": "B",
      "difficulty": "medium"
    }
  ]
}

Return ONLY valid JSON. No other text.`;
  }

  /**
   * Track token usage for billing and monitoring
   */
  _trackUsage(model, usage) {
    if (!this.tokenUsage.byModel[model]) {
      this.tokenUsage.byModel[model] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0
      };
    }

    this.tokenUsage.byModel[model].inputTokens += usage.prompt_tokens;
    this.tokenUsage.byModel[model].outputTokens += usage.completion_tokens;
    this.tokenUsage.byModel[model].totalTokens += usage.total_tokens;

    const cost = this._calculateCost(model, usage);
    this.tokenUsage.byModel[model].cost += cost;

    this.tokenUsage.total += usage.total_tokens;
    this.tokenUsage.totalCost += cost;

    console.log(
      `[OpenAI] Model: ${model} | Tokens: ${usage.total_tokens} | Cost: $${cost.toFixed(4)}`
    );
  }

  /**
   * Calculate API cost
   */
  _calculateCost(model, usage) {
    const rates = this.pricing[model] || this.pricing["gpt-3.5-turbo"];
    const inputCost = usage.prompt_tokens * rates.input;
    const outputCost = usage.completion_tokens * rates.output;
    return inputCost + outputCost;
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      ...this.tokenUsage,
      totalCostFormatted: `$${this.tokenUsage.totalCost.toFixed(4)}`
    };
  }

  /**
   * Reset usage stats (useful for monthly tracking)
   */
  resetUsageStats() {
    this.tokenUsage = {
      total: 0,
      totalCost: 0,
      byModel: {}
    };
  }
}

// Export singleton instance
module.exports = new OpenAIService();
