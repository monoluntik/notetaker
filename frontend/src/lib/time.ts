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

function plural(n: number, one: string, few: string, many: string): string {
  if (n % 10 === 1 && n % 100 !== 11) return one
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few
  return many
}

/**
 * Сколько осталось до начала: «через 1 час 5 минут». Считается от текущего момента, а не от
 * интервала напоминания (напоминание «за 1 день» могло сработать за 5 минут до начала). Тот же
 * формат, что в письме (backend: reminders.until_text).
 */
export function formatUntil(isoUtc: string, now: Date): string {
  const seconds = (DateTime.fromISO(isoUtc, { zone: 'utc' }).toMillis() - now.getTime()) / 1000
  if (seconds <= 0) return 'уже началась'
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'меньше чем через минуту'
  let days = Math.floor(minutes / 1440)
  let hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  let parts: [number, string, string, string][]
  if (days) {
    hours += Math.round(mins / 60)
    if (hours === 24) { days += 1; hours = 0 }
    parts = [[days, 'день', 'дня', 'дней'], [hours, 'час', 'часа', 'часов']]
  } else {
    parts = [[hours, 'час', 'часа', 'часов'], [mins, 'минуту', 'минуты', 'минут']]
  }
  return 'через ' + parts.filter(([n]) => n).map(([n, ...f]) => `${n} ${plural(n, ...f)}`).join(' ')
}
