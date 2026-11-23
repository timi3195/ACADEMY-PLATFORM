import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CBTResultFeedback from './CBTResultFeedback'

describe('CBTResultFeedback', () => {
  it('does not expose expected answers before grading completes', () => {
    const markup = renderToStaticMarkup(
      <CBTResultFeedback
        attempt={{
          _id: 'attempt-1',
          attemptFormatVersion: 2,
          gradingStatus: 'failed',
          questions: [{
            questionId: 'question-1',
            question: 'Choose an answer.',
            questionType: 'objective',
            selectedOptionId: 'option-a',
            presentedOptions: [{ optionId: 'option-a', text: 'Student choice' }]
          }]
        }}
        onRetryGrading={vi.fn()}
      />
    )
    expect(markup).toContain('Your answers are saved')
    expect(markup).toContain('Student choice')
    expect(markup).not.toContain('Correct answer')
    expect(markup).toContain('Retry grading')
  })

  it('renders objective, fill-in, and theory feedback after grading', () => {
    const markup = renderToStaticMarkup(
      <CBTResultFeedback
        attempt={{
          _id: 'attempt-2',
          attemptFormatVersion: 2,
          gradingStatus: 'graded',
          score: 6,
          totalMarks: 8,
          percentage: 75,
          questions: [
            {
              questionId: 'objective',
              question: 'Select the answer.',
              questionType: 'objective',
              selectedOptionId: 'wrong',
              presentedOptions: [{ optionId: 'wrong', text: 'Student answer' }],
              gradingResult: {
                questionType: 'objective',
                isCorrect: false,
                awardedMarks: 0,
                maxMarks: 2,
                correctAnswer: 'Expected answer',
                explanation: 'The expected answer is correct.',
                lostMarks: 'The correct answer is Expected answer.'
              }
            },
            {
              questionId: 'fill',
              question: 'Fill the blank.',
              questionType: 'fill_in_gap',
              selectedAnswers: ['alternative'],
              gradingResult: {
                questionType: 'fill_in_gap',
                awardedMarks: 1,
                maxMarks: 2,
                blanks: [{
                  blankNumber: 1,
                  response: 'alternative',
                  expectedAnswers: ['expected', 'valid alternative'],
                  awardedMarks: 1,
                  maxMarks: 2,
                  provisional: true,
                  criteria: [{
                    criterionId: 'criterion-1',
                    description: 'Required idea',
                    awardedMarks: 1,
                    maxMarks: 2,
                    missingPoint: 'One detail is missing.'
                  }]
                }]
              }
            },
            {
              questionId: 'theory',
              question: 'Explain the process.',
              questionType: 'theory',
              theoryResponse: 'Student essay.',
              gradingResult: {
                questionType: 'theory',
                awardedMarks: 5,
                maxMarks: 6,
                provisional: true,
                referenceAnswer: 'Reference answer.',
                criteria: [{
                  criterionId: 'criterion-2',
                  description: 'Explains the key point.',
                  awardedMarks: 5,
                  maxMarks: 6,
                  feedback: 'Mostly correct.',
                  missingPoint: 'A final detail is absent.'
                }]
              }
            }
          ]
        }}
      />
    )

    expect(markup).toContain('Total marks: 6 / 8')
    expect(markup).toContain('Result:')
    expect(markup).toContain('Incorrect')
    expect(markup).toContain('Blank 1 marks:')
    expect(markup).not.toContain('Expected answer')
    expect(markup).not.toContain('valid alternative')
    expect(markup).not.toContain('Required idea')
    expect(markup).not.toContain('Provisional AI-assisted assessment')
    expect(markup).not.toContain('Reference answer.')
    expect(markup).not.toContain('Explains the key point.')
    expect(markup).not.toContain('A final detail is absent.')
  })

  it('shows unresolved assessments as provisional without assigning zero', () => {
    const markup = renderToStaticMarkup(
      <CBTResultFeedback
        attempt={{
          _id: 'attempt-3',
          attemptFormatVersion: 2,
          gradingStatus: 'needs_review',
          score: null,
          percentage: null,
          provisionalScore: 2,
          provisionalMaxMarks: 2,
          provisionalPercentage: 100,
          questions: [{
            questionId: 'uncertain',
            question: 'Ambiguous response.',
            questionType: 'theory',
            theoryResponse: 'Response.',
            gradingResult: {
              questionType: 'theory',
              status: 'needs_review',
              awardedMarks: null,
              maxMarks: 3,
              uncertaintyReason: 'The response is ambiguous.',
              explanation: 'A reliable score cannot be assigned.'
            }
          }]
        }}
      />
    )
    expect(markup).toContain('No score was assigned to unresolved items')
    expect(markup).toContain('Provisional score for assessed portions: 2 / 2')
    expect(markup).toContain('Pending review / 3')
    expect(markup).toContain('This response requires manual review.')
    expect(markup).not.toContain('The response is ambiguous.')
  })

  it('does not present an unverified historical score as a result', () => {
    const markup = renderToStaticMarkup(
      <CBTResultFeedback
        attempt={{
          _id: 'legacy-attempt',
          historicalScoreStatus: 'unverified',
          score: null,
          questions: []
        }}
      />
    )
    expect(markup).toContain('historical score could not be verified')
    expect(markup).not.toContain('Historical score: 0')
  })
})
