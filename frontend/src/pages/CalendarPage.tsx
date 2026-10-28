import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { type DragEvent, type ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiWithHeaders, isEditConflict } from '../api/client'
import { keys, useInvalidateAll, useUpdateNote, useUpdateOccurrence, useUserTz } from '../api/hooks'
import type { Occurrence } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { Segmented } from '../components/ui/controls'
import { useToast } from '../components/ui/feedback'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, Spinner } from '../components/ui/states'
import { groupByLocalDate, moveTo, rangeTitle, shiftAnchor, viewRange, type View } from '../lib/calendar'
import { formatTime } from '../lib/time'
import { useIsMobile } from '../lib/useMedia'

const VIEWS: [View, string][] = [['month', 'Месяц'], ['week', 'Неделя'], ['day', 'День']]
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DND_TYPE = 'application/x-notetaker-occurrence'
const occKey = (o: Occurrence) => `${o.note_id}-${o.original_start}`

export function CalendarPage() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const toast = useToast()
  const invalidate = useInvalidateAll()
  const isMobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const today = DateTime.now().setZone(tz).toISODate()!
  const view = (params.get('view') as View) ?? 'month'
  const anchor = params.get('date') ?? today
  const range = viewRange(view, anchor, tz)
  const moveNote = useUpdateNote()
  const moveOcc = useUpdateOccurrence()

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [...keys.notes, 'occurrences', range.from, range.to],
    queryFn: async () => {
      const r = await apiWithHeaders<Occurrence[]>(`/occurrences?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)
      return { items: r.data, truncated: r.headers.get('X-Truncated') === 'true', total: Number(r.headers.get('X-Total-Count') ?? 0) }
    },
    placeholderData: (prev) => prev,
  })
  const occs = data?.items ?? []
  const byDay = groupByLocalDate(occs, tz)

  const go = (patch: { view?: View; date?: string }) =>
    setParams({ view: patch.view ?? view, date: patch.date ?? anchor }, { replace: true })

  const openOcc = (o: Occurrence) =>
    open(o.is_recurring ? { kind: 'occurrence', noteId: o.note_id, originalStart: o.original_start } : { kind: 'note', noteId: o.note_id })

  const newAt = (date: string, hour = 9) =>
    open({ kind: 'new', startAt: DateTime.fromISO(date, { zone: tz }).set({ hour }).toUTC().toISO()! })

  async function drop(e: DragEvent, date: string, hour?: number) {
    e.preventDefault()
    e.currentTarget.classList.remove('drop-target')
    const raw = e.dataTransfer.getData(DND_TYPE)
    if (!raw) return
    const o = JSON.parse(raw) as Occurrence
    const start_at = moveTo(o.start_at, date, tz, hour)
    if (start_at === o.start_at) return
    try {
      // Обычная заметка переносится целиком; у серии — только это вхождение (D5).
      // Версия обязательна: если заметку изменили в другой вкладке, перенос отклоняется (D14).
      if (o.is_recurring) await moveOcc.mutateAsync({ noteId: o.note_id, originalStart: o.original_start, version: o.note_version, start_at })
      else await moveNote.mutateAsync({ id: o.note_id, version: o.note_version, start_at })
      toast(`«${o.title}» перенесена на ${DateTime.fromISO(start_at).setZone(tz).setLocale('ru').toFormat('d MMMM, HH:mm')}`)
    } catch (err) {
      invalidate()
      toast(isEditConflict(err) ? 'Заметку только что изменили в другой вкладке — календарь обновлён, повторите перенос'
        : `Перенос невозможен: ${(err as Error).message}`, 'error')
    }
  }

  const dropProps = (date: string, hour?: number) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DND_TYPE)) { e.preventDefault(); e.currentTarget.classList.add('drop-target') } },
    onDragLeave: (e: DragEvent) => e.currentTarget.classList.remove('drop-target'),
    onDrop: (e: DragEvent) => drop(e, date, hour),
  })

  const item = (o: Occurrence) => (
    <button key={occKey(o)} type="button" className={`cal-item ${o.is_active ? '' : 'inactive'}`}
      style={{ background: `${o.tags[0]?.color ?? '#64748b'}1a`, boxShadow: `inset 3px 0 0 ${o.tags[0]?.color ?? '#94a3b8'}` }}
      draggable={!isMobile}
      onDragStart={(e) => { e.dataTransfer.setData(DND_TYPE, JSON.stringify(o)); e.dataTransfer.effectAllowed = 'move' }}
      onClick={(e) => { e.stopPropagation(); openOcc(o) }}
      title={`${formatTime(o.start_at, tz)} ${o.title}${o.is_recurring ? ' (повторяющаяся)' : ''}${o.is_active ? '' : ' — неактивна'}`}
      aria-label={`${formatTime(o.start_at, tz)}, ${o.title}${o.is_recurring ? ', повторяющаяся' : ''}${o.is_active ? '' : ', неактивна'}`}>
      <span className="cal-time">{formatTime(o.start_at, tz)}</span>
      {o.is_recurring && <Icon name="repeat" />}
      <span className="t">{o.title}</span>
    </button>
  )

  const anchorMonth = DateTime.fromISO(anchor).month

  return (
    <>
      <div className="cal-toolbar">
        <h1 className="cal-title">{rangeTitle(view, anchor)}</h1>
        {(isLoading || isFetching) && <Spinner label="Загрузка календаря" />}
        <div className="cal-nav">
          <button className="btn btn-icon" onClick={() => go({ date: shiftAnchor(view, anchor, -1) })} aria-label="Предыдущий период"><Icon name="left" /></button>
          <button className="btn" onClick={() => go({ date: today })}>Сегодня</button>
          <button className="btn btn-icon" onClick={() => go({ date: shiftAnchor(view, anchor, 1) })} aria-label="Следующий период"><Icon name="right" /></button>
        </div>
        <Segmented label="Вид календаря" value={view} options={VIEWS} onChange={(v) => go({ view: v })} />
      </div>
      {!isMobile && <p className="cal-hint">Нажмите на заметку, чтобы открыть; перетащите её на другой день, чтобы перенести. Клик по пустому месту — новая заметка.</p>}
      {error && <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>}
      {data?.truncated && (
        <div className="banner banner-warn" role="status">
          <Icon name="info" />
          <div>В этом периоде {data.total ? `${data.total} вхождений` : 'слишком много вхождений'} — показаны первые {occs.length}.
            Переключитесь на неделю или день, чтобы увидеть все.</div>
        </div>
      )}

      {isMobile ? (
        <MobileCalendar view={view} anchor={anchor} today={today} days={range.days.map((d) => d.toISODate()!)} byDay={byDay} anchorMonth={anchorMonth}
          onSelect={(d) => go({ date: d })} item={item} onNew={newAt} />
      ) : view === 'month' ? (
        <div className="cal-month" role="grid" aria-label="Месяц">
          {WEEKDAYS.map((d) => <div key={d} className="cal-wd" role="columnheader">{d}</div>)}
          {range.days.map((d) => {
            const key = d.toISODate()!
            const items = byDay.get(key) ?? []
            return (
              <div key={key} data-date={key} role="gridcell"
                className={`cal-cell ${d.month !== anchorMonth ? 'other' : ''} ${key === today ? 'today' : ''}`}
                onClick={() => newAt(key)} {...dropProps(key)}>
                <button type="button" className="cal-daynum" onClick={(e) => { e.stopPropagation(); go({ view: 'day', date: key }) }}
                  aria-label={`${d.setLocale('ru').toFormat('d MMMM')}: ${items.length} заметок, открыть день`}>{d.day}</button>
                {items.slice(0, 3).map(item)}
                {items.length > 3 && (
                  <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); go({ view: 'day', date: key }) }}>ещё {items.length - 3}</button>
                )}
              </div>
            )
          })}
        </div>
      ) : view === 'week' ? (
        <div className="cal-week">
          {range.days.map((d) => {
            const key = d.toISODate()!
            const items = byDay.get(key) ?? []
            return (
              <div key={key} data-date={key} className={`cal-col ${key === today ? 'today' : ''}`} {...dropProps(key)}>
                <button type="button" className="cal-colhead" onClick={() => go({ view: 'day', date: key })}>
                  <span className="wd">{WEEKDAYS[d.weekday - 1]}</span><span className="dn">{d.day}</span>
                </button>
                {items.map(item)}
                <button type="button" className="btn btn-ghost btn-sm cal-add" onClick={() => newAt(key)} aria-label={`Новая заметка на ${d.setLocale('ru').toFormat('d MMMM')}`}>
                  <Icon name="plus" />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="cal-day" data-date={anchor}>
          {Array.from({ length: 24 }, (_, h) => {
            const items = (byDay.get(anchor) ?? []).filter((o) => DateTime.fromISO(o.start_at, { zone: 'utc' }).setZone(tz).hour === h)
            return (
              <div key={h} className="cal-hour" data-hour={h} {...dropProps(anchor, h)} onClick={() => newAt(anchor, h)}>
                <span className="cal-hourlabel">{String(h).padStart(2, '0')}:00</span>
                <div className="cal-hour-items">{items.map(item)}</div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Телефон: месяц — сетка с точками и повестка выбранного дня; неделя/день — повестка по дням. */
function MobileCalendar({ view, anchor, today, days, byDay, anchorMonth, onSelect, item, onNew }: {
  view: View; anchor: string; today: string; days: string[]; byDay: Map<string, Occurrence[]>; anchorMonth: number
  onSelect: (d: string) => void; item: (o: Occurrence) => ReactElement; onNew: (date: string) => void
}) {
  const agendaDays = view === 'month' ? [anchor] : days
  return (
    <div className="mcal">
      {view === 'month' && (
        <div className="mcal-grid" role="grid" aria-label="Месяц">
          {WEEKDAYS.map((d) => <div key={d} className="mcal-wd" role="columnheader">{d}</div>)}
          {days.map((key) => {
            const d = DateTime.fromISO(key)
            const items = byDay.get(key) ?? []
            return (
              <button key={key} type="button" data-date={key} role="gridcell"
                className={`mcal-day ${d.month !== anchorMonth ? 'other' : ''} ${key === today ? 'today' : ''}`}
                aria-pressed={key === anchor} onClick={() => onSelect(key)}
                aria-label={`${d.setLocale('ru').toFormat('d MMMM')}: ${items.length ? `${items.length} заметок` : 'нет заметок'}`}>
                {d.day}
                <span className="mcal-dots" aria-hidden>
                  {items.slice(0, 3).map((o) => <span key={occKey(o)} style={{ background: o.tags[0]?.color ?? 'var(--text-3)' }} />)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {agendaDays.map((key) => {
        const d = DateTime.fromISO(key).setLocale('ru')
        const items = byDay.get(key) ?? []
        return (
          <section key={key} className="agenda-day" data-date={key} aria-label={d.toFormat('cccc, d MMMM')}>
            <div className={`agenda-day-head ${key === today ? 'today' : ''}`}>
              <h3>{d.toFormat('cccc, d MMMM')}{key === today && ' · сегодня'}</h3>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => onNew(key)} aria-label={`Новая заметка на ${d.toFormat('d MMMM')}`}>
                <Icon name="plus" />
              </button>
            </div>
            {items.length ? <div className="stack" style={{ gap: 6 }}>{items.map(item)}</div>
              : view === 'month' ? <div className="card"><EmptyState icon="calendar" title="В этот день заметок нет" /></div>
              : <p className="muted small">Нет заметок</p>}
          </section>
        )
      })}
    </div>
  )
}
