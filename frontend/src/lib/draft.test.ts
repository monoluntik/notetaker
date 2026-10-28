import { describe, expect, it } from 'vitest'
import { changedFields, isDirty, rebaseDraft } from './draft'

const base = { title: 'План', body: 'текст', tags: [1], active: true }

describe('draft', () => {
  it('detects changed fields', () => {
    expect(isDirty(base, { ...base })).toBe(false)
    expect(changedFields(base, { ...base, title: 'Новый', tags: [1, 2] })).toEqual(['title', 'tags'])
  })

  it('rebases my edits onto the fresh server version without losing either side', () => {
    const mine = { ...base, body: 'мой текст' } // я поменял текст
    const fresh = { ...base, title: 'Заголовок из вкладки A' } // в другой вкладке поменяли заголовок
    const r = rebaseDraft(base, mine, fresh)
    expect(r.draft).toEqual({ ...base, title: 'Заголовок из вкладки A', body: 'мой текст' })
    expect(r.overlapping).toEqual([])
  })

  it('reports fields changed on both sides (my value is kept for review)', () => {
    const r = rebaseDraft(base, { ...base, title: 'Мой' }, { ...base, title: 'Их', active: false })
    expect(r.draft).toEqual({ ...base, title: 'Мой', active: false })
    expect(r.overlapping).toEqual(['title'])
  })

  it('identical edits on both sides are not a conflict', () => {
    expect(rebaseDraft(base, { ...base, title: 'X' }, { ...base, title: 'X' }).overlapping).toEqual([])
  })
})
