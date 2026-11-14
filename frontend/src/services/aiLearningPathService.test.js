import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPost, apiPut } from '../utils/api'
import {
  generateLearningPath,
  getLearningPath,
  updateLearningPathProgress
} from './aiLearningPathService'

vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn()
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('AI Learning Path service', () => {
  it('sends generation options to the existing endpoint', () => {
    generateLearningPath({
      courseId: 'course-1',
      targetExamDate: '2026-12-01',
      studyHoursPerDay: 2.5
    })

    expect(apiPost).toHaveBeenCalledWith('/api/ai/learning-path/generate', {
      courseId: 'course-1',
      targetExamDate: '2026-12-01',
      studyHoursPerDay: 2.5
    })
  })

  it('omits an optional exam date when none is provided', () => {
    generateLearningPath({ courseId: 'course-1', studyHoursPerDay: 2 })

    expect(apiPost).toHaveBeenCalledWith('/api/ai/learning-path/generate', {
      courseId: 'course-1',
      studyHoursPerDay: 2
    })
  })

  it('retrieves a path for the selected course', () => {
    getLearningPath('course/1')

    expect(apiGet).toHaveBeenCalledWith('/api/ai/learning-path/course%2F1')
  })

  it('updates activity completion and preserves optional scores', () => {
    updateLearningPathProgress('path-1', {
      dayIndex: 2,
      activityIndex: 1,
      completed: false,
      score: 90
    })

    expect(apiPut).toHaveBeenCalledWith(
      '/api/ai/learning-path/path-1/update-progress',
      { dayIndex: 2, activityIndex: 1, completed: false, score: 90 }
    )
  })
})
