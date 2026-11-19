import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import CBTQuiz from './CBTQuiz'
import {
  ExaminationHistoryView,
  formatHistoryDate,
  loadStudentQuizHistory,
  quizResultsPathForUser
} from './ExaminationHistory'

vi.mock('../components/PDFViewer', () => ({ default: () => null }))

const renderView = (props) => renderToStaticMarkup(
  <MemoryRouter>
    <ExaminationHistoryView {...props} />
  </MemoryRouter>
)

describe('ExaminationHistoryView', () => {
  it('is available as a protected route and linked from the CBT page', () => {
    const routeElements = React.Children.toArray(App().props.children.props.children)
    const historyRoute = routeElements.find((route) => route.props.path === '/examination-history')
    const cbtRoute = routeElements.find((route) => route.props.path === '/cbt')

    expect(historyRoute).toBeDefined()
    expect(historyRoute.props.element.props.children.type.name).toBe('ExaminationHistory')
    expect(cbtRoute.props.element.props.children.type).toBe(CBTQuiz)
    expect(renderToStaticMarkup(
      <MemoryRouter><ExaminationHistoryView attempts={[]} loading={false} /></MemoryRouter>
    )).toContain('href="/cbt"')
  })

  it('loads results using the authenticated user ID and URL-encodes it', async () => {
    const get = vi.fn(async () => ({ results: [{ _id: 'attempt-1' }] }))
    const results = await loadStudentQuizHistory('student/id-1', get)

    expect(quizResultsPathForUser('student/id-1')).toBe('/api/quiz/results/student%2Fid-1')
    expect(get).toHaveBeenCalledWith('/api/quiz/results/student%2Fid-1')
    expect(results).toEqual([{ _id: 'attempt-1' }])
    await expect(loadStudentQuizHistory('', get)).rejects.toThrow('account could not be identified')
  })

  it('shows a loading state', () => {
    expect(renderView({ loading: true })).toContain('Loading your examination history')
  })

  it('shows an empty state without inventing results', () => {
    const markup = renderView({ attempts: [], loading: false })
    expect(markup).toContain('No examination history yet')
    expect(markup).not.toContain('0%')
    expect(markup).toContain('Start CBT practice')
  })

  it('shows API errors and a retry action', () => {
    const markup = renderView({
      attempts: [],
      loading: false,
      error: 'History API unavailable',
      onRetry: vi.fn()
    })
    expect(markup).toContain('History API unavailable')
    expect(markup).toContain('Try again')
  })

  it('renders actual course, date, result, status, and question count', () => {
    const markup = renderView({
      loading: false,
      attempts: [{
        _id: 'attempt-1',
        course: { title: 'Networking', code: 'NET101' },
        status: 'completed',
        completedAt: '2025-02-01T12:00:00.000Z',
        historicalScoreStatus: 'verified',
        score: 8,
        percentage: 80,
        totalQuestions: 10,
        questions: []
      }]
    })

    expect(markup).toContain('Networking (NET101)')
    expect(markup).toContain('Completed')
    expect(markup).toContain('8 / 10')
    expect(markup).toContain('80.0%')
    expect(markup).toContain('>10</dd>')
    expect(markup).not.toContain('correctOptionId')
  })

  it('allows reviewing saved selections without exposing correct answers', () => {
    const markup = renderView({
      loading: false,
      attempts: [{
        _id: 'attempt-1',
        course: { title: 'Networking' },
        status: 'completed',
        timeEnded: '2025-02-01T12:00:00.000Z',
        score: 1,
        percentage: 50,
        questions: [{
          questionId: 'question-1',
          question: 'Which protocol routes packets?',
          selectedOptionId: 'option-b',
          presentedOptions: [
            { optionId: 'option-a', text: 'HTTP' },
            { optionId: 'option-b', text: 'IP' }
          ]
        }]
      }]
    })

    expect(markup).toContain('Review your answers')
    expect(markup).toContain('Which protocol routes packets?')
    expect(markup).toContain('Your response:</strong> IP')
    expect(markup).not.toContain('correctOptionId')
    expect(markup).not.toContain('isCorrect')
  })

  it('shows saved typed responses and pending grading without exposing marking data', () => {
    const markup = renderView({
      loading: false,
      attempts: [{
        _id: 'typed-attempt',
        course: { title: 'Applied Science' },
        status: 'completed',
        attemptFormatVersion: 2,
        gradingStatus: 'pending',
        questions: [
          {
            questionId: 'objective-question',
            question: 'Choose the answer.',
            selectedOptionId: 'option-b',
            presentedOptions: [{ optionId: 'option-b', text: 'Option B' }]
          },
          {
            questionId: 'gap-question',
            question: 'Complete both blanks.',
            questionType: 'fill_in_gap',
            selectedAnswers: ['first answer', 'second answer']
          },
          {
            questionId: 'theory-question',
            question: 'Explain the process.',
            questionType: 'theory',
            theoryResponse: 'The saved written response.'
          }
        ]
      }]
    })

    expect(markup).toContain('Your answers are saved. Grading is pending or in progress.')
    expect(markup).toContain('Your response:</strong> Option B')
    expect(markup).toContain('Blank 1: first answer · Blank 2: second answer')
    expect(markup).toContain('Your response:</strong> The saved written response.')
    expect(markup).not.toContain('markingSnapshot')
    expect(markup).not.toContain('referenceAnswer')
  })

  it('does not present ambiguous historical defaults as scores', () => {
    const markup = renderView({
      loading: false,
      attempts: [{
        _id: 'legacy-unverified',
        course: { title: 'Networking' },
        status: 'completed',
        historicalScoreStatus: 'unverified',
        score: null,
        percentage: null,
        totalQuestions: 0,
        questions: []
      }]
    })

    expect(markup).toContain('Not available')
    expect(markup).toContain('historical score could not be verified')
    expect(markup).not.toContain('0.0%')
  })

  it('does not fabricate missing or invalid dates', () => {
    expect(formatHistoryDate(undefined)).toBe('Date unavailable')
    expect(formatHistoryDate('not-a-date')).toBe('Date unavailable')
  })
})
