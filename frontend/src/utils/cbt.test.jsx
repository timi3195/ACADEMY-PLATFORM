import React, { Children } from 'react'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import CBTQuiz from '../pages/CBTQuiz'
import CBTPracticeLink from '../components/CBTPracticeLink'
import {
  canAccessCbtPractice,
  cbtQuestionCountForCourse,
  cbtPathForCourse,
  cbtSubmissionAnswers,
  createServerDeadline,
  formatCbtCountdown,
  cbtAnswerFromQuestion,
  cbtQuestionType,
  isCbtAnswerVersionConflict,
  isValidCbtQuestionCount,
  emptyCbtAnswer,
  hasCbtAnswer,
  reconcileCbtSubmissionConflict,
  reconcileCbtAnswers,
  remainingCbtSeconds,
  unansweredQuestionNumbers
} from './cbt'

vi.mock('../components/PDFViewer', () => ({ default: () => null }))

const getRoutes = () => {
  let routesElement
  const visit = (element) => {
    React.Children.forEach(element, (child) => {
      if (routesElement || !React.isValidElement(child)) return
      if (child.type.name === 'Routes') {
        routesElement = child
        return
      }
      visit(child.props.children)
    })
  }
  visit(App())
  return Children.toArray(routesElement.props.children)
}

describe('CBT access and delivery helpers', () => {
  it('allows students and administrators to access CBT practice', () => {
    expect(canAccessCbtPractice({ role: 'admin' })).toBe(true)
    expect(canAccessCbtPractice({ role: 'student' })).toBe(true)
    expect(canAccessCbtPractice({ role: 'lecturer' })).toBe(false)
    expect(canAccessCbtPractice(null)).toBe(false)
  })

  it('allows only supported practice-test lengths', () => {
    for (const valid of [10, 20, 30, 40, 50]) {
      expect(isValidCbtQuestionCount(valid)).toBe(true)
    }
    for (const invalid of [0, -1, 1, 2, 9, 11, 49, 1.5, '10', 51, null]) {
      expect(isValidCbtQuestionCount(invalid)).toBe(false)
    }
  })

  it('builds a course-specific CBT route and practice entry link', () => {
    const courseId = 'course id/1'
    expect(cbtPathForCourse(courseId)).toBe('/cbt?courseId=course%20id%2F1')
    expect(cbtPathForCourse(courseId, 20)).toBe('/cbt?courseId=course%20id%2F1&questionCount=20')
    const link = CBTPracticeLink({ courseId })
    expect(link.props.to).toBe('/cbt?courseId=course%20id%2F1')
    expect(link.props.children).toBe('Start CBT Practice')
  })

  it('uses a requested test length only when that course supports it', () => {
    expect(cbtQuestionCountForCourse('20', [10, 20])).toBe(20)
    expect(cbtQuestionCountForCourse('30', [10, 20])).toBe(10)
    expect(cbtQuestionCountForCourse('not-a-number', [])).toBe(10)
  })

  it('registers CBT as an authenticated protected route', () => {
    const routeElements = getRoutes()
    const cbtRoute = routeElements.find((route) => route.props.path === '/cbt')
    expect(cbtRoute).toBeDefined()
    expect(cbtRoute.props.element.props.children.type).toBe(CBTQuiz)
  })

  it('tracks unanswered items and builds submissions from stable option IDs', () => {
    const questions = [{ _id: 'question-a' }, { _id: 'question-b' }]
    const answers = [
      { selectedOptionId: 'stable-option-a' },
      { selectedOptionId: null }
    ]
    expect(unansweredQuestionNumbers(questions, answers)).toEqual([2])
    expect(cbtSubmissionAnswers(questions, answers)).toEqual([
      { questionId: 'question-a', selectedOptionId: 'stable-option-a' },
      { questionId: 'question-b', selectedOptionId: null }
    ])
  })

  it('creates and validates answer state for all three formats', () => {
    const objective = { questionType: 'objective' }
    const fillInGap = { questionType: 'fill_in_gap', blankCount: 2, selectedAnswers: ['first', 'second'] }
    const theory = { questionType: 'theory', theoryResponse: 'A written response.' }

    expect(cbtQuestionType({})).toBe('objective')
    expect(emptyCbtAnswer(objective)).toEqual({ selectedOptionId: null })
    expect(emptyCbtAnswer(fillInGap)).toEqual({ selectedAnswers: ['', ''] })
    expect(emptyCbtAnswer(theory)).toEqual({ theoryResponse: '' })
    expect(cbtAnswerFromQuestion(fillInGap)).toEqual({ selectedAnswers: ['first', 'second'] })
    expect(cbtAnswerFromQuestion(theory)).toEqual({ theoryResponse: 'A written response.' })
    expect(hasCbtAnswer(objective, { selectedOptionId: 'option-a' })).toBe(true)
    expect(hasCbtAnswer(fillInGap, { selectedAnswers: ['first', ''] })).toBe(false)
    expect(hasCbtAnswer(theory, { theoryResponse: '  ' })).toBe(false)
    expect(unansweredQuestionNumbers(
      [objective, fillInGap, theory],
      [
        { selectedOptionId: 'option-a' },
        { selectedAnswers: ['first', 'second'] },
        { theoryResponse: 'A written response.' }
      ]
    )).toEqual([])
    expect(cbtSubmissionAnswers(
      [{ _id: 'objective-id' }, { _id: 'gap-id', questionType: 'fill_in_gap' }, { _id: 'theory-id', questionType: 'theory' }],
      [
        { selectedOptionId: 'option-a' },
        { selectedAnswers: ['one'] },
        { theoryResponse: 'essay' }
      ]
    )).toEqual([
      { questionId: 'objective-id', selectedOptionId: 'option-a' },
      { questionId: 'gap-id', selectedAnswers: ['one'] },
      { questionId: 'theory-id', theoryResponse: 'essay' }
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
      answers: [
        { selectedOptionId: 'option-a' },
        { selectedOptionId: 'option-b' }
      ],
      statuses: { 'question-a': 'saved', 'question-b': 'failed' }
    })
  })

  it('recognizes only the answer-version conflict response during submission', () => {
    expect(isCbtAnswerVersionConflict({
      status: 409,
      body: { code: 'ANSWER_VERSION_CONFLICT' }
    })).toBe(true)
    expect(isCbtAnswerVersionConflict({
      status: 409,
      body: { code: 'ATTEMPT_EXPIRED' }
    })).toBe(false)
    expect(isCbtAnswerVersionConflict({
      status: 500,
      body: { code: 'ANSWER_VERSION_CONFLICT' }
    })).toBe(false)
  })

  it('does not replace newer local answers with an older conflict snapshot', () => {
    const questions = [{ _id: 'question-a' }, { _id: 'question-b' }]
    const localAnswers = ['new-local-answer', 'local-answer-b']
    const localStatuses = { 'question-a': 'saved', 'question-b': 'saved' }

    expect(reconcileCbtSubmissionConflict({
      stateVersion: 4,
      questions: [
        { _id: 'question-a', selectedOptionId: 'stale-server-answer' },
        { _id: 'question-b', selectedOptionId: null }
      ]
    }, questions, localAnswers, localStatuses, 5)).toEqual({
      answers: localAnswers,
      statuses: localStatuses,
      stateVersion: 5
    })
  })

  it('synchronizes a newer server snapshot and preserves pending local answers for retry', () => {
    const questions = [{ _id: 'question-a' }, { _id: 'question-b' }]
    const localAnswers = ['local-a', 'pending-local-b']
    const localStatuses = { 'question-a': 'saved', 'question-b': 'failed' }
    const reconciled = reconcileCbtSubmissionConflict({
      stateVersion: 8,
      questions: [
        { _id: 'question-a', selectedOptionId: 'server-a' },
        { _id: 'question-b', selectedOptionId: null }
      ]
    }, questions, localAnswers, localStatuses, 7)

    expect(reconciled).toEqual({
      answers: [
        { selectedOptionId: 'server-a' },
        { selectedOptionId: 'pending-local-b' }
      ],
      statuses: { 'question-b': 'failed' },
      stateVersion: 8
    })
    expect(cbtSubmissionAnswers(questions, reconciled.answers)).toEqual([
      { questionId: 'question-a', selectedOptionId: 'server-a' },
      { questionId: 'question-b', selectedOptionId: 'pending-local-b' }
    ])
  })
})
