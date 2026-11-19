import React from 'react'
import { Children } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StudentLearningRecommendationsView } from './AnalyticsDashboard'

const COURSE_ID = '507f1f77bcf86cd799439021'
const MATERIAL_ID = '507f1f77bcf86cd799439031'

const renderRecommendations = (props) => renderToStaticMarkup(
  <MemoryRouter>
    <StudentLearningRecommendationsView {...props} />
  </MemoryRouter>
)

const findElement = (element, type) => {
  if (!element || typeof element !== 'object') return null
  if (element.type === type) return element
  for (const child of Children.toArray(element.props?.children)) {
    const found = findElement(child, type)
    if (found) return found
  }
  return null
}

const materialCandidate = (overrides = {}) => ({
  candidateId: `material:${COURSE_ID}:${MATERIAL_ID}:revisit`,
  kind: 'study_material',
  course: { courseId: COURSE_ID, title: 'Networking', code: 'NET101' },
  action: {
    type: 'revisit_material',
    materialId: MATERIAL_ID,
    title: 'Routing',
    materialType: 'Lecture Note'
  },
  reason: 'Verified results show Routing needs attention.',
  evidence: {
    category: 'verified_topic_performance',
    sufficiency: 'sufficient',
    topic: 'Routing'
  },
  ...overrides
})

describe('StudentLearningRecommendationsView', () => {
  it('shows a loading state and disables refresh while loading', () => {
    const markup = renderRecommendations({ loading: true, onRefresh: vi.fn() })
    expect(markup).toContain('Loading your study recommendations')
    expect(markup).toContain('disabled=""')
  })

  it('wires the refresh button to the provided retry action', () => {
    const onRefresh = vi.fn()
    const tree = StudentLearningRecommendationsView({ onRefresh })
    findElement(tree, 'button').props.onClick()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it.each(['ai_prioritized', 'deterministic_fallback'])(
    'displays recommendations normally for %s output without technical fields',
    (prioritizationStatus) => {
      const markup = renderRecommendations({
        prioritizationStatus,
        recommendations: [materialCandidate()]
      })
      expect(markup).toContain('Your Personalized Study Recommendations')
      expect(markup).toContain('Networking (NET101)')
      expect(markup).toContain('Verified results show Routing needs attention.')
      expect(markup).toContain('Based on verified CBT performance')
      expect(markup).not.toContain('ai_prioritized')
      expect(markup).not.toContain('deterministic_fallback')
      expect(markup).not.toContain('candidateId')
      expect(markup).not.toContain('evidenceFingerprint')
    }
  )

  it('explains insufficient evidence as general guidance, not poor performance', () => {
    const markup = renderRecommendations({
      recommendations: [materialCandidate({
        reason: 'There is not enough verified CBT evidence for topic-specific guidance.',
        evidence: { category: 'insufficient_cbt_evidence', sufficiency: 'insufficient' }
      })]
    })
    expect(markup).toContain('General study guidance')
    expect(markup).toContain('Not enough verified performance evidence')
    expect(markup).not.toContain('poor performance')
    expect(markup).not.toContain('needs improvement')
  })

  it('shows empty, no-material, and no-practice states without fabricated actions', () => {
    const emptyMarkup = renderRecommendations({ recommendations: [] })
    expect(emptyMarkup).toContain('No study actions are available right now.')
    expect(emptyMarkup).toContain('Browse your courses')

    const noActionsMarkup = renderRecommendations({ recommendations: [materialCandidate()] })
    expect(noActionsMarkup).toContain('No eligible practice-test action is available')
    expect(noActionsMarkup).not.toContain('Start practice test')
  })

  it('links to the exact accessible material and the supported CBT course and length', () => {
    const practiceCandidate = {
      candidateId: `practice:${COURSE_ID}:10`,
      kind: 'practice_test',
      course: { courseId: COURSE_ID, title: 'Networking', code: 'NET101' },
      action: { type: 'start_practice_test', questionCount: 10 },
      reason: 'An eligible course-wide practice test is available.',
      evidence: {
        category: 'practice_coverage',
        sufficiency: 'sufficient',
        supportedTestSizes: [10, 20]
      }
    }
    const markup = renderRecommendations({
      recommendations: [materialCandidate(), practiceCandidate]
    })
    expect(markup).toContain(
      `/courses/${COURSE_ID}/materials?materialId=${MATERIAL_ID}`
    )
    expect(markup).toContain(
      `/cbt?courseId=${COURSE_ID}&amp;questionCount=10`
    )
    expect(markup).toContain('Start 10-question practice test')
  })

  it('shows guidance without a misleading action when a destination is missing or unsupported', () => {
    const missingMaterial = materialCandidate({
      course: { courseId: 'not-a-course-id', title: 'Networking' }
    })
    const unsupportedPractice = {
      candidateId: `practice:${COURSE_ID}:15`,
      course: { courseId: COURSE_ID, title: 'Networking' },
      action: { type: 'start_practice_test', questionCount: 15 },
      reason: 'Review the course before practising.',
      evidence: { category: 'practice_coverage', supportedTestSizes: [10] }
    }
    const markup = renderRecommendations({
      recommendations: [missingMaterial, unsupportedPractice]
    })
    expect(markup).toContain('Review the course before practising.')
    expect(markup).not.toContain('materials?materialId=')
    expect(markup).not.toContain('questionCount=15')
  })

  it('shows a safe API error and retry control', () => {
    const markup = renderRecommendations({
      error: true,
      onRefresh: vi.fn()
    })
    expect(markup).toContain('We couldn’t load your recommendations.')
    expect(markup).toContain('Try again')
    expect(markup).not.toContain('provider details')
  })
})
