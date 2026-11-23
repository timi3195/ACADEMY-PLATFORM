// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RouteScrollReset from './RouteScrollReset'

function NavigationControls() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/next')}>Push route</button>
      <button type="button" onClick={() => navigate(-1)}>Go back</button>
    </>
  )
}

function renderRouter(initialEntries, initialIndex) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <RouteScrollReset />
      <NavigationControls />
    </MemoryRouter>
  )
}

describe('RouteScrollReset', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('starts a directly loaded route at the top', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderRouter(['/deep/route'])
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('resets scroll for PUSH navigation', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderRouter(['/current'])
    fireEvent.click(screen.getByText('Push route'))
    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
  })

  it('leaves POP scroll restoration to the browser', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderRouter(['/previous', '/current'], 1)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Go back'))
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})
