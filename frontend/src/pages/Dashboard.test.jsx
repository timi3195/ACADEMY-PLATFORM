// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const { mockApiGet, mockFetchStudentAnalytics, mockUseAuth } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockFetchStudentAnalytics: vi.fn(),
  mockUseAuth: vi.fn()
}))

vi.mock('../utils/api', () => ({ apiGet: mockApiGet }))
vi.mock('../services/studentAnalyticsService', () => ({
  fetchStudentAnalytics: mockFetchStudentAnalytics
}))
vi.mock('../utils/auth', () => ({ useAuth: mockUseAuth }))

import Dashboard from './Dashboard'

const courses = [
  { _id: 'course-networking', title: 'Networking', code: 'NET101', creditUnits: 3 },
  { _id: 'course-databases', title: 'Databases', code: 'DB102', creditUnits: 4 }
]

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Dashboard />
      <CurrentPath />
    </MemoryRouter>
  )
}

describe('Dashboard course navigation', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { _id: 'student-1', name: 'Student User' } })
    mockApiGet.mockImplementation((path) => Promise.resolve(
      path === '/api/courses' ? { courses } : { files: [] }
    ))
    mockFetchStudentAnalytics.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it.each(courses)('opens the selected course $title', async (course) => {
    renderDashboard()

    const card = await screen.findByRole('link', { name: `Open ${course.title} course` })
    expect(card.getAttribute('href')).toBe(`/courses/${course._id}`)

    fireEvent.click(card)
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe(`/courses/${course._id}`)
    })
  })

  it('keeps course cards keyboard-focusable and the course-list action separate', async () => {
    renderDashboard()

    const card = await screen.findByRole('link', { name: 'Open Networking course' })
    card.focus()

    expect(document.activeElement).toBe(card)
    expect(card.querySelector('a, button')).toBeNull()

    const courseOverview = screen.getByText('Your Courses').parentElement
    fireEvent.click(within(courseOverview).getByRole('link', { name: 'More →' }))
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/courses')
    })
  })
})
