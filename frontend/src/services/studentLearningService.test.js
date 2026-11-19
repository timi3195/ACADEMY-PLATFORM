import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/api', () => ({ apiGet: vi.fn() }))

import { apiGet } from '../utils/api'
import { fetchStudentLearningRecommendations } from './studentLearningService'

describe('fetchStudentLearningRecommendations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the authenticated endpoint without a client-selected student ID', async () => {
    const candidates = [{ candidateId: 'private-candidate-id' }]
    apiGet.mockResolvedValue({
      success: true,
      evidenceFingerprint: 'private-fingerprint',
      studentId: 'private-student-id',
      candidates
    })

    await expect(fetchStudentLearningRecommendations()).resolves.toEqual({ candidates })
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/api/student-learning/recommendations')
  })

  it('rejects unsuccessful or malformed recommendation responses', async () => {
    apiGet.mockResolvedValueOnce({ success: false, candidates: [] })
    await expect(fetchStudentLearningRecommendations()).rejects.toThrow('Recommendations are unavailable.')

    apiGet.mockResolvedValueOnce({ success: true, candidates: null })
    await expect(fetchStudentLearningRecommendations()).rejects.toThrow('Recommendations are unavailable.')
  })

  it('can be called again for a user-requested refresh', async () => {
    apiGet.mockResolvedValue({ success: true, candidates: [] })

    await fetchStudentLearningRecommendations()
    await fetchStudentLearningRecommendations()

    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(apiGet).toHaveBeenNthCalledWith(1, '/api/student-learning/recommendations')
    expect(apiGet).toHaveBeenNthCalledWith(2, '/api/student-learning/recommendations')
  })

  it('propagates API errors for the page to present as a safe retry state', async () => {
    apiGet.mockRejectedValue(new Error('private provider details'))

    await expect(fetchStudentLearningRecommendations()).rejects.toThrow('private provider details')
  })
})
