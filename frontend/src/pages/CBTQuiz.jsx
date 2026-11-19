import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { apiGet, apiPatch, apiPost } from '../utils/api'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import CBTResultFeedback from '../components/CBTResultFeedback'
import {
  createServerDeadline,
  cbtAnswerFromQuestion,
  cbtQuestionType,
  cbtSubmissionAnswers,
  emptyCbtAnswer,
  formatCbtCountdown,
  hasCbtAnswer,
  isCbtAnswerVersionConflict,
  cbtQuestionCountForCourse,
  isValidCbtQuestionCount,
  reconcileCbtSubmissionConflict,
  reconcileCbtAnswers,
  remainingCbtSeconds,
  sameCbtAnswer,
  unansweredQuestionNumbers
} from '../utils/cbt'

const TYPED_ANSWER_AUTOSAVE_DELAY_MS = 350

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
  const [retryingGrading, setRetryingGrading] = useState(false)
  const [gradingRetryError, setGradingRetryError] = useState('')
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [error, setError] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const stateVersionRef = useRef(0)
  const attemptIdRef = useRef('')
  const answersRef = useRef([])
  const saveQueueRef = useRef(Promise.resolve())
  const typedAnswerTimersRef = useRef(new Map())
  const saveStatusesRef = useRef({})
  const deadlineRef = useRef(null)
  const expiryRequestRef = useRef(false)
  const revalidationRef = useRef(false)
  const recoveryAttemptedRef = useRef(false)
  const activeAttempt = Boolean(attemptId && questions.length > 0 && !result)

  useEffect(() => {
    document.body.classList.toggle('cbt-focus-mode', activeAttempt)
    return () => document.body.classList.remove('cbt-focus-mode')
  }, [activeAttempt])

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
      const coverageResponse = await apiGet('/api/quiz/coverage')
      const availableCourses = coverageResponse.courses || []
      setCourses(availableCourses)
      const requestedCourseId = searchParams.get('courseId')
      const requestedCourse = availableCourses.find((course) => course.courseId === requestedCourseId)
      if (requestedCourse) {
        setCourseId(requestedCourseId)
        setQuestionCount(cbtQuestionCountForCourse(
          searchParams.get('questionCount'),
          requestedCourse.availableTestLengths || []
        ))
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
      const restoredAnswers = loadedQuestions.map(cbtAnswerFromQuestion)
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
    const availableQuestionCounts = courses.find((course) => course.courseId === courseId)?.availableTestLengths || []
    if (!availableQuestionCounts.includes(questionCount)) {
      setError('Choose a test length supported by the selected course.')
      return
    }
    if (!isValidCbtQuestionCount(questionCount)) {
      setError('Choose a supported whole-number test length.')
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
      answersRef.current = loadedQuestions.map(emptyCbtAnswer)
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

  const performAnswerSave = async (questionIndex, answer, retriesRemaining = 1) => {
    const currentAttemptId = attemptIdRef.current
    const question = questions[questionIndex]
    if (!currentAttemptId || !question) return
    const saveStatus = (status) => {
      if (!sameCbtAnswer(answersRef.current[questionIndex], answer)) return
      saveStatusesRef.current = { ...saveStatusesRef.current, [question._id]: status }
      setSaveStatuses((current) => ({ ...current, [question._id]: status }))
    }

    try {
      const response = await apiPatch(`/api/quiz/${encodeURIComponent(currentAttemptId)}/answers`, {
        questionId: question._id,
        ...answer,
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
          if (latestSelection) {
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

  const enqueueAnswerSave = (questionIndex, answer) => {
    const save = () => performAnswerSave(questionIndex, answer)
    saveQueueRef.current = saveQueueRef.current.then(save, save)
    return saveQueueRef.current
  }

  const scheduleTypedAnswerSave = (questionIndex, answer) => {
    const question = questions[questionIndex]
    if (!question) return
    const questionId = question._id
    const scheduledAttemptId = attemptIdRef.current
    const existingTimer = typedAnswerTimersRef.current.get(questionId)
    if (existingTimer) window.clearTimeout(existingTimer)

    const timer = window.setTimeout(() => {
      typedAnswerTimersRef.current.delete(questionId)
      if (attemptIdRef.current !== scheduledAttemptId) return
      const currentIndex = questions.findIndex((item) => item._id === questionId)
      if (currentIndex >= 0) enqueueAnswerSave(currentIndex, answersRef.current[currentIndex] || answer)
    }, TYPED_ANSWER_AUTOSAVE_DELAY_MS)
    typedAnswerTimersRef.current.set(questionId, timer)
  }

  const flushPendingTypedAnswerSaves = () => {
    for (const [questionId, timer] of typedAnswerTimersRef.current.entries()) {
      window.clearTimeout(timer)
      typedAnswerTimersRef.current.delete(questionId)
      const questionIndex = questions.findIndex((item) => item._id === questionId)
      if (questionIndex >= 0 && answersRef.current[questionIndex]) {
        enqueueAnswerSave(questionIndex, answersRef.current[questionIndex])
      }
    }
  }

  const selectAnswer = (optionId) => {
    if (result || submitting || remainingSeconds === 0) return
    const questionIndex = index
    const questionId = questions[questionIndex]?._id
    const nextAnswers = answersRef.current.map((answer, answerIndex) =>
      answerIndex === questionIndex ? { selectedOptionId: optionId } : answer
    )
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    saveStatusesRef.current = { ...saveStatusesRef.current, [questionId]: 'saving' }
    setSaveStatuses((current) => ({ ...current, [questionId]: 'saving' }))
    setError('')
    enqueueAnswerSave(questionIndex, nextAnswers[questionIndex])
  }

  const updateTypedAnswer = (answer) => {
    if (result || submitting || remainingSeconds === 0) return
    const questionIndex = index
    const questionId = questions[questionIndex]?._id
    const nextAnswers = answersRef.current.map((current, answerIndex) =>
      answerIndex === questionIndex ? answer : current
    )
    answersRef.current = nextAnswers
    setAnswers(nextAnswers)
    saveStatusesRef.current = { ...saveStatusesRef.current, [questionId]: 'saving' }
    setSaveStatuses((current) => ({ ...current, [questionId]: 'saving' }))
    setError('')
    scheduleTypedAnswerSave(questionIndex, answer)
  }

  const updateFillAnswer = (blankIndex, value) => {
    const current = answersRef.current[index]
    const selectedAnswers = Array.isArray(current?.selectedAnswers)
      ? [...current.selectedAnswers]
      : Array(questions[index]?.blankCount || 0).fill('')
    selectedAnswers[blankIndex] = value
    updateTypedAnswer({ selectedAnswers })
  }

  const updateTheoryAnswer = (theoryResponse) => {
    updateTypedAnswer({ theoryResponse })
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
      flushPendingTypedAnswerSaves()
      await saveQueueRef.current
      if (Object.values(saveStatusesRef.current).some((status) => status === 'saving' || status === 'failed')) {
        setError('Wait for all answers to save successfully before submitting.')
        return
      }
      const response = await apiPost('/api/quiz/submit', {
        attemptId,
        answers: cbtSubmissionAnswers(questions, answersRef.current)
      })
      setResult(response.session)
      setConfirmingSubmit(false)
    } catch (err) {
      if (err.body?.session?.status === 'completed') setResult(err.body.session)
      else if (isCbtAnswerVersionConflict(err)) {
        const conflictAttempt = err.body.attempt
        const reconciliation = reconcileCbtSubmissionConflict(
          conflictAttempt,
          questions,
          answersRef.current,
          saveStatusesRef.current,
          stateVersionRef.current
        )
        if (reconciliation) {
          const timingMessage = applyAttempt(conflictAttempt, { preserveAnswers: true })
          stateVersionRef.current = reconciliation.stateVersion
          answersRef.current = reconciliation.answers
          setAnswers(reconciliation.answers)
          saveStatusesRef.current = reconciliation.statuses
          setSaveStatuses(reconciliation.statuses)
          setRecoveryMessage(timingMessage)
          setError('Answers were synchronized with the latest server state. Review them, retry any failed saves, then submit again.')
        } else {
          setError('The attempt changed, but its latest answer state could not be reconciled. Your local answers are unchanged; reload the attempt before submitting again.')
        }
      }
      else setError(err.message || 'Unable to submit the examination.')
    } finally {
      setSubmitting(false)
    }
  }

  const resetQuiz = () => {
    for (const timer of typedAnswerTimersRef.current.values()) window.clearTimeout(timer)
    typedAnswerTimersRef.current.clear()
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
    setGradingRetryError('')
  }

  const retryGrading = async () => {
    if (!result?._id || retryingGrading) return
    setRetryingGrading(true)
    setGradingRetryError('')
    try {
      const response = await apiPost(`/api/quiz/${encodeURIComponent(result._id)}/grade`, {})
      setResult(response.session)
    } catch (requestError) {
      setGradingRetryError(requestError.message || 'Unable to retry grading. Your answers remain saved.')
    } finally {
      setRetryingGrading(false)
    }
  }

  const question = questions[index]
  const unansweredCount = unansweredQuestionNumbers(questions, answers).length
  const selectedCourseCoverage = courses.find((course) => course.courseId === courseId)
  const availableQuestionCounts = selectedCourseCoverage?.availableTestLengths || []

  if (result) {
    return (
      <div className="page">
        <h2>{result.completionReason === 'expired' ? 'Examination Time Expired' : 'Quiz Submitted'}</h2>
        <section className="card" aria-live="polite">
          <CBTResultFeedback
            attempt={result}
            onRetryGrading={retryGrading}
            retrying={retryingGrading}
            retryError={gradingRetryError}
          />
          <Link className="inline-flex items-center mr-3" to="/examination-history">View examination history</Link>
          <button type="button" onClick={resetQuiz} disabled={retryingGrading}>Start another practice quiz</button>
        </section>
      </div>
    )
  }

  return (
      <div className="page">
        <h2>CBT Practice</h2>
        {!activeAttempt && <p className="mb-4"><Link to="/examination-history">View examination history</Link></p>}
        <p className="text-sm text-gray-600 mb-4">Practice using approved questions from verified past papers.</p>
        {error && <ErrorState message={error} />}
        {recoveryMessage && <p className="text-sm text-blue-700" role="status">{recoveryMessage}</p>}
        {!online && <p className="text-sm text-red-700" role="alert">Network unavailable. Changes are not confirmed as saved until the server responds.</p>}
        {activeAttempt && (
          <p className="mb-3 text-sm text-gray-600">
            The timer continues if you leave this page. The browser cannot prevent switching tabs or leaving the browser.
          </p>
        )}

        {questions.length === 0 ? (
          <section className="card">
            <p className="text-sm text-gray-600 mb-3">Review approved, AI-marked past-paper coverage for your accessible courses.</p>
            {loadingCourses || recoveringAttempt ? (
              <p className="text-sm text-gray-600">Checking for a saved examination and loading courses...</p>
            ) : courses.length === 0 ? (
              <EmptyState title="No courses available" description="No accessible courses are available for CBT practice." icon="🎓" />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {courses.map((course) => (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3" key={course.courseId}>
                      <p className="font-semibold">{course.courseName} ({course.courseCode})</p>
                      <p className="text-sm text-gray-600">
                        {course.eligibleQuestionCount} eligible approved questions with usable AI marking
                      </p>
                      <p className="text-sm text-gray-600">
                        Formats: {course.objectiveQuestionCount} objective · {course.fillInGapQuestionCount} fill-in-the-gap · {course.theoryQuestionCount} theory
                      </p>
                      <p className="text-sm text-gray-600">
                        {course.distinctSourcePaperCount} verified past-paper source(s), {course.verifiedSourceQuestionCount} question(s) with source provenance
                      </p>
                      <p className="text-sm text-gray-600">
                        Years: {course.academicYears.length ? course.academicYears.join(', ') : 'Not available'}
                        {' · '}Sessions: {course.examSessions.length ? course.examSessions.join(', ') : 'Not available'}
                      </p>
                    </div>
                  ))}
                </div>
                <label className="flex flex-1 flex-col gap-2">
                  <span className="text-sm font-semibold">Course</span>
                  <select value={courseId} onChange={(event) => {
                    const selectedCourseId = event.target.value
                    const selectedCourse = courses.find((course) => course.courseId === selectedCourseId)
                    const lengths = selectedCourse?.availableTestLengths || []
                    setCourseId(selectedCourseId)
                    setQuestionCount(lengths.includes(questionCount) ? questionCount : lengths[0] || 10)
                  }}>
                    <option value="">Select a course</option>
                    {courses.map((course) => (
                      <option key={course.courseId} value={course.courseId}>
                        {course.courseName} ({course.courseCode})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCourseCoverage && (selectedCourseCoverage.enoughForPracticeTest ? (
                    <>
                      <label className="flex flex-col gap-2 sm:max-w-xs">
                        <span className="text-sm font-semibold">Practice-test length</span>
                        <select
                          value={availableQuestionCounts.includes(questionCount) ? questionCount : ''}
                          onChange={(event) => setQuestionCount(Number(event.target.value))}
                        >
                          {availableQuestionCounts.map((count) => (
                            <option key={count} value={count}>{count} questions</option>
                          ))}
                        </select>
                      </label>
                      <p className="text-sm text-gray-600">
                        Topics: {selectedCourseCoverage.topicCategories.length
                          ? selectedCourseCoverage.topicCategories.join(', ')
                          : 'Not available'}
                      </p>
                    </>
                ) : (
                    <div className="flex flex-col gap-2">
                      {selectedCourseCoverage.insufficientQuestionsMessage && (
                        <p className="text-sm text-amber-800" role="status">
                          {selectedCourseCoverage.insufficientQuestionsMessage}
                        </p>
                      )}
                      {selectedCourseCoverage.availabilityMessage && (
                        <p className="text-sm text-amber-800" role="status">
                          {selectedCourseCoverage.availabilityMessage}
                        </p>
                      )}
                    </div>
                ))}
                <button
                  type="button"
                  onClick={startQuiz}
                  disabled={!courseId || !availableQuestionCounts.includes(questionCount) || startingQuiz || recoveringAttempt}
                >
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
                {questions.map((item, questionIndex) => {
                  const hasAnswer = hasCbtAnswer(item, answers[questionIndex])
                  return (
                  <button
                    key={item._id}
                    type="button"
                    aria-label={`Question ${questionIndex + 1}${hasAnswer ? ', answered' : ', unanswered'}`}
                    aria-current={questionIndex === index ? 'step' : undefined}
                    onClick={() => {
                      setIndex(questionIndex)
                      setConfirmingSubmit(false)
                      setError('')
                    }}
                    className={hasAnswer ? 'bg-green-600' : 'bg-gray-500'}
                  >
                    {questionIndex + 1}{hasAnswer ? ' ✓' : ''}
                  </button>
                  )
                })}
              </div>
            </section>

            {question && (
              <section className="card">
                <p className="text-sm font-semibold text-gray-600">
                  Question {index + 1}{question.topic ? ` · ${question.topic}` : ''}
                </p>
                <h3 className="question-text mt-2">{question.question}</h3>
                <p className="mt-2 text-sm text-gray-600">
                  {Number.isFinite(question.marks) ? `${question.marks} mark(s)` : 'Question'}{' · '}
                  {question.questionType === 'theory'
                    ? 'Theory response'
                    : question.questionType === 'fill_in_gap'
                      ? `${question.blankCount} blank(s)`
                      : 'Objective'}
                </p>
                {cbtQuestionType(question) === 'objective' ? (
                  <fieldset className="options">
                    <legend className="sr-only">Answer options</legend>
                    {(question.presentedOptions || []).map((option) => (
                      <label
                        key={option.optionId}
                        className={`option ${answers[index]?.selectedOptionId === option.optionId ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name={`question-${question._id}`}
                          value={option.optionId}
                          checked={answers[index]?.selectedOptionId === option.optionId}
                          disabled={remainingSeconds === 0 || submitting || result !== null}
                          onChange={() => selectAnswer(option.optionId)}
                        />
                        <span>{option.text}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : cbtQuestionType(question) === 'fill_in_gap' ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {Array.from({ length: question.blankCount || 0 }, (_, blankIndex) => (
                      <label className="flex flex-col gap-1" key={blankIndex}>
                        <span className="text-sm font-semibold">Blank {blankIndex + 1}</span>
                        <input
                          type="text"
                          maxLength={1000}
                          value={answers[index]?.selectedAnswers?.[blankIndex] || ''}
                          disabled={remainingSeconds === 0 || submitting || result !== null}
                          onChange={(event) => updateFillAnswer(blankIndex, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="mt-4 flex flex-col gap-2">
                    <span className="text-sm font-semibold">Your response ({question.marks} marks)</span>
                    <textarea
                      rows={10}
                      maxLength={20000}
                      value={answers[index]?.theoryResponse || ''}
                      disabled={remainingSeconds === 0 || submitting || result !== null}
                      onChange={(event) => updateTheoryAnswer(event.target.value)}
                    />
                  </label>
                )}
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
                  {' '}Responses are saved before submission. This attempt cannot be changed after submission.
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
  )
}
