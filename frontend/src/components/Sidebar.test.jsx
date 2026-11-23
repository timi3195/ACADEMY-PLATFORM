// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/auth', () => ({
  useAuth: () => ({ user: { role: 'student' }, logout: vi.fn() })
}))

import Sidebar from './Sidebar'

describe('Sidebar navigation', () => {
  afterEach(cleanup)

  it('opens and closes the mobile navigation and closes it after route selection', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.sidebar-panel').classList.contains('is-open')).toBe(true)

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' }))
      .getByRole('link', { name: /Exam History/ }))
    expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.sidebar-panel').classList.contains('is-open')).toBe(false)
  })

  it('shows common sections in mobile navigation and opens secondary destinations', () => {
    render(
      <MemoryRouter initialEntries={['/courses']}>
        <Sidebar />
      </MemoryRouter>
    )

    const mobileNavigation = within(screen.getByRole('navigation', { name: 'Mobile primary navigation' }))
    expect(mobileNavigation.getByRole('link', { name: /Courses/ }).getAttribute('aria-current')).toBe('page')
    expect(mobileNavigation.getByRole('link', { name: /Notes/ })).toBeTruthy()
    expect(mobileNavigation.getByRole('link', { name: /Exams/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open more navigation' }))
    expect(screen.getByRole('dialog', { name: 'More navigation' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Past Questions/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /CBT Practice/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'More navigation' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open more navigation' }))
  })
})
