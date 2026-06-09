import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import PremiumGate from '../components/PremiumGate'

// Mock data for demonstration
const SAMPLE_CONVERSATIONS = {
  demo1: [
    {
      role: 'student',
      content: 'What is a pointer in C?',
      timestamp: new Date(Date.now() - 3600000)
    },
    {
      role: 'tutor',
      content: `A pointer is a variable that stores the memory address of another variable. Here's what you need to know:

**Key Concepts:**
1. **Declaration**: A pointer is declared using the asterisk (*) symbol
   - Example: \`int *ptr;\`

2. **Address-of Operator (&)**: Gets the address of a variable
   - Example: \`ptr = &x;\`

3. **Dereference Operator (*)**: Accesses the value at the pointer address
   - Example: \`printf("%d", *ptr);\`

**Simple Example:**
\`\`\`c
int x = 10;
int *ptr = &x;  // ptr now holds address of x
printf("%d", *ptr);  // Output: 10
\`\`\`

**Why Use Pointers?**
- Dynamic memory allocation
- Creating complex data structures (linked lists, trees)
- Passing variables by reference
- Array manipulation`,
      timestamp: new Date(Date.now() - 3540000)
    },
    {
      role: 'student',
      content: 'Can you give me a practice question on this?',
      timestamp: new Date(Date.now() - 3480000)
    },
    {
      role: 'tutor',
      content: `**Practice Question: Pointer Fundamentals**

Given the following code:
\`\`\`c
int a = 5;
int *p = &a;
int **q = &p;
printf("%d", **q);
\`\`\`

**What will be the output?**
A) Error
B) Address of a
C) Address of p
D) 5

**Solution:** D) 5
- \`q\` is a pointer to pointer \`p\`
- \`*q\` gives us \`p\` (which holds address of \`a\`)
- \`**q\` gives us the value at that address, which is 5`,
      timestamp: new Date(Date.now() - 3400000)
    }
  ]
}

const SUGGESTED_PROMPTS = [
  {
    icon: '📚',
    text: 'Explain a complex concept',
    query: 'Can you explain [topic] in simple terms?'
  },
  {
    icon: '🧮',
    text: 'Step-by-step solution',
    query: 'Help me solve this problem step by step'
  },
  {
    icon: '❓',
    text: 'Practice questions',
    query: 'Generate 3 practice questions on [topic]'
  },
  {
    icon: '📝',
    text: 'Summarize topic',
    query: 'Summarize the key points of [topic]'
  },
  {
    icon: '🎯',
    text: 'Exam preparation',
    query: 'What are the most important concepts for my exam?'
  },
  {
    icon: '💡',
    text: 'Solve assignment',
    query: 'Help me understand this assignment question'
  },
  {
    icon: '🔍',
    text: 'Explain past question',
    query: 'Explain this past exam question'
  }
]

