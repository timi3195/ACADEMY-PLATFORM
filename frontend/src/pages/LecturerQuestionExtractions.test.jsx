import { describe, expect, it } from 'vitest'
import {
  getQuestionExtractionStatusLabel,
  isActiveQuestionExtractionBatch
} from './LecturerQuestionExtractions'

describe('question extraction worker status presentation', () => {
  it.each([
    [{ status: 'uploaded' }, 'Queued'],
    [{ status: 'queued' }, 'Queued'],
    [{ status: 'processing', processingStage: 'ocr' }, 'Processing OCR'],
    [{ status: 'processing', processingStage: 'structuring' }, 'Structuring'],
    [{ status: 'extracted', processingStage: 'structuring', processingRetryAfter: '2026-01-01T00:01:00Z' }, 'Structuring'],
    [{ status: 'extracted' }, 'OCR completed'],
    [{ status: 'needs_review' }, 'Needs Review'],
    [{ status: 'partially_failed' }, 'Partially Failed'],
    [{ status: 'failed' }, 'Failed'],
    [{ status: 'approved' }, 'Approved']
  ])('labels %s as %s', (batch, label) => {
    expect(getQuestionExtractionStatusLabel(batch)).toBe(label)
  })

  it('treats batches leased for structuring as active', () => {
    expect(isActiveQuestionExtractionBatch({ status: 'queued' })).toBe(true)
    expect(isActiveQuestionExtractionBatch({ status: 'processing' })).toBe(true)
    expect(isActiveQuestionExtractionBatch({
      status: 'extracted',
      processingStage: 'structuring',
      processingRetryAfter: '2026-01-01T00:01:00Z'
    })).toBe(true)
    expect(isActiveQuestionExtractionBatch({ status: 'extracted' })).toBe(false)
    expect(isActiveQuestionExtractionBatch({ status: 'needs_review' })).toBe(false)
    expect(isActiveQuestionExtractionBatch({ status: 'failed' })).toBe(false)
  })
})
