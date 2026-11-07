import React, { Children } from 'react'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import CBTQuiz from '../pages/CBTQuiz'
import CBTPracticeLink from '../components/CBTPracticeLink'
import {
  canAccessCbtPractice,
  cbtPathForCourse,
  cbtSubmissionAnswers,
  createServerDeadline,
  formatCbtCountdown,
  isValidCbtQuestionCount,
  reconcileCbtAnswers,
  remainingCbtSeconds,
  unansweredQuestionNumbers
} from './cbt'

vi.mock('../components/PDFViewer', () => ({ default: () => null }))

describe('CBT access and delivery helpers', () => {
  it('allows premium students and administrators but not other users to access CBT practice', () => {
    expect(canAccessCbtPractice({ role: 'student', plan: 'premium' })).toBe(true)
    expect(canAccessCbtPractice({ role: 'student', subscriptionType: 'premium' })).toBe(true)
    expect(canAccessCbtPractice({ role: 'admin' })).toBe(true)
    expect(canAccessCbtPractice({ role: 'student', plan: 'basic' })).toBe(false)
    expect(canAccessCbtPractice({ role: 'lecturer', plan: 'premium' })).toBe(false)
    expect(canAccessCbtPractice(null)).toBe(false)
  })

  it('validates whole question counts within the configured maximum', () => {
    expect(isValidCbtQuestionCount(1)).toBe(true)
    expect(isValidCbtQuestionCount(50)).toBe(true)
    for (const invalid of [0, -1, 1.5, '10', 51, null]) {
      expect(isValidCbtQuestionCount(invalid)).toBe(false)
    }
  })

  it('builds a course-specific CBT route and practice entry link', () => {
    const courseId = 'course id/1'
    expect(cbtPathForCourse(courseId)).toBe('/cbt?courseId=course%20id%2F1')
    const link = CBTPracticeLink({ courseId })
    expect(link.props.to).toBe('/cbt?courseId=course%20id%2F1')
    expect(link.props.children).toBe('Start CBT Practice')
  })

  it('registers CBT as an authenticated protected route', () => {
    const routeElements = Children.toArray(App().props.children.props.children)
    const cbtRoute = routeElements.find((route) => route.props.path === '/cbt')
    expect(cbtRoute).toBeDefined()
    expect(cbtRoute.props.element.props.children.type).toBe(CBTQuiz)
  })

  it('tracks unanswered items and builds submissions from stable option IDs', () => {
    const questions = [{ _id: 'question-a' }, { _id: 'question-b' }]
    const answers = ['stable-option-a', null]
    expect(unansweredQuestionNumbers(questions, answers)).toEqual([2])
    expect(cbtSubmissionAnswers(questions, answers)).toEqual([
      { questionId: 'question-a', selectedOptionId: 'stable-option-a' },
      { questionId: 'question-b', selectedOptionId: null }
    ])
  })

  it('uses server time and a monotonic clock for expiry countdowns', () => {
    const deadline = createServerDeadline(
      '2030-01-01T00:30:00.000Z',
      '2030-01-01T00:00:00.000Z',
      5000
    )
    expect(deadline).toBe(1805000)
    expect(remainingCbtSeconds(deadline, 5000)).toBe(1800)
    expect(remainingCbtSeconds(deadline, 1805000)).toBe(0)
    expect(formatCbtCountdown(1800)).toBe('30:00')
    expect(formatCbtCountdown(9)).toBe('0:09')
    expect(createServerDeadline('not-a-date', '2030-01-01T00:00:00.000Z', 0)).toBeNull()
  })

  it('restores persisted answers without discarding local answers that failed to save', () => {
    const serverQuestions = [
      { _id: 'question-a', selectedOptionId: 'option-a' },
      { _id: 'question-b', selectedOptionId: null }
    ]
    const restored = reconcileCbtAnswers(
      serverQuestions,
      serverQuestions,
      ['option-a', 'option-b'],
      { 'question-a': 'saving', 'question-b': 'failed' }
    )
    expect(restored).toEqual({
      answers: ['option-a', 'option-b'],
      statuses: { 'question-a': 'saved', 'question-b': 'failed' }
    })
  })
})
