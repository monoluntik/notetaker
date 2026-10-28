import { DateTime } from 'luxon'
import type { ReactNode } from 'react'
import type { Note } from '../api/types'
import { inZone } from '../lib/time'
import { TagBadge } from './ui/controls'
import { Icon } from './ui/Icon'

const FREQ = { daily: 'каждый день', weekly: 'каждую неделю', monthly: 'каждый месяц' } as const
const REM: Record<number, string> = { 10: '10 мин', 60: '1 ч', 1440: '1 день' }

/** Карточка заметки: дата, заголовок, превью текста, теги, повторение, напоминания. */
export function NoteCard({ note, tz, onOpen, side }: { note: Note; tz: string; onOpen: () => void; side?: ReactNode }) {
  const local = inZone(note.start_at, tz).setLocale('ru')
  return (
    <li className={`note-card ${note.is_active ? '' : 'inactive'}`} data-testid="note-card">
      <div className="note-date" aria-hidden>
        <span className="d">{local.day}</span>
        <span className="m">{local.toFormat('LLL yy')}</span>
        <span className="t">{local.toFormat('HH:mm')}</span>
      </div>
      <div className="note-body">
        <button type="button" className="note-open" onClick={onOpen}
          aria-label={`${note.title}, ${local.toFormat('d MMMM yyyy, HH:mm')}${note.is_active ? '' : ', неактивна'}`}>
          <span className="note-title clamp-2">{note.title}</span>
        </button>
        {note.body && <p className="note-preview clamp-2">{note.body}</p>}
        <div className="note-meta">
          {note.tags.map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)}
          {note.recurrence && (
            <span className="meta-item" title="Повторяющаяся заметка">
              <Icon name="repeat" />{FREQ[note.recurrence.freq]} до {DateTime.fromISO(note.recurrence.until).toFormat('dd.MM.yyyy')}
            </span>
          )}
          {note.reminders.length > 0 && (
            <span className="meta-item" title="Напоминания"><Icon name="bell" />{note.reminders.map((m) => REM[m]).join(', ')}</span>
          )}
          {!note.is_active && <span className="badge badge-muted">неактивна</span>}
        </div>
      </div>
      {side && <div className="note-side">{side}</div>}
    </li>
  )
}
