import { afterEach, describe, expect, it } from 'vitest'
import {
  buildChatRequest,
  formatLearningPathDate,
  getChatConversationId
} from './AI'

describe('AI page chat and Learning Path helpers', () => {
  it('retains the backend conversation ID and sends it with the next message', () => {
    const firstRequest = buildChatRequest({
      courseId: 'course-1',
      message: 'First question',
      conversationId: null
    })
    expect(firstRequest).toEqual({
      courseId: 'course-1',
      message: 'First question',
      conversationId: undefined
    })

    const retainedId = getChatConversationId({ conversationId: 'conversation-1' })
    expect(retainedId).toBe('conversation-1')
    expect(buildChatRequest({
      courseId: 'course-1',
      message: 'Follow-up question',
      conversationId: retainedId
    })).toEqual({
      courseId: 'course-1',
      message: 'Follow-up question',
      conversationId: 'conversation-1'
    })
  })

  it('retains the current conversation ID if a follow-up response omits it', () => {
    expect(getChatConversationId({}, 'conversation-1')).toBe('conversation-1')
  })

  it('formats UTC-midnight timestamps using their UTC calendar date', () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      expect(formatLearningPathDate('2026-11-14T00:00:00.000Z')).toContain('14')
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })
})
