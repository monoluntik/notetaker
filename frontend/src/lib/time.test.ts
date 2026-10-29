import { describe, expect, it } from 'vitest'
import { formatTime, formatUntil, fromLocalInput, localDateToUtc, toLocalInput } from './time'

describe('time helpers', () => {
  it('round-trips local input through a timezone', () => {
    const utc = fromLocalInput('2026-11-02T15:00', 'Asia/Almaty') // UTC+5 с 2024 г.
    expect(utc).toBe('2026-11-02T10:00:00Z')
    expect(toLocalInput(utc, 'Asia/Almaty')).toBe('2026-11-02T15:00')
  })

  it('same instant is shown differently in different zones', () => {
    const iso = '2026-01-15T23:30:00Z'
    expect(formatTime(iso, 'UTC')).toBe('23:30')
    expect(formatTime(iso, 'Asia/Tokyo')).toBe('08:30')
    expect(toLocalInput(iso, 'Asia/Tokyo')).toBe('2026-01-16T08:30') // другая дата
  })

  it('local day boundaries respect DST', () => {
    // 8 марта 2026 в Нью-Йорке переход на летнее время: сутки длятся 23 часа
    expect(localDateToUtc('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00Z')
    expect(localDateToUtc('2026-03-08', 'America/New_York', true)).toBe('2026-03-09T04:00:00Z')
  })
})

describe('formatUntil', () => {
  const now = new Date('2026-11-04T09:55:00Z')
  const at = (sec: number) => new Date(now.getTime() + sec * 1000).toISOString()
  it.each([
    [-1, 'уже началась'],
    [20, 'меньше чем через минуту'],
    [5 * 60, 'через 5 минут'],
    [9 * 60 + 53, 'через 10 минут'],
    [60, 'через 1 минуту'],
    [22 * 60, 'через 22 минуты'],
    [3600 + 5 * 60, 'через 1 час 5 минут'],
    [86400 + 5 * 3600 + 40 * 60, 'через 1 день 6 часов'],
    [2 * 86400 - 10 * 60, 'через 2 дня'],
  ])('%i s → %s', (sec, expected) => {
    expect(formatUntil(at(sec), now)).toBe(expected)
  })
})
