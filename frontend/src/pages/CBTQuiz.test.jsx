// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../utils/api'

vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn()
}))

import CBTQuiz from './CBTQuiz'

describe('CBT practice coverage', () => {
  afterEach(() => cleanup())

  it('shows total and per-origin eligible question counts and formats', async () => {
    apiGet.mockImplementation(async (path) => {
      if (path === '/api/quiz/coverage') {
        return {
          courses: [{
            courseId: 'course-1',
            courseName: 'Internet of Things',
            courseCode: 'NCC424',
            eligibleQuestionCount: 10,
            objectiveQuestionCount: 4,
            fillInGapQuestionCount: 3,
            theoryQuestionCount: 3,
            originalPracticeQuestionCount: 6,
            originalPracticeQuestionTypeCounts: { objective: 2, fill_in_gap: 2, theory: 2 },
            verifiedSourceQuestionCount: 4,
            verifiedSourceQuestionTypeCounts: { objective: 2, fill_in_gap: 1, theory: 1 },
            distinctSourcePaperCount: 2,
            academicYears: ['2025'],
            examSessions: ['Rain'],
            availableTestLengths: [10]
          }]
        }
      }
      if (path === '/api/quiz/active') {
        throw Object.assign(new Error('No active attempt.'), { status: 404 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<MemoryRouter><CBTQuiz /></MemoryRouter>)

    expect(await screen.findByText(/10 total eligible questions/)).toBeTruthy()
    expect(screen.getByText(/Original practice: 6 question\(s\) · 2 objective · 2 fill-in-the-gap · 2 theory/)).toBeTruthy()
    expect(screen.getByText(/Verified past-paper: 4 question\(s\) · 2 objective · 1 fill-in-the-gap · 1 theory · 2 source\(s\)/)).toBeTruthy()
  })
})
