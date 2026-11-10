export const MAX_CBT_QUESTION_COUNT = 50

export function isValidCbtQuestionCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CBT_QUESTION_COUNT
}

export function canAccessCbtPractice(user) {
  if (!user) return false
  if (user.role === 'admin') return true
  return user.role === 'student' && (user.plan === 'premium' || user.subscriptionType === 'premium')
}

export function cbtPathForCourse(courseId) {
  return `/cbt?courseId=${encodeURIComponent(courseId)}`
}

export function unansweredQuestionNumbers(questions, answers) {
  return questions.reduce((unanswered, question, index) => {
    if (!answers[index]) unanswered.push(index + 1)
    return unanswered
  }, [])
}

export function cbtSubmissionAnswers(questions, answers) {
  return questions.map((question, index) => ({
    questionId: question._id,
    selectedOptionId: answers[index]
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
  const answers = serverQuestions.map((question) => question.selectedOptionId || null)
  const statuses = {}
  localQuestions.forEach((question, localIndex) => {
    const status = localStatuses[question._id]
    if (status !== 'saving' && status !== 'failed') return
    const serverIndex = serverQuestions.findIndex((item) => item._id === question._id)
    if (serverIndex < 0) return
    const localAnswer = localAnswers[localIndex] || null
    if (localAnswer !== answers[serverIndex]) answers[serverIndex] = localAnswer
    statuses[question._id] = localAnswer === (serverQuestions[serverIndex].selectedOptionId || null)
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
