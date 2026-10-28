import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { keys, useUserTz } from '../api/hooks'
import type { Occurrence, Upcoming } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { TagBadge } from '../components/ui/controls'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, SkeletonList } from '../components/ui/states'
import { inZone } from '../lib/time'
import { isStale, recategorize } from '../lib/upcoming'

const TICK_MS = 15_000

export function UpcomingPage() {
  const tz = useUserTz()
  const [overdueLimit, setOverdueLimit] = useState(50)
  const { data, error, refetch } = useQuery({
    queryKey: [...keys.notes, 'upcoming', overdueLimit],
    queryFn: () => api<Upcoming>(`/upcoming?overdue_limit=${overdueLimit}`),
    placeholderData: (prev) => prev,
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

  const today = inZone(now.toISOString(), tz).setLocale('ru')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Предстоящие</h1>
          <p className="lead" style={{ textTransform: 'capitalize' }}>{today.toFormat('cccc, d MMMM')}</p>
        </div>
      </div>
      {error && !data ? <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>
        : !data ? <SkeletonList rows={4} />
        : <Sections data={data} now={now} tz={tz} overdueLimit={overdueLimit} onMore={() => setOverdueLimit((l) => Math.min(1000, l + 100))} />}
    </>
  )
}

function Sections({ data, now, tz, overdueLimit, onMore }: { data: Upcoming; now: Date; tz: string; overdueLimit: number; onMore: () => void }) {
  const s = recategorize(data, now)
  return (
    <div className="upcoming-grid">
      <div className="stack" style={{ gap: 'var(--s5)' }}>
        <Section title="Сегодня" items={s.today} total={Math.max(s.today.length, data.today_total ?? 0)} capped={data.today_total_capped} tz={tz} timeOnly empty="На сегодня больше ничего не запланировано" />
        <Section title="На этой неделе" items={s.week} total={Math.max(s.week.length, data.week_total ?? 0)} capped={data.week_total_capped} tz={tz} empty="До конца недели заметок нет" />
      </div>
      <div className="stack">
        <Section title="Прошедшие активные" items={s.overdue} total={s.overdueTotal} capped={data.overdue_total_capped} tz={tz} overdue
          empty="Нет активных заметок, время которых прошло"
          hint="Все активные заметки, время которых прошло. Отметьте заметку неактивной, чтобы убрать её отсюда." />
        {s.overdue.length < s.overdueTotal && (
          <p className="muted small" data-testid="overdue-more">
            Показано {s.overdue.length} из {s.overdueTotal.toLocaleString('ru')}{data.overdue_total_capped ? '+' : ''}.{' '}
            <button className="btn btn-sm" onClick={onMore} disabled={overdueLimit >= 1000}>Показать ещё</button>
            {overdueLimit >= 1000 && ' Остальные — в разделе «Заметки» с фильтром «Активные» и периодом.'}
          </p>
        )}
      </div>
    </div>
  )
}

function Section({ title, items, total, capped, tz, empty, timeOnly, hint, overdue }: {
  title: string; items: Occurrence[]; total?: number; capped?: boolean; tz: string; empty: string; timeOnly?: boolean; hint?: string; overdue?: boolean
}) {
  const open = useOpenEditor()
  return (
    <section className={`card section-card ${overdue ? 'overdue' : ''}`} data-testid={`section-${title}`} aria-label={title}>
      <h2>{title} <span className="count">{(total ?? items.length).toLocaleString('ru')}{capped ? '+' : ''}</span></h2>
      {hint && <p className="muted xsmall">{hint}</p>}
      {total !== undefined && total > items.length && !overdue && (
        <p className="muted xsmall">Показаны первые {items.length} из {total.toLocaleString('ru')}{capped ? '+' : ''}. Все — в календаре или в списке заметок.</p>
      )}
      {items.length === 0 ? (
        <EmptyState icon={overdue ? 'check' : 'sun'} title={empty} />
      ) : (
        <ul className="note-list" style={{ gap: 2 }}>
          {items.map((o) => {
            const l = inZone(o.start_at, tz).setLocale('ru')
            return (
              <li key={`${o.note_id}-${o.original_start}`} className={`agenda-item ${o.is_active ? '' : 'inactive'}`}>
                <span className="agenda-time">{timeOnly ? l.toFormat('HH:mm') : <>{l.toFormat('ccc, d MMM')}<br />{l.toFormat('HH:mm')}</>}</span>
                <span className="agenda-bar" style={{ background: o.tags[0]?.color ?? 'var(--border-strong)' }} />
                <span className="agenda-main">
                  <button type="button" className="note-open" onClick={() => open(o.is_recurring
                    ? { kind: 'occurrence', noteId: o.note_id, originalStart: o.original_start }
                    : { kind: 'note', noteId: o.note_id })}>
                    <span className="note-title clamp-2">{o.title}</span>
                  </button>
                  <span className="note-meta">
                    {o.tags.slice(0, 3).map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)}
                    {o.tags.length > 3 && <span>+{o.tags.length - 3}</span>}
                    {o.is_recurring && <span className="meta-item"><Icon name="repeat" />серия</span>}
                    {!o.is_active && <span className="badge badge-muted">неактивна</span>}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
