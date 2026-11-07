import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiGet, apiPatch, apiPost } from '../utils/api'
import PremiumGate from '../components/PremiumGate'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import {
  createServerDeadline,
  formatCbtCountdown,
  isValidCbtQuestionCount,
  reconcileCbtAnswers,
  remainingCbtSeconds,
  unansweredQuestionNumbers
} from '../utils/cbt'

export default function CBTQuiz() {
  const [searchParams] = useSearchParams()
  const [courses, setCourses] = useState([])
  const [questions, setQuestions] = useState([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState([])
  const [result, setResult] = useState(null)
  const [courseId, setCourseId] = useState('')
  const [questionCount, setQuestionCount] = useState(10)
  const [attemptId, setAttemptId] = useState('')
  const [expiresAt, setExpiresAt] = useState(null)
  const [remainingSeconds, setRemainingSeconds] = useState(null)
  const [saveStatuses, setSaveStatuses] = useState({})
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine)
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [recoveringAttempt, setRecoveringAttempt] = useState(true)
  const [startingQuiz, setStartingQuiz] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [error, setError] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const stateVersionRef = useRef(0)
  const attemptIdRef = useRef('')
  const answersRef = useRef([])
  const saveQueueRef = useRef(Promise.resolve())
  const saveStatusesRef = useRef({})
  const deadlineRef = useRef(null)
  const expiryRequestRef = useRef(false)
  const revalidationRef = useRef(false)
  const recoveryAttemptedRef = useRef(false)

  useEffect(() => {
    fetchCourses()
  }, [])

  useEffect(() => {
    if (loadingCourses || recoveryAttemptedRef.current) return
    recoveryAttemptedRef.current = true
    recoverActiveAttempt()
  }, [loadingCourses])

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  useEffect(() => {
    if (!deadlineRef.current || result) return undefined
    const updateCountdown = () => {
      const seconds = remainingCbtSeconds(deadlineRef.current, performance.now())
      if (seconds === null) return
      setRemainingSeconds(seconds)
      if (seconds === 0) finalizeExpiredAttempt()
    }
    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt, result])

  useEffect(() => {
    if (!attemptId || result) return undefined
    const revalidateOnReconnect = () => {
      if (!navigator.onLine) return
      saveQueueRef.current.finally(() => revalidateAttempt())
    }
    const revalidateOnResume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        saveQueueRef.current.finally(() => revalidateAttempt())
      }
    }
    window.addEventListener('online', revalidateOnReconnect)
    window.addEventListener('focus', revalidateOnResume)
    document.addEventListener('visibilitychange', revalidateOnResume)
    return () => {
      window.removeEventListener('online', revalidateOnReconnect)
      window.removeEventListener('focus', revalidateOnResume)
      document.removeEventListener('visibilitychange', revalidateOnResume)
    }
  }, [attemptId, result])

  async function fetchCourses() {
    setLoadingCourses(true)
    setError('')
    try {
      const response = await apiGet('/api/courses')
      const availableCourses = response.courses || []
      setCourses(availableCourses)
      const requestedCourseId = searchParams.get('courseId')
      if (requestedCourseId && availableCourses.some((course) => course._id === requestedCourseId)) {
        setCourseId(requestedCourseId)
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to load available courses.')
    } finally {
      setLoadingCourses(false)
    }
  }

  function applyAttempt(attempt, { preserveAnswers = false } = {}) {
    const loadedQuestions = attempt.questions || []
    let timingMessage = ''
    setQuestions(loadedQuestions)
    setAttemptId(attempt._id || attempt.attemptId)
    attemptIdRef.current = attempt._id || attempt.attemptId
    stateVersionRef.current = Number.isSafeInteger(attempt.stateVersion) ? attempt.stateVersion : 0
    if (!preserveAnswers) {
      const restoredAnswers = loadedQuestions.map((item) => item.selectedOptionId || null)
      answersRef.current = restoredAnswers
      setAnswers(restoredAnswers)
      setSaveStatuses({})
      saveStatusesRef.current = {}
    }
    if (attempt.expiresAt && attempt.serverNow) {
      const serverDeadline = createServerDeadline(attempt.expiresAt, attempt.serverNow, performance.now())
      if (serverDeadline !== null) {
        setExpiresAt(attempt.expiresAt)
        deadlineRef.current = serverDeadline
      } else {
        setExpiresAt(null)
        deadlineRef.current = null
        setRemainingSeconds(null)
        timingMessage = 'A valid server expiry could not be synchronized. The server will continue enforcing attempt expiry.'
      }
    } else if (attempt.expiresAt) {
      setExpiresAt(null)
      deadlineRef.current = null
      setRemainingSeconds(null)
      timingMessage = 'The server expiry could not be synchronized. The server will continue enforcing attempt expiry.'
    } else {
      setExpiresAt(null)
      deadlineRef.current = null
      setRemainingSeconds(null)
      timingMessage = 'This legacy attempt has no recorded expiry time. The server will still enforce its attempt status.'
    }
    if (attempt.status === 'completed') {
      setResult(attempt)
      setRemainingSeconds(0)
    } else {
      setResult(null)
    }
    return timingMessage
  }

  async function recoverActiveAttempt() {
    setRecoveringAttempt(true)
    try {
      const response = await apiGet('/api/quiz/active')
      const timingMessage = applyAttempt(response.attempt)
      setRecoveryMessage(timingMessage || 'Your saved examination attempt was restored.')
    } catch (err) {
      if (err.status !== 404) {
        setRecoveryMessage(err.message || 'Unable to verify an existing examination attempt.')
      }
    } finally {
      setRecoveringAttempt(false)
    }
  }

  async function revalidateAttempt() {
    const currentAttemptId = attemptIdRef.current
    if (!currentAttemptId || revalidationRef.current) return
    revalidationRef.current = true
    try {
      const response = await apiGet(`/api/quiz/${encodeURIComponent(currentAttemptId)}`)
      const localAnswers = [...answersRef.current]
      const localStatuses = { ...saveStatusesRef.current }
      const localQuestions = [...questions]
      const timingMessage = applyAttempt(response.attempt)
      if (response.attempt.status !== 'completed') {
        const restored = reconcileCbtAnswers(
          response.attempt.questions || [],
          localQuestions,
          localAnswers,
          localStatuses
        )
        answersRef.current = restored.answers
        setAnswers(restored.answers)
        saveStatusesRef.current = restored.statuses
        setSaveStatuses(restored.statuses)
      }
      setRecoveryMessage(timingMessage || 'Examination status and saved answers were synchronized with the server.')
      setError('')
    } catch (err) {
      if (err.status === 0 || err.network) setError('Network unavailable. Your latest answer may not be saved.')
      else setError(err.message || 'Unable to restore this examination attempt.')
    } finally {
      revalidationRef.current = false
    }
  }

  async function startQuiz() {
    if (!courseId) {
      setError('Please select a course before starting the quiz.')
      return
    }
    if (!isValidCbtQuestionCount(questionCount)) {
      setError('Choose a whole number of questions between 1 and 50.')
      return
    }

    setError('')
    setStartingQuiz(true)
    try {
      const response = await apiPost('/api/quiz/start', { courseId, questionCount })
      const loadedQuestions = response.questions || []
      if (loadedQuestions.length !== questionCount) {
        setError('The server did not return the requested number of questions. Please try again.')
        return
      }

      const attempt = {
        ...response,
        _id: response.attemptId,
        status: response.status,
        questions: loadedQuestions
      }
      const timingMessage = applyAttempt(attempt)
      setIndex(0)
      answersRef.current = Array(loadedQuestions.length).fill(null)
      setAnswers(answersRef.current)
      expiryRequestRef.current = false
      setConfirmingSubmit(false)
      setRecoveryMessage(timingMessage)
      setError('')
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to start the quiz right now.')
    } finally {
      setStartingQuiz(false)
    }
  }

  const performAnswerSave = async (questionIndex, selectedOptionId, retriesRemaining = 1) => {
    const currentAttemptId = attemptIdRef.current
    const question = questions[questionIndex]
    if (!currentAttemptId || !question) return
    const saveStatus = (status) => {
      if (answersRef.current[questionIndex] !== selectedOptionId) return
      saveStatusesRef.current = { ...saveStatusesRef.current, [question._id]: status }
      setSaveStatuses((current) => ({ ...current, [question._id]: status }))
    }

    try {
      const response = await apiPatch(`/api/quiz/${encodeURIComponent(currentAttemptId)}/answers`, {
        questionId: question._id,
        selectedOptionId,
        expectedVersion: stateVersionRef.current
      })
      stateVersionRef.current = response.stateVersion
      saveStatus('saved')
      if (!Object.values(saveStatusesRef.current).some((status) => status === 'failed')) {
        setError('')
      }
    } catch (err) {
      const serverAttempt = err.body?.attempt
      if (serverAttempt?.status === 'completed') {
        applyAttempt(serverAttempt)
        return
      }
      if (err.body?.code === 'ANSWER_VERSION_CONFLICT' && retriesRemaining > 0) {
        try {
          const current = await apiGet(`/api/quiz/${encodeURIComponent(currentAttemptId)}`)
          stateVersionRef.current = current.attempt.stateVersion
          if (current.attempt.status === 'completed') {
            applyAttempt(current.attempt)
            return
          }
          const latestSelection = answersRef.current[questionIndex]
          if (latestSelection !== null) {
            await performAnswerSave(questionIndex, latestSelection, retriesRemaining - 1)
            return
          }
        } catch (refreshError) {
          err = refreshError
        }
      }
      saveStatus('failed')
      setError(err.message || 'This answer was not saved. Retry before submitting.')
    }
  }

  const enqueueAnswerSave = (questionIndex, selectedOptionId) => {
    const save = () => performAnswerSave(questionIndex, selectedOptionId)
    saveQueueRef.current = saveQueueRef.current.then(save, save)
    return saveQueueRef.current
  }

  const selectAnswer = (optionId) => {
    if (result || submitting || remainingSeconds === 0) return
    const questionIndex = index
    const questionId = questions[questionIndex]?._id
    const nextAnswers = answersRef.current.map((answer, answerIndex) =>
      answerIndex === questionIndex ? optionId : answer
    )
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    saveStatusesRef.current = { ...saveStatusesRef.current, [questionId]: 'saving' }
    setSaveStatuses((current) => ({ ...current, [questionId]: 'saving' }))
    setError('')
    enqueueAnswerSave(questionIndex, optionId)
  }

  const retryFailedAnswers = () => {
    questions.forEach((question, questionIndex) => {
      if (saveStatuses[question._id] === 'failed' && answersRef.current[questionIndex]) {
        saveStatusesRef.current = { ...saveStatusesRef.current, [question._id]: 'saving' }
        setSaveStatuses((current) => ({ ...current, [question._id]: 'saving' }))
        enqueueAnswerSave(questionIndex, answersRef.current[questionIndex])
      }
    })
  }

  const finalizeExpiredAttempt = async () => {
    if (!attemptIdRef.current || expiryRequestRef.current || result) return
    expiryRequestRef.current = true
    setSubmitting(true)
    setError('Time has expired. The server is finalizing your saved answers.')
    try {
      const response = await apiPost('/api/quiz/submit', { attemptId: attemptIdRef.current })
      if (response.session?.status === 'completed') {
        setResult(response.session)
        setRemainingSeconds(0)
        setError('')
      } else {
        expiryRequestRef.current = false
        applyAttempt(response.session)
      }
    } catch (err) {
      setError(err.message || 'Time has expired, but the result could not be retrieved. Reconnect and retry.')
      expiryRequestRef.current = false
      window.setTimeout(() => {
        if (navigator.onLine && !result) finalizeExpiredAttempt()
      }, 5000)
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    if (remainingSeconds === 0) {
      await finalizeExpiredAttempt()
      return
    }
    const unanswered = unansweredQuestionNumbers(questions, answers)
    if (unanswered.length > 0) {
      setConfirmingSubmit(false)
      setIndex(unanswered[0] - 1)
      setError(`Answer question ${unanswered[0]} before submitting.`)
      return
    }

    setError('')
    setSubmitting(true)
    try {
      await saveQueueRef.current
      if (Object.values(saveStatusesRef.current).some((status) => status === 'saving' || status === 'failed')) {
        setError('Wait for all answers to save successfully before submitting.')
        return
      }
      const response = await apiPost('/api/quiz/submit', { attemptId })
      setResult(response.session)
      setConfirmingSubmit(false)
    } catch (err) {
      if (err.body?.session?.status === 'completed') setResult(err.body.session)
      else setError(err.message || 'Unable to submit the examination.')
    } finally {
      setSubmitting(false)
    }
  }

  const resetQuiz = () => {
    setQuestions([])
    setAnswers([])
    answersRef.current = []
    setAttemptId('')
    attemptIdRef.current = ''
    setResult(null)
    setExpiresAt(null)
    setRemainingSeconds(null)
    deadlineRef.current = null
    expiryRequestRef.current = false
    saveStatusesRef.current = {}
    setSaveStatuses({})
    setIndex(0)
    setConfirmingSubmit(false)
    setError('')
  }

  const question = questions[index]
  const unansweredCount = unansweredQuestionNumbers(questions, answers).length

  if (result) {
    return (
      <PremiumGate fallback={<p>Upgrade to premium to access the CBT quiz engine.</p>}>
        <div className="page">
          <h2>{result.completionReason === 'expired' ? 'Examination Time Expired' : 'Quiz Complete'}</h2>
          <section className="card" aria-live="polite">
            <p>Your score: {result.score} / {result.totalQuestions}</p>
            <p>Percentage: {Number(result.percentage || 0).toFixed(1)}%</p>
            <p className="text-sm text-gray-600">Your result was calculated and saved by the server.</p>
            <button type="button" onClick={resetQuiz}>Start another practice quiz</button>
          </section>
        </div>
      </PremiumGate>
    )
  }

  return (
    <PremiumGate fallback={<p>Upgrade to premium to access the CBT quiz engine.</p>}>
      <div className="page">
        <h2>CBT Practice</h2>
        <p className="text-sm text-gray-600 mb-4">Practice with approved objective questions. Your result is graded by the server.</p>
        {error && <ErrorState message={error} />}
        {recoveryMessage && <p className="text-sm text-blue-700" role="status">{recoveryMessage}</p>}
        {!online && <p className="text-sm text-red-700" role="alert">Network unavailable. Changes are not confirmed as saved until the server responds.</p>}

        {questions.length === 0 ? (
          <section className="card">
            <p className="text-sm text-gray-600 mb-3">Choose a course and question count to create a randomized practice attempt.</p>
            {loadingCourses || recoveringAttempt ? (
              <p className="text-sm text-gray-600">Checking for a saved examination and loading courses...</p>
            ) : courses.length === 0 ? (
              <EmptyState title="No courses available" description="No accessible courses are available for CBT practice." icon="🎓" />
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <label className="flex flex-1 flex-col gap-2">
                  <span className="text-sm font-semibold">Course</span>
                  <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course._id} value={course._id}>
                        {course.title} ({course.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">Number of questions (1-50)</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={questionCount}
                    onChange={(event) => setQuestionCount(event.target.value === '' ? '' : Number(event.target.value))}
                  />
                </label>
                <button type="button" onClick={startQuiz} disabled={!courseId || startingQuiz || recoveringAttempt}>
                  {startingQuiz ? 'Starting...' : 'Start CBT Practice'}
                </button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="card" aria-label="Question navigation">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">Question {index + 1} of {questions.length}</p>
                <p className="text-sm text-gray-600">{questions.length - unansweredCount} answered</p>
                {remainingSeconds !== null && (
                  <p className="font-semibold" aria-live="polite">
                    Time remaining: {formatCbtCountdown(remainingSeconds)}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {questions.map((item, questionIndex) => (
                  <button
                    key={item._id}
                    type="button"
                    aria-label={`Question ${questionIndex + 1}${answers[questionIndex] ? ', answered' : ', unanswered'}`}
                    aria-current={questionIndex === index ? 'step' : undefined}
                    onClick={() => {
                      setIndex(questionIndex)
                      setConfirmingSubmit(false)
                      setError('')
                    }}
                    className={answers[questionIndex] ? 'bg-green-600' : 'bg-gray-500'}
                  >
                    {questionIndex + 1}{answers[questionIndex] ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </section>

            {question && (
              <section className="card">
                <p className="text-sm font-semibold text-gray-600">
                  Question {index + 1}{question.topic ? ` · ${question.topic}` : ''}
                </p>
                <h3 className="question-text mt-2">{question.question}</h3>
                <fieldset className="options">
                  <legend className="sr-only">Answer options</legend>
                  {(question.presentedOptions || []).map((option) => (
                    <label
                      key={option.optionId}
                      className={`option ${answers[index] === option.optionId ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`question-${question._id}`}
                        value={option.optionId}
                        checked={answers[index] === option.optionId}
                        disabled={remainingSeconds === 0 || submitting || result !== null}
                        onChange={() => selectAnswer(option.optionId)}
                      />
                      <span>{option.text}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="mt-3 text-sm" role="status" aria-live="polite">
                  {saveStatuses[question._id] === 'saving' && 'Saving answer...'}
                  {saveStatuses[question._id] === 'saved' && 'Answer saved.'}
                  {saveStatuses[question._id] === 'failed' && 'Answer not saved.'}
                </p>
                {Object.values(saveStatuses).some((status) => status === 'failed') && (
                  <button type="button" className="mt-2" onClick={retryFailedAnswers} disabled={!online || remainingSeconds === 0}>
                    Retry failed saves
                  </button>
                )}

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>
                    Previous
                  </button>
                  {index < questions.length - 1 ? (
                    <button type="button" onClick={() => setIndex((current) => current + 1)}>
                      Next
                    </button>
                  ) : (
                    <button type="button" onClick={() => {
                      setConfirmingSubmit(true)
                      setError('')
                    }}>
                      Review and submit
                    </button>
                  )}
                </div>
              </section>
            )}

            {confirmingSubmit && (
              <section className="card border border-blue-200" aria-labelledby="submit-confirmation">
                <h3 id="submit-confirmation">Confirm submission</h3>
                <p>
                  {unansweredCount
                    ? `${unansweredCount} question(s) are unanswered.`
                    : `You have answered all ${questions.length} questions.`}
                  {' '}Saved answers are graded by the server. Once submitted, this attempt cannot be changed.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setConfirmingSubmit(false)} disabled={submitting}>
                    Continue reviewing
                  </button>
                  <button type="button" onClick={submit} disabled={submitting}>
                    {submitting ? 'Submitting...' : 'Confirm and submit'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PremiumGate>
  )
}
