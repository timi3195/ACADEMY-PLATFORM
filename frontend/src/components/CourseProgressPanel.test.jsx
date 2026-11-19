import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CourseProgressPanel from './CourseProgressPanel'

const renderPanel = (props) => renderToStaticMarkup(
  <CourseProgressPanel {...props} />
)

describe('CourseProgressPanel', () => {
  it('shows a useful empty state without inventing a percentage', () => {
    const markup = renderPanel({
      progress: {
        completedCount: 0,
        availableMaterialCount: 0,
        unavailableMaterialCount: 0,
        completionPercentage: null
      },
      loading: false
    })

    expect(markup).toContain('No available materials to track yet')
    expect(markup).not.toContain('%')
  })

  it('explains completion percentage and excludes unavailable materials', () => {
    const markup = renderPanel({
      progress: {
        completedCount: 1,
        availableMaterialCount: 2,
        unavailableMaterialCount: 1,
        completionPercentage: 50
      },
      loading: false
    })

    expect(markup).toContain('1 of 2 available materials marked complete')
    expect(markup).toContain('(50%)')
    expect(markup).toContain('1 unavailable material(s) are excluded')
    expect(markup).toContain('does not indicate academic mastery')
  })

  it('offers retry when progress cannot be loaded', () => {
    const markup = renderPanel({
      progress: null,
      loading: false,
      error: 'Progress service unavailable',
      onRetry: vi.fn()
    })

    expect(markup).toContain('Progress service unavailable')
    expect(markup).toContain('Try again')
  })
})
