import React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./components/PDFViewer', () => ({ default: () => null }))

import App from './App'

describe('admin route access', () => {
  it('keeps the admin dashboard and existing content route behind AdminOnly', () => {
    const routes = React.Children.toArray(App().props.children.props.children)

    for (const path of ['/admin', '/admin/content', '/admin/questions', '/admin/questions/:questionId/edit']) {
      const route = routes.find((candidate) => candidate.props.path === path)
      expect(route).toBeDefined()
      expect(route.props.element.type.name).toBe('AdminOnly')
    }

    expect(routes.some((route) => route.props.path?.startsWith('/lecturer'))).toBe(false)
  })
})
