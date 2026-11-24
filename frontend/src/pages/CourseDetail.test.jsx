// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '../utils/api'

vi.mock('../utils/api', () => ({
  apiGet: vi.fn()
}))

vi.mock('../utils/auth', () => ({
  useAuth: () => ({
    user: {
      _id: '507f1f77bcf86cd799439011',
      role: 'student',
      department: '507f1f77bcf86cd799439031'
    }
  })
}))

vi.mock('../hooks/useCourseMaterialProgress', () => ({
  default: () => ({
    progress: null,
    loading: false,
    savingMaterialId: null,
    error: '',
    updateCompletion: vi.fn(),
    retry: vi.fn()
  })
}))

vi.mock('../components/PDFViewer', () => ({
  default: ({ pastQuestionPaperId }) => <div data-testid="paper-preview">{pastQuestionPaperId}</div>
}))

import CourseDetail from './CourseDetail'

const COURSE_ID = '507f1f77bcf86cd799439021'
const COURSE = {
  _id: COURSE_ID,
  title: 'Internet of Things',
  code: 'NCC424',
  department: { _id: '507f1f77bcf86cd799439031', name: 'Computing' },
  lecturers: [],
  level: 'ND2',
  semester: 'First',
  creditUnits: 3
}

describe('CourseDetail past-question papers', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('requests and displays uploaded papers for the selected course and year', async () => {
    const examinationYear = String(new Date().getFullYear() - 1)
    const otherYear = String(new Date().getFullYear() - 2)
    apiGet.mockImplementation(async (path) => {
      if (path === `/api/courses/${COURSE_ID}`) return { course: COURSE }
      if (path === `/api/files/course/${COURSE_ID}`) return { files: [] }
      if (path.startsWith('/api/files/past-questions?')) {
        return {
          papers: [
            { _id: 'paper-current', title: 'Uploaded paper', originalName: 'paper.pdf', level: 'ND2', semester: 'First', examinationYear },
            { _id: 'paper-other-year', title: 'Other year paper', originalName: 'other.png', level: 'ND2', semester: 'First', examinationYear: otherYear }
          ]
        }
      }
      return { questions: [{ _id: 'cbt-question', question: 'Not an uploaded paper' }] }
    })

    render(
      <MemoryRouter initialEntries={[`/courses/${COURSE_ID}`]}>
        <Routes>
          <Route path="/courses/:courseId" element={<CourseDetail />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByRole('button', { name: /Past Questions/ }))
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: examinationYear }
    })

    expect(await screen.findByText('Uploaded paper')).toBeTruthy()
    expect(screen.queryByText('Other year paper')).toBeNull()
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        `/api/files/past-questions?course=${COURSE_ID}&examinationYear=${examinationYear}`
      )
    })
    expect(apiGet.mock.calls.some(([path]) => path.startsWith('/api/questions/course/'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open Past Question' }))
    expect((await screen.findByTestId('paper-preview')).textContent).toBe('paper-current')
  })
})
