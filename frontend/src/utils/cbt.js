export const SUPPORTED_CBT_QUESTION_COUNTS = Object.freeze([10, 20, 30, 40, 50])

export function isValidCbtQuestionCount(value) {
  return SUPPORTED_CBT_QUESTION_COUNTS.includes(value)
}

export function canAccessCbtPractice(user) {
  if (!user) return false
  if (user.role === 'admin') return true
  return user.role === 'student'
}

export function cbtPathForCourse(courseId, questionCount) {
  const search = `courseId=${encodeURIComponent(String(courseId))}`
  if (isValidCbtQuestionCount(questionCount)) {
    return `/cbt?${search}&questionCount=${questionCount}`
  }
  return `/cbt?${search}`
}

export function cbtQuestionCountForCourse(requestedCount, supportedCounts) {
  const requested = Number(requestedCount)
  const availableCounts = Array.isArray(supportedCounts) ? supportedCounts : []
  if (isValidCbtQuestionCount(requested) && availableCounts.includes(requested)) {
    return requested
  }
  return availableCounts.find(isValidCbtQuestionCount) || 10
}

export function cbtQuestionType(question) {
  return ['objective', 'fill_in_gap', 'theory'].includes(question?.questionType)
    ? question.questionType
    : 'objective'
}

export function emptyCbtAnswer(question) {
  const type = cbtQuestionType(question)
  if (type === 'fill_in_gap') {
    return { selectedAnswers: Array(Math.max(0, question?.blankCount || 0)).fill('') }
  }
  if (type === 'theory') return { theoryResponse: '' }
  return { selectedOptionId: null }
}

export function cbtAnswerFromQuestion(question) {
  const type = cbtQuestionType(question)
  if (type === 'fill_in_gap') {
    const saved = Array.isArray(question?.selectedAnswers) ? question.selectedAnswers : []
    return {
      selectedAnswers: Array.from(
        { length: Math.max(0, question?.blankCount || saved.length) },
        (_, index) => saved[index] || ''
      )
    }
  }
  if (type === 'theory') return { theoryResponse: question?.theoryResponse || '' }
  return { selectedOptionId: question?.selectedOptionId || null }
}

export function hasCbtAnswer(question, answer) {
  const type = cbtQuestionType(question)
  if (type === 'fill_in_gap') {
    return Array.isArray(answer?.selectedAnswers) &&
      answer.selectedAnswers.length === question.blankCount &&
      answer.selectedAnswers.every((value) => typeof value === 'string' && value.trim())
  }
  if (type === 'theory') {
    return typeof answer?.theoryResponse === 'string' && answer.theoryResponse.trim().length > 0
  }
  return typeof answer === 'string'
    ? answer.length > 0
    : typeof answer?.selectedOptionId === 'string' && answer.selectedOptionId.length > 0
}

export function sameCbtAnswer(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function unansweredQuestionNumbers(questions, answers) {
  return questions.reduce((unanswered, question, index) => {
    if (!hasCbtAnswer(question, answers[index])) unanswered.push(index + 1)
    return unanswered
  }, [])
}

export function cbtSubmissionAnswers(questions, answers) {
  return questions.map((question, index) => ({
    questionId: question._id,
    ...(typeof answers[index] === 'string' || answers[index] === null
      ? { selectedOptionId: answers[index] }
      : answers[index])
  }))
}

export function isCbtAnswerVersionConflict(error) {
  return error?.status === 409 && error?.body?.code === 'ANSWER_VERSION_CONFLICT'
}

export function createServerDeadline(expiresAt, serverNow, monotonicNow) {
  const expiryMs = Date.parse(expiresAt)
  const serverNowMs = Date.parse(serverNow)
  if (!Number.isFinite(expiryMs) || !Number.isFinite(serverNowMs) || !Number.isFinite(monotonicNow)) {
    return null
  }
  return monotonicNow + Math.max(0, expiryMs - serverNowMs)
}

export function remainingCbtSeconds(deadline, monotonicNow) {
  if (!Number.isFinite(deadline) || !Number.isFinite(monotonicNow)) return null
  return Math.max(0, Math.ceil((deadline - monotonicNow) / 1000))
}

export function formatCbtCountdown(seconds) {
  if (!Number.isFinite(seconds)) return '--:--'
  const remaining = Math.max(0, Math.floor(seconds))
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
}

export function reconcileCbtAnswers(serverQuestions, localQuestions, localAnswers, localStatuses) {
  const answers = serverQuestions.map(cbtAnswerFromQuestion)
  const statuses = {}
  localQuestions.forEach((question, localIndex) => {
    const status = localStatuses[question._id]
    if (status !== 'saving' && status !== 'failed') return
    const serverIndex = serverQuestions.findIndex((item) => item._id === question._id)
    if (serverIndex < 0) return
    const localAnswer = typeof localAnswers[localIndex] === 'string' || localAnswers[localIndex] === null
      ? { selectedOptionId: localAnswers[localIndex] || null }
      : localAnswers[localIndex]
    if (!sameCbtAnswer(localAnswer, answers[serverIndex])) answers[serverIndex] = localAnswer
    statuses[question._id] = sameCbtAnswer(
      localAnswer,
      cbtAnswerFromQuestion(serverQuestions[serverIndex])
    )
      ? 'saved'
      : 'failed'
  })
  return { answers, statuses }
}

export function reconcileCbtSubmissionConflict(
  attempt,
  localQuestions,
  localAnswers,
  localStatuses,
  localStateVersion
) {
  const serverStateVersion = attempt?.stateVersion
  if (!Number.isSafeInteger(serverStateVersion) || serverStateVersion < 0) return null

  if (Number.isSafeInteger(localStateVersion) && serverStateVersion <= localStateVersion) {
    return {
      answers: [...localAnswers],
      statuses: { ...localStatuses },
      stateVersion: localStateVersion
    }
  }

  const reconciled = reconcileCbtAnswers(
    attempt.questions || [],
    localQuestions,
    localAnswers,
    localStatuses
  )
  return { ...reconciled, stateVersion: serverStateVersion }
}
