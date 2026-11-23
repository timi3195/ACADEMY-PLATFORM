// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'

vi.mock('../utils/api', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn()
}))

import ManualQuestionEditor from './ManualQuestionEditor'

const course = {
  _id: '507f1f77bcf86cd799439021',
  code: 'MAT101',
  title: 'Mathematics',
  level: 'ND1',
  semester: 'First'
}

const sourcePaper = {
  _id: '507f1f77bcf86cd799439023',
  title: 'MAT101 past paper',
  examinationYear: '2024',
  level: 'ND1',
  semester: 'First'
}

const renderEditor = () => render(
  <MemoryRouter initialEntries={['/admin/questions']}>
    <Routes>
      <Route path="/admin/questions" element={<ManualQuestionEditor />} />
    </Routes>
  </MemoryRouter>
)

describe('manual question editor', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    apiGet.mockImplementation(async (path) => {
      if (path === '/api/questions?all=true') return { questions: [] }
      if (path === '/api/question-extractions/courses') return { courses: [course] }
      if (path.includes('/source-papers?')) return { papers: [sourcePaper] }
      throw new Error(`Unexpected request: ${path}`)
    })
    apiPost.mockResolvedValue({
      question: { _id: 'created-question' },
      markingStatus: 'ready',
      markingVersion: 'marking-version'
    })
    apiPut.mockResolvedValue({ question: { _id: 'edited-question' } })
    apiDelete.mockResolvedValue({ success: true })
  })

  it('saves an incomplete multiple-choice question as a draft without publishing', async () => {
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Subject / course'), { target: { value: course._id } })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Algebra' } })
    fireEvent.change(screen.getByLabelText('Question text'), { target: { value: 'Solve x + 2 = 4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0][1].approvalStatus).toBe('draft')
    expect(apiPost.mock.calls[0][1].options).toEqual([])
    expect((await screen.findByRole('status')).textContent).toContain('Question saved as a draft.')
  })

  it('prevents incomplete publication and supports adding/removing options and selecting the answer', async () => {
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Subject / course'), { target: { value: course._id } })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Algebra' } })
    fireEvent.change(screen.getByLabelText('Question text'), { target: { value: 'Solve x + 2 = 4' } })

    fireEvent.click(screen.getByRole('button', { name: 'Publish question' }))
    expect(await screen.findByText('Add at least 2 answer options before publishing.')).toBeTruthy()
    expect(apiPost).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }))
    expect(screen.getByLabelText('Option E')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove option E' }))
    expect(screen.queryByLabelText('Option E')).toBeNull()
    fireEvent.change(screen.getByLabelText('Correct answer'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview question' }))
    expect(screen.getByLabelText('Question preview')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish question' }))
    expect(await screen.findByText('Select an uploaded source paper before publishing.')).toBeTruthy()
    expect(apiPost).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.getByRole('option', { name: /MAT101 past paper/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Uploaded source paper'), {
      target: { value: sourcePaper._id }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish question' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0][1].approvalStatus).toBe('approved')
    expect(apiPost.mock.calls[0][1].answer).toBe('2')
    expect(apiPost.mock.calls[0][1].sourcePaperId).toBe(sourcePaper._id)
    expect(await screen.findByText('Question published and CBT marking is ready.')).toBeTruthy()
  })

  it('publishes an original practice question without past-paper provenance', async () => {
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Subject / course'), { target: { value: course._id } })
    fireEvent.change(screen.getByLabelText('Question origin'), { target: { value: 'original_practice' } })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Networks' } })
    fireEvent.change(screen.getByLabelText('Question text'), { target: { value: 'What is a computer network?' } })
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'Connected devices' } })
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'A single isolated device' } })
    fireEvent.change(screen.getByLabelText('Correct answer'), { target: { value: 'Connected devices' } })

    expect(screen.queryByLabelText('Uploaded source paper')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Publish question' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    const payload = apiPost.mock.calls[0][1]
    expect(payload.questionOrigin).toBe('original_practice')
    expect(payload.approvalStatus).toBe('approved')
    expect(payload.sourcePaperId).toBe('')
    expect(payload.batchId).toBe('')
    expect(payload.sourcePage).toBeNull()
    expect(payload.sourceExcerpt).toBe('')
    expect(await screen.findByText('Question published and CBT marking is ready.')).toBeTruthy()
  })
})
