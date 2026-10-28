import { describe, expect, it } from 'vitest'
import { formatTime, fromLocalInput, localDateToUtc, toLocalInput } from './time'

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
