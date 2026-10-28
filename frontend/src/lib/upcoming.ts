import type { Occurrence, Upcoming } from '../api/types'

export interface Sections {
  today: Occurrence[]
  week: Occurrence[]
  overdue: Occurrence[]
}

/**
 * Пересчитывает разделы «Предстоящих» для текущего момента без запроса к серверу:
 * вхождение, время которого наступило, переезжает в «прошедшие» (если активно).
 * Серверные границы суток/недели (в TZ пользователя) сохраняются.
 */
export function recategorize(data: Upcoming, now: Date): Sections {
  const t = now.getTime()
  const dayEnd = Date.parse(data.day_end)
  const weekEnd = Date.parse(data.week_end)
  const all = [...data.overdue, ...data.today, ...data.week]
  const ts = (o: Occurrence) => Date.parse(o.start_at)
  return {
    today: all.filter((o) => ts(o) >= t && ts(o) < dayEnd).sort((a, b) => ts(a) - ts(b)),
    week: all.filter((o) => ts(o) >= dayEnd && ts(o) < weekEnd).sort((a, b) => ts(a) - ts(b)),
    overdue: all.filter((o) => ts(o) < t && o.is_active).sort((a, b) => ts(b) - ts(a)),
  }
}

/** Данные устарели: наступили новые сутки — нужен новый запрос к серверу. */
export function isStale(data: Upcoming, now: Date): boolean {
  return now.getTime() >= Date.parse(data.day_end)
}
