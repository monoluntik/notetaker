import { describe, expect, it } from 'vitest'
import type { Occurrence } from '../api/types'
import { groupByLocalDate, moveTo, shiftAnchor, viewRange } from './calendar'

const occ = (start_at: string): Occurrence => ({
  note_id: 1, original_start: start_at, start_at, title: 't', body: '', is_active: true, timezone: 'UTC',
  tags: [], is_recurring: false, is_exception: false,
})

describe('calendar', () => {
  it('month grid starts on Monday and covers whole weeks', () => {
    const r = viewRange('month', '2026-11-15', 'UTC')
    expect(r.days[0].toISODate()).toBe('2026-10-26') // 1 ноября 2026 — воскресенье
    expect(r.days.at(-1)!.toISODate()).toBe('2026-12-06')
    expect(r.days.length % 7).toBe(0)
    expect(r.from).toBe('2026-10-26T00:00:00Z')
    expect(r.to).toBe('2026-12-07T00:00:00Z')
  })

  it('fetch window uses local midnight of the user timezone', () => {
    const r = viewRange('day', '2026-11-04', 'Asia/Almaty')
    expect(r.from).toBe('2026-11-03T19:00:00Z')
    expect(r.to).toBe('2026-11-04T19:00:00Z')
  })

  it('week over DST change has 7 local days', () => {
    const r = viewRange('week', '2026-11-01', 'America/New_York') // переход 1 ноября
    expect(r.days.map((d) => d.toISODate())).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(r.to).toBe('2026-11-02T05:00:00Z') // полночь по EST
  })

  it('groups occurrences by local date, not UTC date', () => {
    const g = groupByLocalDate([occ('2026-11-04T20:00:00Z'), occ('2026-11-04T10:00:00Z')], 'Asia/Tokyo')
    expect([...g.keys()].sort()).toEqual(['2026-11-04', '2026-11-05'])
  })

  it('moveTo keeps local time when changing the date', () => {
    expect(moveTo('2026-11-04T04:30:00Z', '2026-11-10', 'Asia/Almaty')).toBe('2026-11-10T04:30:00Z') // 09:30 местного
    expect(moveTo('2026-11-04T04:30:00Z', '2026-11-10', 'Asia/Almaty', 14)).toBe('2026-11-10T09:30:00Z')
    // через DST: 09:00 по Нью-Йорку остаётся 09:00
    expect(moveTo('2026-10-30T13:00:00Z', '2026-11-03', 'America/New_York')).toBe('2026-11-03T14:00:00Z')
  })

  it('shifts anchor by view unit', () => {
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftAnchor('week', '2026-11-04', -1)).toBe('2026-10-28')
    expect(shiftAnchor('day', '2026-12-31', 1)).toBe('2027-01-01')
  })
})
