import { DateTime } from 'luxon'

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm"

/** UTC ISO → значение для <input type="datetime-local"> в часовом поясе tz. */
export function toLocalInput(isoUtc: string, tz: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(tz).toFormat(INPUT_FMT)
}

/** Значение <input type="datetime-local">, понимаемое как время в tz → UTC ISO. */
export function fromLocalInput(local: string, tz: string): string {
  const dt = DateTime.fromFormat(local, INPUT_FMT, { zone: tz })
  if (!dt.isValid) throw new Error('Некорректная дата')
  return dt.toUTC().toISO({ suppressMilliseconds: true })!
}

export function inZone(isoUtc: string, tz: string): DateTime {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(tz)
}

export function formatDateTime(isoUtc: string, tz: string): string {
  return inZone(isoUtc, tz).setLocale('ru').toFormat('d MMM yyyy, HH:mm')
}

export function formatTime(isoUtc: string, tz: string): string {
  return inZone(isoUtc, tz).toFormat('HH:mm')
}

/** Начало локального дня в tz → UTC ISO (для фильтров периода). */
export function localDateToUtc(date: string, tz: string, endExclusive = false): string {
  let dt = DateTime.fromISO(date, { zone: tz }).startOf('day')
  if (endExclusive) dt = dt.plus({ days: 1 })
  return dt.toUTC().toISO({ suppressMilliseconds: true })!
}
