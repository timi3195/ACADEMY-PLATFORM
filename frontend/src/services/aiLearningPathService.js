import { apiGet, apiPost, apiPut } from '../utils/api'

export function generateLearningPath({ courseId, targetExamDate, studyHoursPerDay }) {
  const body = { courseId, studyHoursPerDay }
  if (targetExamDate) body.targetExamDate = targetExamDate
  return apiPost('/api/ai/learning-path/generate', body)
}

export function getLearningPath(courseId) {
  return apiGet(`/api/ai/learning-path/${encodeURIComponent(courseId)}`)
}

export function updateLearningPathProgress(pathId, { dayIndex, activityIndex, completed, score }) {
  const body = { dayIndex, activityIndex, completed }
  if (score !== undefined) body.score = score
  return apiPut(
    `/api/ai/learning-path/${encodeURIComponent(pathId)}/update-progress`,
    body
  )
}
