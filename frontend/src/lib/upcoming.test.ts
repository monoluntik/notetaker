import { describe, expect, it } from 'vitest'
import type { Occurrence, Upcoming } from '../api/types'
import { isStale, recategorize } from './upcoming'

const occ = (title: string, start_at: string, is_active = true): Occurrence => ({
  note_id: 1, original_start: start_at, start_at, title, body: '', is_active, timezone: 'UTC',
  tags: [], is_recurring: false, is_exception: false, note_version: 1,
})

const data: Upcoming = {
  now: '2026-11-04T09:00:00Z',
  timezone: 'UTC',
  day_end: '2026-11-05T00:00:00Z',
  week_end: '2026-11-09T00:00:00Z',
  today: [occ('meeting', '2026-11-04T10:00:00Z'), occ('inactive', '2026-11-04T10:00:00Z', false)],
  week: [occ('friday', '2026-11-06T10:00:00Z')],
  overdue: [occ('yesterday', '2026-11-03T10:00:00Z')],
  overdue_total: 120, // сервер вернул 1 из 120
  today_total: 2,
  week_total: 1,
}

const names = (s: Occurrence[]) => s.map((o) => o.title)

describe('recategorize', () => {
  it('keeps server categories before the time passes', () => {
    const s = recategorize(data, new Date('2026-11-04T09:59:00Z'))
    expect(names(s.today)).toEqual(['meeting', 'inactive'])
    expect(names(s.overdue)).toEqual(['yesterday'])
    expect(s.overdueTotal).toBe(120)
  })

  it('moves an active note to overdue once its time passes, without refetch', () => {
    const s = recategorize(data, new Date('2026-11-04T10:00:01Z'))
    expect(names(s.today)).toEqual([])
    expect(names(s.overdue)).toEqual(['meeting', 'yesterday']) // неактивная не попадает в прошедшие
    expect(s.overdueTotal).toBe(121)
    expect(names(s.week)).toEqual(['friday'])
  })

  it('detects a new day', () => {
    expect(isStale(data, new Date('2026-11-04T23:59:59Z'))).toBe(false)
    expect(isStale(data, new Date('2026-11-05T00:00:00Z'))).toBe(true)
  })
})
