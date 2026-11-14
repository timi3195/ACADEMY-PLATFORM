import React, { useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import {
  generateLearningPath,
  getLearningPath,
  updateLearningPathProgress
} from '../services/aiLearningPathService'

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

export const formatLearningPathDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      })
}

export const getChatConversationId = (response, currentId = null) =>
  response?.conversationId || currentId

export const buildChatRequest = ({ courseId, message, conversationId }) => ({
  courseId,
  message,
  conversationId: conversationId || undefined
})

export default function AI() {
  const [question, setQuestion] = useState('')
  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [courseLoadError, setCourseLoadError] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [error, setError] = useState('')
  const [learningPath, setLearningPath] = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathGenerating, setPathGenerating] = useState(false)
  const [pendingActivity, setPendingActivity] = useState('')
  const [pathError, setPathError] = useState('')
  const [pathLoadFailed, setPathLoadFailed] = useState(false)
  const [targetExamDate, setTargetExamDate] = useState('')
  const [studyHoursPerDay, setStudyHoursPerDay] = useState('2')
  const [pathReloadKey, setPathReloadKey] = useState(0)
  const pendingActivityRef = useRef(false)

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
        setCourseLoadError('Unable to load your courses. Please refresh the page and try again.')
      } finally {
        setCoursesLoading(false)
      }
    }

    loadCourses()
  }, [])

  useEffect(() => {
    let active = true
    setLearningPath(null)
    setPathError('')
    setPathLoadFailed(false)

    if (!selectedCourse) {
      setPathLoading(false)
      return () => {
        active = false
      }
    }

    setPathLoading(true)
    getLearningPath(selectedCourse)
      .then((response) => {
        if (active) setLearningPath(response.path || null)
      })
      .catch((err) => {
        if (!active) return
        if (err.status === 404) {
          setLearningPath(null)
          return
        }
        setPathLoadFailed(true)
        setPathError(err.message || 'Unable to load your saved Learning Path.')
      })
      .finally(() => {
        if (active) setPathLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedCourse, pathReloadKey])

  const handleGenerateLearningPath = async () => {
    const hours = Number(studyHoursPerDay)
    if (!selectedCourse) {
      setPathError('Select a course before generating a Learning Path.')
      return
    }
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 12) {
      setPathError('Daily study hours must be between 0.25 and 12.')
      return
    }

    setPathError('')
    setPathLoadFailed(false)
    setPathGenerating(true)
    try {
      const response = await generateLearningPath({
        courseId: selectedCourse,
        targetExamDate: targetExamDate || undefined,
        studyHoursPerDay: hours
      })
      if (!response.path) {
        throw new Error('The server did not return a Learning Path. Please try again.')
      }
      setLearningPath(response.path)
    } catch (err) {
      setPathError(err.status === 403
        ? 'Learning Path generation requires premium access. Upgrade your plan to generate a study timetable.'
        : err.message || 'Unable to generate your Learning Path. Please try again.')
    } finally {
      setPathGenerating(false)
    }
  }

  const handleActivityCompletion = async (dayIndex, activityIndex, completed) => {
    if (pendingActivityRef.current || !learningPath) return

    const activityKey = `${dayIndex}-${activityIndex}`
    const previousPath = learningPath
    const completedAt = completed ? new Date().toISOString() : null
    const optimisticPath = {
      ...previousPath,
      schedule: previousPath.schedule.map((day, currentDayIndex) => (
        currentDayIndex !== dayIndex
          ? day
          : {
              ...day,
              activities: day.activities.map((activity, currentActivityIndex) => (
                currentActivityIndex !== activityIndex
                  ? activity
                  : { ...activity, completed, completedAt }
              ))
            }
      ))
    }

    pendingActivityRef.current = true
    setPendingActivity(activityKey)
    setPathError('')
    setPathLoadFailed(false)
    setLearningPath(optimisticPath)
    try {
      const response = await updateLearningPathProgress(previousPath._id, {
        dayIndex,
        activityIndex,
        completed
      })
      if (!response.path) {
        throw new Error('The server did not confirm the saved progress. Please try again.')
      }
      setLearningPath(response.path)
    } catch (err) {
      setLearningPath(previousPath)
      setPathError(err.message || 'Unable to update activity progress. Please try again.')
    } finally {
      pendingActivityRef.current = false
      setPendingActivity('')
    }
  }

  const handleCourseChange = (courseId) => {
    setSelectedCourse(courseId)
    setMessages([])
    setConversationId(null)
    setQuestion('')
    setError('')
  }

  const sendMessage = async () => {
    if (!question.trim()) return
    if (!selectedCourse) {
      setError('Please select a course first')
      return
    }

    const userMessage = { role: 'student', content: question }
    setMessages(prev => [...prev, userMessage])
    setQuestion('')
    setLoading(true)
    setError('')

    try {
      const res = await apiPost('/api/ai/chat', buildChatRequest({
        courseId: selectedCourse,
        message: question,
        conversationId
      }))

      const updatedConversationId = getChatConversationId(res, conversationId)
      if (updatedConversationId) {
        setConversationId(updatedConversationId)
      }

      const assistantMessage = {
        role: 'tutor',
        content: res.message || res.response || 'I could not process your request. Please try again.'
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
  }

  const schedule = Array.isArray(learningPath?.schedule) ? learningPath.schedule : []
  const totalActivities = schedule.reduce(
    (total, day) => total + (Array.isArray(day?.activities) ? day.activities.length : 0),
    0
  )
  const completedActivities = schedule.reduce(
    (total, day) => total + (Array.isArray(day?.activities)
      ? day.activities.filter(activity => activity?.completed === true).length
      : 0),
    0
  )
  const pathControlsDisabled = pathLoading || pathGenerating || Boolean(pendingActivity)
  const pathActionPending = pathGenerating || Boolean(pendingActivity)

  return (
    <>
      <div className="page ai-study-page">
        <div className="ai-header">
          <div>
            <h1>🤖 AI Study Assistant</h1>
            <p>Your personal tutor powered by advanced AI. Get explanations, practice questions, and exam prep.</p>
            <p className="ai-personalization-note">
              Guidance can use your completed CBT results for the selected course. Without completed attempts, you can still ask ordinary study questions.
            </p>
          </div>
          <button className="btn-new-chat" onClick={startNewChat}>
            ➕ New Chat
          </button>
        </div>

        <section className="learning-path-section" aria-labelledby="learning-path-heading">
          <div className="learning-path-section-heading">
            <div>
              <h2 id="learning-path-heading">📅 Learning Path</h2>
              <p>Build a personalized study timetable and track your completed activities.</p>
            </div>
          </div>

          <div className="learning-path-controls">
            <div className="learning-path-field">
              <label htmlFor="learning-path-course">Course</label>
              <select
                id="learning-path-course"
                value={selectedCourse}
                onChange={event => handleCourseChange(event.target.value)}
                disabled={coursesLoading || loading || pathActionPending}
              >
                <option value="">-- Choose a course --</option>
                {courses.map(course => (
                  <option key={course._id} value={course._id}>
                    {course.code}{course.title ? ` — ${course.title}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="learning-path-field">
              <label htmlFor="learning-path-exam-date">Target exam date (optional)</label>
              <input
                id="learning-path-exam-date"
                type="date"
                value={targetExamDate}
                onChange={event => setTargetExamDate(event.target.value)}
                disabled={pathControlsDisabled}
              />
            </div>
            <div className="learning-path-field">
              <label htmlFor="learning-path-study-hours">Daily study hours</label>
              <input
                id="learning-path-study-hours"
                type="number"
                min="0.25"
                max="12"
                step="0.25"
                value={studyHoursPerDay}
                onChange={event => setStudyHoursPerDay(event.target.value)}
                disabled={pathControlsDisabled}
              />
            </div>
            <button
              type="button"
              className="learning-path-generate"
              onClick={handleGenerateLearningPath}
              disabled={!selectedCourse || coursesLoading || pathControlsDisabled}
            >
              {pathGenerating ? 'Generating...' : 'Generate Learning Path'}
            </button>
          </div>

          {courseLoadError && <p className="learning-path-error" role="alert">{courseLoadError}</p>}
          {pathError && (
            <div className="learning-path-error" role="alert">
              <span>{pathError}</span>
              {pathLoadFailed && (
                <button type="button" onClick={() => setPathReloadKey(key => key + 1)}>
                  Retry loading
                </button>
              )}
            </div>
          )}

          {coursesLoading && <p className="learning-path-status" role="status">Loading your courses...</p>}
          {!coursesLoading && !selectedCourse && !courseLoadError && (
            <p className="learning-path-empty">Select a course to view or generate a Learning Path.</p>
          )}
          {selectedCourse && pathLoading && (
            <p className="learning-path-status" role="status">Loading your saved Learning Path...</p>
          )}
          {selectedCourse && !pathLoading && !learningPath && !pathError && (
            <p className="learning-path-empty">
              No saved Learning Path for this course yet. Choose your study preferences and generate one.
            </p>
          )}

          {learningPath && !pathLoading && (
            <div className="learning-path-results">
              <div className="learning-path-overview">
                <div>
                  <h3>{learningPath.title}</h3>
                  {learningPath.targetExamDate && (
                    <p>Target exam date: {formatLearningPathDate(learningPath.targetExamDate)}</p>
                  )}
                  <p>{schedule.length} study {schedule.length === 1 ? 'day' : 'days'}</p>
                </div>
                <div className="learning-path-progress">
                  <span>
                    Progress: {completedActivities} / {totalActivities} activities completed
                  </span>
                  {totalActivities > 0 ? (
                    <progress
                      value={completedActivities}
                      max={totalActivities}
                      aria-label={`${completedActivities} of ${totalActivities} activities completed`}
                    />
                  ) : (
                    <small>No activities to track yet.</small>
                  )}
                </div>
              </div>

              {schedule.length === 0 ? (
                <p className="learning-path-empty">This Learning Path has no scheduled study days.</p>
              ) : (
                <div className="learning-path-days">
                  {schedule.map((day, dayIndex) => (
                    <article className="learning-path-day" key={`${day.day ?? dayIndex}-${day.date ?? dayIndex}`}>
                      <div className="learning-path-day-heading">
                        <div>
                          <h4>Day {day.day ?? dayIndex + 1}</h4>
                          {day.date && <p>{formatLearningPathDate(day.date)}</p>}
                        </div>
                      </div>
                      {day.summary && <p className="learning-path-summary">{day.summary}</p>}
                      <div className="learning-path-activities">
                        {(Array.isArray(day.activities) ? day.activities : []).map((activity, activityIndex) => {
                          const activityTitle = activity.title || `Activity ${activityIndex + 1}`
                          const activityKey = `${dayIndex}-${activityIndex}`
                          return (
                            <div
                              className={`learning-path-activity${activity.completed ? ' is-completed' : ''}`}
                              key={activity._id || activityKey}
                            >
                              <label className="learning-path-activity-toggle">
                                <input
                                  type="checkbox"
                                  checked={activity.completed === true}
                                  disabled={Boolean(pendingActivity)}
                                  onChange={event => handleActivityCompletion(
                                    dayIndex,
                                    activityIndex,
                                    event.target.checked
                                  )}
                                  aria-label={`Mark ${activityTitle} ${activity.completed ? 'incomplete' : 'complete'}`}
                                />
                                <span>{activityTitle}</span>
                              </label>
                              {activity.description && <p>{activity.description}</p>}
                              <div className="learning-path-activity-meta">
                                <span>{activity.type ? activity.type.replace(/-/g, ' ') : 'Activity'}</span>
                                {activity.duration != null && (
                                  <span>{activity.duration} min</span>
                                )}
                              </div>
                              {pendingActivity === activityKey && (
                                <span className="learning-path-updating" role="status">Saving progress...</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="ai-container">
          <div className="ai-sidebar">
            <div className="course-selection">
            <label htmlFor="chat-course-select">📚 Select Course</label>
              <select
              id="chat-course-select"
              value={selectedCourse}
              onChange={e => handleCourseChange(e.target.value)}
              disabled={loading || pathActionPending}
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

            {selectedCourse && (
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

        .learning-path-section {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 12px;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .learning-path-section-heading h2 {
          margin: 0;
          color: #242424;
          font-size: 1.35rem;
        }

        .learning-path-section-heading p {
          margin: 0.4rem 0 0;
          color: #666;
          font-size: 0.9rem;
        }

        .learning-path-controls {
          display: grid;
          grid-template-columns: minmax(180px, 1.5fr) repeat(2, minmax(150px, 1fr)) auto;
          align-items: end;
          gap: 0.8rem;
          padding: 1rem;
          background: #f8f8fc;
          border: 1px solid #ececf4;
          border-radius: 10px;
        }

        .learning-path-field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .learning-path-field label {
          color: #444;
          font-size: 0.82rem;
          font-weight: 600;
        }

        .learning-path-field select,
        .learning-path-field input {
          width: 100%;
          min-height: 42px;
          padding: 0.6rem 0.7rem;
          border: 1px solid #d5d5df;
          border-radius: 7px;
          background: white;
          color: #333;
          font: inherit;
        }

        .learning-path-field select:focus,
        .learning-path-field input:focus,
        .learning-path-activity-toggle input:focus-visible {
          outline: 2px solid #667eea;
          outline-offset: 2px;
        }

        .learning-path-field :disabled {
          background: #f0f0f0;
          cursor: not-allowed;
        }

        .learning-path-generate {
          min-height: 42px;
          padding: 0.65rem 1rem;
          border: 0;
          border-radius: 7px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .learning-path-generate:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .learning-path-empty,
        .learning-path-status {
          margin: 0;
          padding: 0.9rem 1rem;
          border-radius: 8px;
          background: #f8f8fc;
          color: #555;
        }

        .learning-path-error {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin: 0;
          padding: 0.85rem 1rem;
          border: 1px solid #f2c5c5;
          border-radius: 8px;
          background: #fff3f3;
          color: #9f2424;
        }

        .learning-path-error button {
          padding: 0.4rem 0.65rem;
          border: 1px solid currentColor;
          border-radius: 6px;
          background: white;
          color: inherit;
          cursor: pointer;
          white-space: nowrap;
        }

        .learning-path-results {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .learning-path-overview {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1.5rem;
          padding: 1rem;
          border-radius: 9px;
          background: linear-gradient(135deg, #667eea12 0%, #764ba212 100%);
        }

        .learning-path-overview h3 {
          margin: 0;
          color: #292b3d;
          font-size: 1.15rem;
        }

        .learning-path-overview p {
          margin: 0.35rem 0 0;
          color: #5e6070;
          font-size: 0.88rem;
        }

        .learning-path-progress {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          min-width: min(250px, 40%);
          color: #444;
          font-size: 0.85rem;
        }

        .learning-path-progress progress {
          width: 100%;
          height: 0.7rem;
          accent-color: #667eea;
        }

        .learning-path-days {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
          gap: 0.9rem;
        }

        .learning-path-day {
          min-width: 0;
          padding: 1rem;
          border: 1px solid #e6e6ec;
          border-radius: 9px;
          background: white;
        }

        .learning-path-day-heading h4 {
          margin: 0;
          color: #333;
          font-size: 1rem;
        }

        .learning-path-day-heading p,
        .learning-path-summary {
          margin: 0.35rem 0 0;
          color: #666;
          font-size: 0.85rem;
          line-height: 1.45;
        }

        .learning-path-activities {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          margin-top: 0.8rem;
        }

        .learning-path-activity {
          padding: 0.8rem;
          border: 1px solid #ededf1;
          border-radius: 8px;
          background: #fafafd;
        }

        .learning-path-activity.is-completed {
          border-color: #b7dfc5;
          background: #f3fbf5;
        }

        .learning-path-activity-toggle {
          display: flex;
          align-items: flex-start;
          gap: 0.6rem;
          color: #333;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
        }

        .learning-path-activity-toggle input {
          width: 1rem;
          height: 1rem;
          margin: 0.15rem 0 0;
          accent-color: #667eea;
          flex: 0 0 auto;
        }

        .learning-path-activity-toggle input:disabled {
          cursor: wait;
        }

        .learning-path-activity > p {
          margin: 0.55rem 0 0;
          color: #5c5c65;
          font-size: 0.85rem;
          line-height: 1.45;
        }

        .learning-path-activity-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-top: 0.65rem;
        }

        .learning-path-activity-meta span {
          padding: 0.22rem 0.5rem;
          border-radius: 999px;
          background: #eceeff;
          color: #454b80;
          font-size: 0.75rem;
          text-transform: capitalize;
        }

        .learning-path-updating {
          display: inline-block;
          margin-top: 0.5rem;
          color: #555;
          font-size: 0.78rem;
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

        .ai-header .ai-personalization-note {
          font-size: 0.85rem;
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
          .learning-path-section {
            padding: 1rem;
          }

          .learning-path-controls {
            grid-template-columns: 1fr;
          }

          .learning-path-overview {
            align-items: stretch;
            flex-direction: column;
            gap: 1rem;
          }

          .learning-path-progress {
            min-width: 0;
          }

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
    </>
  )
}
