import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import PremiumGate from '../components/PremiumGate'

export default function AI() {
  const [topic, setTopic] = useState('')
  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadCourses = async () => {
      try {
        const res = await apiGet('/api/courses')
        setCourses(res.courses || [])
      } catch (err) {
        console.error('Failed to load courses', err)
      }
    }

    loadCourses()
  }, [])

  const ask = async () => {
    if (!topic) return alert('Enter a topic or question')
    const userMessage = { role: 'user', text: topic, course: selectedCourse }
    setLoading(true)

    try {
      const res = await apiPost('/api/ai/generate-questions', { topic, courseId: selectedCourse || undefined })
      const reply = {
        role: 'assistant',
        text: `Here are some AI-generated practice items for "${topic}":`,
        questions: res.questions || [],
        analysis: res.analysis || ''
      }
      setMessages(prev => [...prev, userMessage, reply])
      setTopic('')
    } catch (err) {
      console.error('AI request failed', err)
      const message = err?.body?.message || err.message || 'Failed to get AI response'
      alert(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <PremiumGate fallback={<p>Please upgrade your account to use the AI tutor.</p>}>
      <div className="page">
        <h2>AI Tutor</h2>
        <div className="card">
          <label>Course context (optional)</label>
          <select value={selectedCourse} onChange={e => setSelectedCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map(course => (
              <option key={course._id} value={course._id}>{course.title} ({course.code})</option>
            ))}
          </select>
          <label>Ask the AI tutor</label>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Ask about a topic or exam prep" />
          <button onClick={ask} disabled={loading}>{loading ? 'Thinking...' : 'Send to AI'}</button>
        </div>

        <div className="card">
          <h3>Chat</h3>
          {messages.length === 0 ? (
            <p>Ask a question to start the AI tutor.</p>
          ) : (
            <div className="chat-box">
              {messages.map((message, index) => (
                <div key={index} className={`chat-message ${message.role}`}>
                  <strong>{message.role === 'assistant' ? 'Tutor' : 'You'}:</strong>
                  <p>{message.text}</p>
                  {message.analysis && (
                    <p className="text-sm text-gray-600 mt-2">{message.analysis}</p>
                  )}
                  {message.questions && (
                    <div className="question-list">
                      {message.questions.map((item, qIndex) => (
                        <div key={qIndex} className="question">
                          <p><strong>{qIndex + 1}. {item.question}</strong></p>
                          {item.options && item.options.length > 0 && (
                            <div className="options">
                              {item.options.map((option, i) => (
                                <div key={i} className="option">{option}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PremiumGate>
  )
}
