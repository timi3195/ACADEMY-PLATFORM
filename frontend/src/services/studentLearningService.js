import { apiGet } from '../utils/api'

export async function fetchStudentLearningRecommendations() {
  const response = await apiGet('/api/student-learning/recommendations')
  if (response?.success !== true || !Array.isArray(response.candidates)) {
    throw new Error('Recommendations are unavailable.')
  }
  return { candidates: response.candidates }
}
