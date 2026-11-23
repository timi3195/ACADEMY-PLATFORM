import React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./components/PDFViewer', () => ({ default: () => null }))

import App from './App'

const getRoutes = () => {
  let routesElement
  const visit = (element) => {
    React.Children.forEach(element, (child) => {
      if (routesElement || !React.isValidElement(child)) return
      if (child.type.name === 'Routes') {
        routesElement = child
        return
      }
      visit(child.props.children)
    })
  }
  visit(App())
  return React.Children.toArray(routesElement.props.children)
}

describe('admin route access', () => {
  it('keeps the admin dashboard and existing content route behind AdminOnly', () => {
    const routes = getRoutes()

    for (const path of ['/admin', '/admin/content', '/admin/questions', '/admin/questions/:questionId/edit']) {
      const route = routes.find((candidate) => candidate.props.path === path)
      expect(route).toBeDefined()
      expect(route.props.element.type.name).toBe('AdminOnly')
    }

    expect(routes.some((route) => route.props.path?.startsWith('/lecturer'))).toBe(false)
  })
})
