import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { keys, useUpdateNote, useUpdateOccurrence, useUserTz } from '../api/hooks'
import type { Occurrence } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { groupByLocalDate, moveTo, rangeTitle, shiftAnchor, viewRange, type View } from '../lib/calendar'
import { formatTime } from '../lib/time'

const VIEWS: Record<View, string> = { month: 'Месяц', week: 'Неделя', day: 'День' }
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DND_TYPE = 'application/x-notetaker-occurrence'

export function CalendarPage() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const [params, setParams] = useSearchParams()
  const today = DateTime.now().setZone(tz).toISODate()!
  const view = (params.get('view') as View) ?? 'month'
  const anchor = params.get('date') ?? today
  const range = viewRange(view, anchor, tz)
  const [error, setError] = useState<string | null>(null)
  const moveNote = useUpdateNote()
  const moveOcc = useUpdateOccurrence()

  const { data: occs = [] } = useQuery({
    queryKey: [...keys.notes, 'occurrences', range.from, range.to],
    queryFn: () => api<Occurrence[]>(`/occurrences?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
    placeholderData: (prev) => prev,
  })
  const byDay = groupByLocalDate(occs, tz)

  const go = (patch: { view?: View; date?: string }) =>
    setParams({ view: patch.view ?? view, date: patch.date ?? anchor }, { replace: true })

  const openOcc = (o: Occurrence) =>
    open(o.is_recurring ? { kind: 'occurrence', noteId: o.note_id, originalStart: o.original_start } : { kind: 'note', noteId: o.note_id })

  async function drop(e: DragEvent, date: string, hour?: number) {
    e.preventDefault()
    e.currentTarget.classList.remove('drop-target')
    const raw = e.dataTransfer.getData(DND_TYPE)
    if (!raw) return
    const o = JSON.parse(raw) as Occurrence
    const start_at = moveTo(o.start_at, date, tz, hour)
    if (start_at === o.start_at) return
    setError(null)
    try {
      // Обычная заметка переносится целиком; у серии переносится только это вхождение (D5)
      if (o.is_recurring) await moveOcc.mutateAsync({ noteId: o.note_id, originalStart: o.original_start, start_at })
      else await moveNote.mutateAsync({ id: o.note_id, start_at })
    } catch (err) {
      setError(`Перенос невозможен: ${(err as Error).message}`)
    }
  }

  const dropProps = (date: string, hour?: number) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DND_TYPE)) { e.preventDefault(); e.currentTarget.classList.add('drop-target') } },
    onDragLeave: (e: DragEvent) => e.currentTarget.classList.remove('drop-target'),
    onDrop: (e: DragEvent) => drop(e, date, hour),
  })

  const Item = ({ o }: { o: Occurrence }) => (
    <button
      className={`cal-item ${o.is_active ? '' : 'inactive'}`}
      style={{ borderLeftColor: o.tags[0]?.color ?? '#94a3b8' }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData(DND_TYPE, JSON.stringify(o)); e.dataTransfer.effectAllowed = 'move' }}
      onClick={(e) => { e.stopPropagation(); openOcc(o) }}
      title={`${o.title}${o.is_recurring ? ' (повторяющаяся)' : ''}`}
    >
      <span className="cal-time">{formatTime(o.start_at, tz)}</span> {o.is_recurring && '↻ '}{o.title}
    </button>
  )

  const newAt = (date: string, hour = 9) =>
    open({ kind: 'new', startAt: DateTime.fromISO(date, { zone: tz }).set({ hour }).toUTC().toISO()! })

  return (
    <section>
      <div className="page-head cal-head">
        <div className="row">
          <button onClick={() => go({ date: shiftAnchor(view, anchor, -1) })} aria-label="Назад">←</button>
          <button onClick={() => go({ date: today })}>Сегодня</button>
          <button onClick={() => go({ date: shiftAnchor(view, anchor, 1) })} aria-label="Вперёд">→</button>
          <h1 className="cal-title">{rangeTitle(view, anchor)}</h1>
        </div>
        <div className="row segmented">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button key={v} className={v === view ? 'primary' : ''} onClick={() => go({ view: v })}>{VIEWS[v]}</button>
          ))}
        </div>
      </div>
      {error && <p className="error" role="alert">{error} <button className="icon" onClick={() => setError(null)}>×</button></p>}
      <p className="muted small">Нажмите на заметку, чтобы открыть; перетащите на другой день, чтобы перенести. Пустая ячейка — новая заметка.</p>

      {view === 'month' && (
        <div className="cal-month">
          {WEEKDAYS.map((d) => <div key={d} className="cal-wd">{d}</div>)}
          {range.days.map((d) => {
            const key = d.toISODate()!
            const items = byDay.get(key) ?? []
            return (
              <div key={key} data-date={key}
                className={`cal-cell ${d.month !== DateTime.fromISO(anchor).month ? 'other' : ''} ${key === today ? 'today' : ''}`}
                onClick={() => newAt(key)} {...dropProps(key)}>
                <div className="cal-daynum">{d.day}</div>
                {items.slice(0, 4).map((o) => <Item key={`${o.note_id}-${o.original_start}`} o={o} />)}
                {items.length > 4 && (
                  <button className="cal-more" onClick={(e) => { e.stopPropagation(); go({ view: 'day', date: key }) }}>
                    ещё {items.length - 4}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="cal-week">
          {range.days.map((d) => {
            const key = d.toISODate()!
            return (
              <div key={key} data-date={key} className={`cal-col ${key === today ? 'today' : ''}`} {...dropProps(key)}>
                <button className="cal-colhead" onClick={() => go({ view: 'day', date: key })}>
                  {WEEKDAYS[d.weekday - 1]} {d.toFormat('dd.MM')}
                </button>
                {(byDay.get(key) ?? []).map((o) => <Item key={`${o.note_id}-${o.original_start}`} o={o} />)}
                <button className="cal-add" onClick={() => newAt(key)}>+</button>
              </div>
            )
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="cal-day">
          {Array.from({ length: 24 }, (_, h) => {
            const items = (byDay.get(anchor) ?? []).filter((o) => DateTime.fromISO(o.start_at, { zone: 'utc' }).setZone(tz).hour === h)
            return (
              <div key={h} className="cal-hour" data-hour={h} {...dropProps(anchor, h)} onClick={() => newAt(anchor, h)}>
                <span className="cal-hourlabel">{String(h).padStart(2, '0')}:00</span>
                <div className="cal-hourItems">{items.map((o) => <Item key={`${o.note_id}-${o.original_start}`} o={o} />)}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
