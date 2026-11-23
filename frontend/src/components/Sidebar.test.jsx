// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

    fireEvent.click(screen.getByRole('link', { name: /Exam History/ }))
    expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.sidebar-panel').classList.contains('is-open')).toBe(false)
  })
})
