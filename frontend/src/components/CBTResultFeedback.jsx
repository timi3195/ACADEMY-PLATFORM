import React from 'react'

function getStudentAnswer(question) {
  const type = question.questionType || 'objective'
  if (type === 'fill_in_gap') {
    const answers = Array.isArray(question.selectedAnswers) ? question.selectedAnswers : []
    return answers.length
      ? answers.map((answer, index) => `Blank ${index + 1}: ${answer || 'Not answered'}`).join(' · ')
      : 'Not answered'
  }
  if (type === 'theory') return question.theoryResponse || 'Not answered'
  return (question.presentedOptions || [])
    .find((option) => option.optionId === question.selectedOptionId)?.text || 'Not answered'
}

function QuestionFeedback({ question, index, finalGrading }) {
  const result = question.gradingResult
  const type = result?.questionType || question.questionType || 'objective'
  const awardedMarks = result?.awardedMarks
  const maxMarks = result?.maxMarks ?? question.marks

  return (
    <li className="cbt-result-question">
      <p className="cbt-result-question__text">
        {question.question || `Question ${index + 1}`}
      </p>
      <p><strong>Your response:</strong> {getStudentAnswer(question)}</p>
      {result ? (
        <div className="cbt-result-question__feedback">
          <p>
            <strong>Marks:</strong>{' '}
            {Number.isFinite(awardedMarks) ? `${awardedMarks} / ${maxMarks}` : `Pending review / ${maxMarks}`}
            {result.provisional && !finalGrading && ' · Provisional AI-assisted assessment'}
          </p>
          {result.uncertaintyReason && (
            <p role="status"><strong>Review required:</strong> {result.uncertaintyReason}</p>
          )}
          {type === 'objective' && result.correctAnswer && (
            <>
              <p><strong>Result:</strong> {result.isCorrect ? 'Correct' : 'Incorrect'}</p>
              <p><strong>Correct answer:</strong> {result.correctAnswer}</p>
            </>
          )}
          {type === 'fill_in_gap' && (result.blanks || []).map((blank) => (
            <div className="cbt-result-subanswer" key={blank.blankNumber}>
              <p>
                <strong>Blank {blank.blankNumber} expected:</strong> {blank.expectedAnswers.join(' / ')}
              </p>
              <p>
                <strong>Marks:</strong>{' '}
                {Number.isFinite(blank.awardedMarks)
                  ? `${blank.awardedMarks} / ${blank.maxMarks}`
                  : `Pending review / ${blank.maxMarks}`}
                {blank.provisional && !finalGrading && ' · Provisional AI-assisted assessment'}
              </p>
              {blank.criteria?.map((criterion) => (
                <p key={criterion.criterionId}>
                  {criterion.description}: {criterion.awardedMarks} / {criterion.maxMarks}
                  {criterion.missingPoint ? ` — ${criterion.missingPoint}` : ''}
                </p>
              ))}
              {blank.explanation && <p>{blank.explanation}</p>}
              {blank.uncertaintyReason && <p role="status">Review required: {blank.uncertaintyReason}</p>}
            </div>
          ))}
          {type === 'theory' && result.referenceAnswer && (
            <p><strong>Reference answer:</strong> {result.referenceAnswer}</p>
          )}
          {type === 'theory' && (result.criteria || []).map((criterion) => (
            <div className="cbt-result-subanswer" key={criterion.criterionId}>
              <p>
                <strong>{criterion.description}</strong>: {Number.isFinite(criterion.awardedMarks)
                  ? `${criterion.awardedMarks} / ${criterion.maxMarks}`
                  : `Pending review / ${criterion.maxMarks}`}
              </p>
              {criterion.feedback && <p>{criterion.feedback}</p>}
              {criterion.missingPoint && <p>Missing point: {criterion.missingPoint}</p>}
            </div>
          ))}
          {result.explanation && <p><strong>Explanation:</strong> {result.explanation}</p>}
          {result.lostMarks && <p><strong>Marks lost:</strong> {result.lostMarks}</p>}
        </div>
      ) : (
        <p>Grading feedback is not available for this question.</p>
      )}
    </li>
  )
}

export default function CBTResultFeedback({
  attempt,
  collapsible = false,
  onRetryGrading,
  retrying = false,
  retryError = ''
}) {
  const questions = Array.isArray(attempt?.questions) ? attempt.questions : []
  const status = attempt?.gradingStatus
  const needsReview = status === 'needs_review'
  const pending = status === 'pending' || status === 'grading'
  const finalGrading = status === 'graded'
  const hasFinalScore = finalGrading &&
    Number.isFinite(attempt?.score) &&
    Number.isFinite(attempt?.totalMarks) &&
    attempt.totalMarks > 0 &&
    attempt.score >= 0 &&
    attempt.score <= attempt.totalMarks &&
    Number.isFinite(attempt.percentage) &&
    attempt.percentage >= 0 &&
    attempt.percentage <= 100
  const legacy = !(attempt?.attemptFormatVersion >= 2)
  const results = (
    <section className="cbt-result-feedback" aria-live="polite">
      {hasFinalScore && (
        <p className="cbt-result-summary">
          Total marks: {attempt.score} / {attempt.totalMarks}. Percentage: {Number(attempt.percentage).toFixed(1)}%.
        </p>
      )}
      {finalGrading && !hasFinalScore && (
        <p role="status">The completed grading result could not be verified, so no final score is shown.</p>
      )}
      {status === 'unverified' && !legacy && (
        <p role="status">
          The saved grading details could not be verified and are excluded from current performance analytics.
        </p>
      )}
      {needsReview && (
        <div role="status">
          <p>
            Some assessments require review. No score was assigned to unresolved items.
            Provisional score for assessed portions: {attempt.provisionalScore} / {attempt.provisionalMaxMarks}
            {Number.isFinite(attempt.provisionalPercentage)
              ? ` (${Number(attempt.provisionalPercentage).toFixed(1)}%)`
              : ''}.
          </p>
        </div>
      )}
      {pending && <p role="status">Your answers are saved. Grading is pending or in progress.</p>}
      {status === 'failed' && (
        <div role="alert">
          <p>Your answers are saved, but grading could not be completed. Retry grading without retaking the test.</p>
          {retryError && <p>{retryError}</p>}
          {onRetryGrading && (
            <button type="button" onClick={onRetryGrading} disabled={retrying}>
              {retrying ? 'Retrying grading...' : 'Retry grading'}
            </button>
          )}
        </div>
      )}
      {status === 'pending' && onRetryGrading && (
        <button type="button" onClick={onRetryGrading} disabled={retrying}>
          {retrying ? 'Starting grading...' : 'Start grading'}
        </button>
      )}
      {legacy && attempt?.historicalScoreStatus === 'verified' && Number.isFinite(attempt?.score) && (
        <p className="cbt-result-summary">
          Historical score: {attempt.score} / {attempt.totalQuestions ?? questions.length}.
        </p>
      )}
      {legacy && attempt?.historicalScoreStatus === 'unverified' && (
        <p role="status">
          This historical score could not be verified and is excluded from current performance analytics.
        </p>
      )}
      {questions.length > 0 && (
        <ol className="cbt-result-question-list">
          {questions.map((question, index) => (
            <QuestionFeedback
              key={`${attempt._id}-${question.questionId || index}`}
              question={question}
              index={index}
              finalGrading={finalGrading}
            />
          ))}
        </ol>
      )}
    </section>
  )

  if (!collapsible) return results
  return (
    <details className="exam-history-details">
      <summary>Review your answers and feedback</summary>
      {results}
    </details>
  )
}
