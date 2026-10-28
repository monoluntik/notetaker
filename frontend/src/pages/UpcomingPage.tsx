import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { keys, useUserTz } from '../api/hooks'
import type { Occurrence, Upcoming } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { TagChip } from '../components/TagChip'
import { formatDateTime, formatTime } from '../lib/time'
import { isStale, recategorize } from '../lib/upcoming'

const TICK_MS = 15_000

export function UpcomingPage() {
  const tz = useUserTz()
  const { data, refetch } = useQuery({
    queryKey: [...keys.notes, 'upcoming'],
    queryFn: () => api<Upcoming>('/upcoming'),
    refetchInterval: 5 * 60_000,
  })
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (data && isStale(data, now)) refetch()
  }, [data, now, refetch])

  if (!data) return <p>Загрузка…</p>
  const s = recategorize(data, now)

  return (
    <section>
      <h1>Предстоящие</h1>
      <Section title="Сегодня" items={s.today} tz={tz} timeOnly empty="На сегодня больше ничего" />
      <Section title="На этой неделе" items={s.week} tz={tz} empty="До конца недели пусто" />
      <Section title="Прошедшие активные" items={s.overdue} tz={tz} empty="Нет просроченных активных заметок"
        hint="Активные заметки, время которых прошло (за последние 30 дней). Отметьте неактивной, чтобы убрать." />
    </section>
  )
}

function Section({ title, items, tz, empty, timeOnly, hint }: {
  title: string; items: Occurrence[]; tz: string; empty: string; timeOnly?: boolean; hint?: string
}) {
  const open = useOpenEditor()
  return (
    <div className="upcoming-section" data-testid={`section-${title}`}>
      <h2>{title} <span className="muted small">({items.length})</span></h2>
      {hint && <p className="muted small">{hint}</p>}
      <ul className="note-list">
        {items.map((o) => (
          <li key={`${o.note_id}-${o.original_start}`} className={`note-row ${o.is_active ? '' : 'inactive'}`}>
            <button className="note-main" onClick={() => open({ kind: 'note', noteId: o.note_id })}>
              <span className="note-time">{timeOnly ? formatTime(o.start_at, tz) : formatDateTime(o.start_at, tz)}</span>
              <span className="note-title">{o.title}</span>
              {o.is_recurring && <span className="muted small" title="Повторяющаяся">↻</span>}
            </button>
            <span className="chips">{o.tags.map((t) => <TagChip key={t.id} tag={t} />)}</span>
          </li>
        ))}
        {items.length === 0 && <li className="muted small">{empty}</li>}
      </ul>
    </div>
  )
}
