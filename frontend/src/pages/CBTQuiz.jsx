import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import { useAuth } from '../utils/auth'
import PremiumGate from '../components/PremiumGate'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'

export default function CBTQuiz() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [questions, setQuestions] = useState([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState([])
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [startTime, setStartTime] = useState(null)
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [startingQuiz, setStartingQuiz] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCourses()
  }, [])

  async function fetchCourses() {
    setLoadingCourses(true)
    setError('')
    try {
      const res = await apiGet('/api/courses')
      setCourses(res.courses || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to load available courses.')
    } finally {
      setLoadingCourses(false)
    }
  }

  async function startQuiz() {
    if (!courseId) {
      setError('Please select a course before starting the quiz.')
      return
    }

    setError('')
    setStartingQuiz(true)
    try {
      let res
      if (user && user._id) {
        res = await apiPost('/api/quiz/start', { userId: user._id, courseId })
      } else {
        res = await apiGet(`/api/questions/quiz/${courseId}`)
      }

      const loadedQuestions = res.questions || []
      if (loadedQuestions.length === 0) {
        setError('No objective past questions are available for this course yet. Add multiple-choice past questions to get started.')
        return
      }

      setQuestions(loadedQuestions)
      setStartTime(res.startedAt || new Date())
      setIndex(0)
      setScore(0)
      setFinished(false)
      setAnswers([])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to start the quiz right now.')
    } finally {
      setStartingQuiz(false)
    }
  }

  const q = questions[index]

  const selectAnswer = (optionIndex) => {
    setAnswers(prev => {
      const next = [...prev]
      next[index] = optionIndex
      return next
    })
  }

  const submit = async () => {
    if (answers[index] == null) {
      setError('Please choose an option before continuing.')
      return
    }

    setError('')
    const selected = answers[index]
    const isCorrect = selected === q.answer
    if (isCorrect) setScore(s => s + 1)

    if (index + 1 < questions.length) {
      setIndex(i => i + 1)
    } else {
      setFinished(true)
      if (user && user._id) {
        const payload = {
          userId: user._id,
          courseId,
          answers: questions.map((ques, i) => ({ questionId: ques._id, selectedAnswer: answers[i] })),
          startTime
        }
        try {
          await apiPost('/api/quiz/submit', payload)
        } catch (err) {
          console.warn('Failed to submit quiz session', err)
        }
      }
    }
  }

  if (finished) return (
    <div className="page">
      <h2>Quiz Complete</h2>
      <div className="card">
        <p>Your score: {score} / {questions.length}</p>
        <p className="text-sm text-gray-600">You can start another quiz whenever you are ready.</p>
      </div>
    </div>
  )

  return (
    <PremiumGate fallback={<p>Upgrade to premium to access the CBT quiz engine.</p>}>
      <div className="page">
        <h2>CBT Quiz</h2>
        <p className="text-sm text-gray-600 mb-4">Practice with objective past questions and review your progress after each round.</p>
        {error && <ErrorState message={error} />}
        <div className="card">
          <p className="text-sm text-gray-600 mb-3">Quiz questions are automatically generated from objective past questions uploaded for the selected course.</p>
          {loadingCourses ? (
            <p className="text-sm text-gray-600">Loading courses…</p>
          ) : courses.length === 0 ? (
            <EmptyState title="No courses available" description="Ask an admin to add a course and upload objective past questions first." icon="🎓" />
          ) : (
            <>
              <select value={courseId} onChange={e => setCourseId(e.target.value)}>
                <option value="">Select a course</option>
                {courses.map(course => (
                  <option key={course._id} value={course._id}>
                    {course.title} ({course.code})
                  </option>
                ))}
              </select>
              <button onClick={startQuiz} disabled={!courseId || startingQuiz}>{startingQuiz ? 'Starting...' : 'Start Quiz'}</button>
            </>
          )}
        </div>

        {q && (
          <div className="card">
            <p className="question-text">{q.question || q.text}</p>
            <div className="options">
              {(q.options || q.choices || []).map((opt, i) => (
                <label key={i} className={`option ${answers[index] === i ? 'selected' : ''}`}>
                  <input type="radio" name="opt" checked={answers[index] === i} onChange={() => selectAnswer(i)} /> {opt}
                </label>
              ))}
            </div>
            <button onClick={submit}>Submit</button>
          </div>
        )}
      </div>
    </PremiumGate>
  )
}
