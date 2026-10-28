import type { Note } from '../api/types'
import { formatDateTime } from '../lib/time'
import { TagChip } from './TagChip'

export function NoteRow({ note, tz, onOpen, extra }: { note: Note; tz: string; onOpen: () => void; extra?: React.ReactNode }) {
  return (
    <li className={`note-row ${note.is_active ? '' : 'inactive'}`}>
      <button className="note-main" onClick={onOpen}>
        <span className="note-time">{formatDateTime(note.start_at, tz)}</span>
        <span className="note-title">{note.title}</span>
        {!note.is_active && <span className="muted small">неактивна</span>}
      </button>
      <span className="chips">{note.tags.map((t) => <TagChip key={t.id} tag={t} />)}</span>
      {extra}
    </li>
  )
}