export default function AI() {
  const [question, setQuestion] = useState('')
  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [messages, setMessages] = useState(SAMPLE_CONVERSATIONS.demo1)
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [error, setError] = useState('')
  const [showSampleData, setShowSampleData] = useState(true)
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    const loadCourses = async () => {
      try {
        const res = await apiGet('/api/courses')
        setCourses(res.courses || [])
        if (res.courses?.length > 0) {
          setSelectedCourse(res.courses[0]._id)
        }
      } catch (err) {
        console.error('Failed to load courses', err)
      }
    }

    loadCourses()
  }, [])

  const sendMessage = async () => {
    if (!question.trim()) return
    if (!selectedCourse) {
      setError('Please select a course first')
      return
    }

    setShowSampleData(false)
    const userMessage = { role: 'student', content: question }
    setMessages(prev => [...prev, userMessage])
    setQuestion('')
    setLoading(true)
    setError('')

    try {
      const res = await apiPost('/api/ai/chat', {
        courseId: selectedCourse,
        message: question,
        conversationId: conversationId || undefined
      })

      if (!conversationId && res.conversation?._id) {
        setConversationId(res.conversation._id)
      }

      // Check if response is using mock data
      if (res.isMockData) {
        setDemoMode(true)
      }

      const assistantMessage = {
        role: 'tutor',
        content: res.message || res.response || 'I could not process your request. Please try again.',
        isMockData: res.isMockData
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (err) {
      console.error('AI request failed', err)
      const message = err?.response?.data?.message || err.message || 'Failed to get AI response'
      setError(message)
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const handleSuggestedPrompt = (query) => {
    setQuestion(query)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const startNewChat = () => {
    setMessages([])
    setConversationId(null)
    setQuestion('')
    setShowSampleData(true)
  }

  return (
    <PremiumGate fallback={
      <div className="page premium-required">
        <div className="premium-message">
          <h2>🤖 AI Study Assistant</h2>
          <p>Unlock personalized AI tutoring with a premium subscription</p>
          <p className="features">Get instant explanations, practice questions, exam prep, and more!</p>
        </div>
      </div>
    }>
      <div className="page ai-study-page">
        <div className="ai-header">
          <div>
            <h1>🤖 AI Study Assistant</h1>
            <p>Your personal tutor powered by advanced AI. Get explanations, practice questions, and exam prep.</p>
          </div>
          <button className="btn-new-chat" onClick={startNewChat}>
            ➕ New Chat
          </button>
        </div>

        {demoMode && (
          <div className="demo-mode-banner">
            <span className="banner-icon">⚠️</span>
            <div className="banner-content">
              <strong>Demo Mode Active</strong>
              <p>The OpenAI API quota has been exceeded. Showing demo responses. <a href="https://platform.openai.com/account/billing/overview" target="_blank" rel="noopener noreferrer">Click here to fix your billing</a></p>
            </div>
          </div>
        )}

        <div className="ai-container">
          <div className="ai-sidebar">
            <div className="course-selection">
              <label>📚 Select Course</label>
              <select
                value={selectedCourse}
                onChange={e => {
                  setSelectedCourse(e.target.value)
                  setMessages([])
                  setConversationId(null)
                  setShowSampleData(true)
                }}
                className="course-select"
              >
                <option value="">-- Choose a course --</option>
                {courses.map(course => (
                  <option key={course._id} value={course._id}>
                    {course.code}
                  </option>
                ))}
              </select>
            </div>

            {showSampleData && (
              <div className="suggested-prompts">
                <h3>💡 Quick Start</h3>
                <p className="prompt-subtitle">Click a topic or ask anything</p>
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="prompt-chip"
                    onClick={() => handleSuggestedPrompt(prompt.query)}
                  >
                    <span className="chip-icon">{prompt.icon}</span>
                    <span className="chip-text">{prompt.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ai-main">
            <div className="chat-display">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎓</div>
                  <h2>Welcome to AI Study Assistant</h2>
                  <p>Select a course above and ask me anything about your studies!</p>
                  <div className="capabilities">
                    <div className="capability">
                      <span className="cap-icon">📖</span>
                      <div>
                        <strong>Concept Explanation</strong>
                        <p>Understand complex topics easily</p>
                      </div>
                    </div>
                    <div className="capability">
                      <span className="cap-icon">✏️</span>
                      <div>
                        <strong>Practice Questions</strong>
                        <p>Test your knowledge with AI-generated problems</p>
                      </div>
                    </div>
                    <div className="capability">
                      <span className="cap-icon">📝</span>
                      <div>
                        <strong>Assignment Help</strong>
                        <p>Get guidance on your coursework</p>
                      </div>
                    </div>
                    <div className="capability">
                      <span className="cap-icon">🎯</span>
                      <div>
                        <strong>Exam Prep</strong>
                        <p>Focus on what matters for your exams</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map((msg, index) => (
                    <div
                      key={index}
                      className={`message ${msg.role}`}
                    >
                      <div className="message-avatar">
                        {msg.role === 'student' ? '👤' : '🤖'}
                      </div>
                      <div className="message-content">
                        <div className="message-header">
                          {msg.role === 'student' ? 'You' : 'AI Tutor'}
                        </div>
                        <div className="message-text">
                          {msg.content.split('\n').map((line, i) => (
                            <React.Fragment key={i}>
                              {line}
                              <br />
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="message tutor loading-message">
                      <div className="message-avatar">🤖</div>
                      <div className="message-content">
                        <div className="typing-indicator">
                          <span></span><span></span><span></span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="error-message">
                <span>❌ {error}</span>
                <button onClick={() => setError('')}>✕</button>
              </div>
            )}

            <div className="chat-input-area">
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything... (Shift+Enter for new line, Enter to send)"
                disabled={loading || !selectedCourse}
                className="chat-input"
                rows="3"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !selectedCourse}
                className="send-button"
              >
                {loading ? '⏳ Thinking...' : '📤 Send'}
              </button>
            </div>

            <div className="chat-footer">
              <small>💡 Pro tip: Use specific questions for better answers. "Explain X" works better than "What is X"</small>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .ai-study-page {
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 1.5rem;
        }

        .ai-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 2rem;
        }

        .ai-header h1 {
          font-size: 2rem;
          margin: 0;
          color: #1a1a1a;
        }

        .ai-header p {
          margin: 0.5rem 0 0 0;
          color: #666;
          font-size: 0.95rem;
        }

        .btn-new-chat {
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          white-space: nowrap;
        }

        .btn-new-chat:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(102, 126, 234, 0.4);
        }

        .ai-container {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 1.5rem;
          flex: 1;
          min-height: 600px;
        }

        .ai-sidebar {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .course-selection {
          background: white;
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid #e0e0e0;
        }

        .course-selection label {
          display: block;
          font-weight: 600;
          margin-bottom: 0.75rem;
          color: #333;
          font-size: 0.9rem;
        }

        .course-select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .suggested-prompts {
          background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          padding: 1.2rem;
          border-radius: 12px;
          border: 1px solid #667eea30;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }

        .suggested-prompts h3 {
          margin: 0;
          font-size: 1rem;
          color: #333;
        }

        .prompt-subtitle {
          margin: 0;
          font-size: 0.8rem;
          color: #999;
        }

        .prompt-chip {
          background: white;
          border: 1px solid #ddd;
          padding: 0.8rem 1rem;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.85rem;
          transition: all 0.2s ease;
          text-align: left;
        }

        .prompt-chip:hover {
          background: #f0f0ff;
          border-color: #667eea;
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
        }

        .chip-icon {
          font-size: 1.2rem;
        }

        .chip-text {
          font-weight: 500;
          color: #333;
        }

        .ai-main {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          background: white;
          border-radius: 12px;
          border: 1px solid #e0e0e0;
          overflow: hidden;
        }

        .chat-display {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          background: linear-gradient(to bottom, #fafafa, #fff);
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 2rem;
          height: 100%;
        }

        .empty-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .empty-state h2 {
          margin: 0 0 0.5rem 0;
          color: #333;
        }

        .empty-state p {
          margin: 0 0 1.5rem 0;
          color: #666;
        }

        .capabilities {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          text-align: left;
        }

        .capability {
          background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          padding: 1rem;
          border-radius: 8px;
          display: flex;
          gap: 0.75rem;
        }

        .cap-icon {
          font-size: 1.5rem;
        }

        .capability strong {
          display: block;
          color: #333;
          margin-bottom: 0.25rem;
          font-size: 0.9rem;
        }

        .capability p {
          margin: 0;
          color: #666;
          font-size: 0.8rem;
        }

        .messages-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .message {
          display: flex;
          gap: 0.75rem;
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message.student {
          justify-content: flex-end;
        }

        .message-avatar {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .message-content {
          max-width: 70%;
          padding: 0.75rem 1rem;
          border-radius: 12px;
          word-break: break-word;
        }

        .message.tutor .message-content {
          background: #f0f0f0;
          color: #333;
        }

        .message.student .message-content {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .message-header {
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
          opacity: 0.8;
        }

        .message-text {
          font-size: 0.95rem;
          line-height: 1.4;
          white-space: pre-wrap;
        }

        .loading-message .message-content {
          padding: 0.75rem 1rem;
        }

        .typing-indicator {
          display: flex;
          gap: 0.3rem;
        }

        .typing-indicator span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #999;
          animation: typing 1.4s infinite;
        }

        .typing-indicator span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .typing-indicator span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes typing {
          0%, 60%, 100% { opacity: 0.5; }
          30% { opacity: 1; }
        }

        .error-message {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #fee;
          border: 1px solid #fcc;
          color: #c33;
          padding: 1rem;
          border-radius: 8px;
          margin: 0 1.5rem;
        }

        .error-message button {
          background: none;
          border: none;
          color: #c33;
          cursor: pointer;
          font-size: 1.2rem;
        }

        .demo-mode-banner {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
          background: linear-gradient(135deg, #fef3c7 0%, #fef08a 100%);
          border: 2px solid #fcd34d;
          border-radius: 8px;
          padding: 1rem 1.5rem;
          margin: 1rem;
          animation: slideDown 0.3s ease;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .demo-mode-banner .banner-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
        }

        .demo-mode-banner .banner-content {
          flex: 1;
        }

        .demo-mode-banner .banner-content strong {
          display: block;
          color: #92400e;
          font-size: 0.95rem;
          margin-bottom: 0.25rem;
        }

        .demo-mode-banner .banner-content p {
          margin: 0;
          color: #78350f;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .demo-mode-banner a {
          color: #d97706;
          text-decoration: underline;
          font-weight: 600;
        }

        .demo-mode-banner a:hover {
          color: #b45309;
        }

        .chat-input-area {
          display: flex;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-top: 1px solid #e0e0e0;
          background: white;
        }

        .chat-input {
          flex: 1;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-family: inherit;
          font-size: 0.95rem;
          resize: none;
        }

        .chat-input:disabled {
          background: #f5f5f5;
          cursor: not-allowed;
        }

        .send-button {
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          white-space: nowrap;
        }

        .send-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .send-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .chat-footer {
          text-align: center;
          color: #999;
          font-size: 0.85rem;
          padding: 0 1.5rem 0.5rem 1.5rem;
        }

        @media (max-width: 768px) {
          .ai-container {
            grid-template-columns: 1fr;
          }

          .capabilities {
            grid-template-columns: 1fr;
          }

          .message-content {
            max-width: 85%;
          }
        }
      `}</style>
    </PremiumGate>
  )
}
