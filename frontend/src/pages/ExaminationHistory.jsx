import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { useAuth } from '../utils/auth'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import './ExaminationHistory.css'

export function quizResultsPathForUser(userId) {
  return `/api/quiz/results/${encodeURIComponent(userId)}`
}

export async function loadStudentQuizHistory(userId, get = apiGet) {
  if (!userId) throw new Error('Your account could not be identified. Please sign in again.')
  const response = await get(quizResultsPathForUser(userId))
  if (!Array.isArray(response?.results)) {
    throw new Error('The examination history response was incomplete.')
  }
  return response.results
}

export function formatHistoryDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString()
}

function getAttemptStatus(attempt) {
  if (attempt.status === 'completed') return 'Completed'
  if (attempt.status === 'in_progress') return 'In progress'
  if (attempt.completedAt || attempt.timeEnded) return 'Completed'
  return 'Status unavailable'
}

function getQuestionCount(attempt) {
  if (Number.isFinite(attempt.totalQuestions)) return attempt.totalQuestions
  if (Array.isArray(attempt.questions)) return attempt.questions.length
  return null
}

function AttemptDetails({ attempt }) {
  const questions = Array.isArray(attempt.questions) ? attempt.questions : []
  if (getAttemptStatus(attempt) !== 'Completed' || questions.length === 0) return null

  return (
    <details className="exam-history-details">
      <summary>Review your answers</summary>
      <ol className="exam-history-question-list">
        {questions.map((question, index) => {
          const selectedOption = (question.presentedOptions || [])
            .find((option) => option.optionId === question.selectedOptionId)
          return (
            <li key={`${attempt._id}-${question.questionId || index}`}>
              <p>{question.question || `Question ${index + 1}`}</p>
              <p className="exam-history-answer">
                Your answer: {selectedOption?.text || 'Not answered'}
              </p>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

export function ExaminationHistoryView({ attempts, loading, error, onRetry }) {
  if (loading) {
    return <div className="exam-history-state" role="status">Loading your examination history...</div>
  }

  return (
    <div className="page exam-history-page">
      <header className="exam-history-header">
        <div>
          <h1>Examination History</h1>
          <p>Review your completed CBT practice attempts and saved results.</p>
        </div>
        <Link className="exam-history-primary-link" to="/cbt">Start CBT practice</Link>
      </header>

      {error ? (
        <div className="exam-history-state" role="alert">
          <ErrorState message={error} />
          <button type="button" className="exam-history-retry" onClick={onRetry}>Try again</button>
        </div>
      ) : attempts.length === 0 ? (
        <div className="exam-history-state">
          <EmptyState
            title="No examination history yet"
            description="Completed CBT practice attempts will appear here."
            icon="📝"
          />
        </div>
      ) : (
        <section className="exam-history-list" aria-label="Your examination attempts">
          {attempts.map((attempt) => {
            const course = attempt.course
            const courseName = course && typeof course === 'object'
              ? [course.title, course.code ? `(${course.code})` : ''].filter(Boolean).join(' ')
              : 'Course unavailable'
            const status = getAttemptStatus(attempt)
            const questionCount = getQuestionCount(attempt)
            const completedAt = attempt.completedAt || attempt.timeEnded
            const date = status === 'Completed'
              ? formatHistoryDate(completedAt)
              : formatHistoryDate(attempt.startedAt || attempt.timeStarted)
            const score = Number.isFinite(attempt.score) && questionCount !== null
              ? `${attempt.score} / ${questionCount}`
              : 'Not available'

            return (
              <article className="exam-history-card" key={attempt._id}>
                <div className="exam-history-card-heading">
                  <h2>{courseName}</h2>
                  <span className={`exam-history-status ${status === 'Completed' ? 'is-completed' : ''}`}>
                    {status}
                  </span>
                </div>
                <dl className="exam-history-summary">
                  <div>
                    <dt>{status === 'Completed' ? 'Examination date' : 'Started'}</dt>
                    <dd>{date}</dd>
                  </div>
                  <div>
                    <dt>Score</dt>
                    <dd>{score}</dd>
                  </div>
                  <div>
                    <dt>Percentage</dt>
                    <dd>{Number.isFinite(attempt.percentage)
                      ? `${Number(attempt.percentage).toFixed(1)}%`
                      : 'Not available'}</dd>
                  </div>
                  <div>
                    <dt>Questions</dt>
                    <dd>{questionCount === null ? 'Not available' : questionCount}</dd>
                  </div>
                </dl>
                <AttemptDetails attempt={attempt} />
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

export default function ExaminationHistory() {
  const { user } = useAuth()
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const userId = user?._id || user?.id

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    loadStudentQuizHistory(userId)
      .then((results) => {
        if (active) setAttempts(results)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load examination history.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [userId, retryCount])

  return (
    <ExaminationHistoryView
      attempts={attempts}
      loading={loading}
      error={error}
      onRetry={() => setRetryCount((count) => count + 1)}
    />
  )
}
