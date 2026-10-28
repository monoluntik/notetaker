import { DateTime } from 'luxon'
import type { Occurrence } from '../api/types'

export type View = 'month' | 'week' | 'day'

export interface Range {
  days: DateTime[] // локальные дни (начало суток в tz)
  from: string // UTC ISO, включительно
  to: string // UTC ISO, не включительно
}

const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!

/** Дни, которые показывает вид, и окно запроса вхождений. Неделя начинается с понедельника. */
export function viewRange(view: View, anchor: string, tz: string): Range {
  const a = DateTime.fromISO(anchor, { zone: tz }).startOf('day')
  let start: DateTime
  let count: number
  if (view === 'day') {
    start = a
    count = 1
  } else if (view === 'week') {
    start = a.startOf('week') // luxon: неделя ISO, с понедельника
    count = 7
  } else {
    const first = a.startOf('month')
    start = first.startOf('week')
    const end = first.endOf('month').endOf('week')
    count = Math.round(end.startOf('day').diff(start, 'days').days) + 1
  }
  // Сутки считаем через plus({days}) по календарю пояса: при DST сутки бывают 23/25 часов
  const days = Array.from({ length: count }, (_, i) => start.plus({ days: i }))
  return { days, from: iso(start), to: iso(start.plus({ days: count })) }
}

export function shiftAnchor(view: View, anchor: string, dir: -1 | 1): string {
  const a = DateTime.fromISO(anchor)
  const unit = view === 'month' ? { months: dir } : view === 'week' ? { weeks: dir } : { days: dir }
  return a.plus(unit).toISODate()!
}

export function groupByLocalDate(occs: Occurrence[], tz: string): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>()
  for (const o of occs) {
    const key = DateTime.fromISO(o.start_at, { zone: 'utc' }).setZone(tz).toISODate()!
    const list = map.get(key) ?? []
    list.push(o)
    map.set(key, list)
  }
  return map
}

/** Перенос на другую дату с сохранением локального времени (и, если задан, на другой час). */
export function moveTo(startUtc: string, targetDate: string, tz: string, hour?: number): string {
  const local = DateTime.fromISO(startUtc, { zone: 'utc' }).setZone(tz)
  const target = DateTime.fromISO(targetDate, { zone: tz }).set({
    hour: hour ?? local.hour,
    minute: local.minute,
  })
  return iso(target)
}

export function rangeTitle(view: View, anchor: string): string {
  const a = DateTime.fromISO(anchor).setLocale('ru')
  if (view === 'month') return a.toFormat('LLLL yyyy')
  if (view === 'day') return a.toFormat('cccc, d MMMM yyyy')
  const s = a.startOf('week')
  const e = s.plus({ days: 6 })
  return `${s.toFormat('d MMM')} – ${e.toFormat('d MMM yyyy')}`
}
