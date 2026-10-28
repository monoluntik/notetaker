import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { keys, useEmptyTrash, usePurgeNote, useRestoreNote, useUserTz } from '../api/hooks'
import type { Note, Page } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { NoteRow } from '../components/NoteRow'
import { formatDateTime } from '../lib/time'

export function TrashPage() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const { data } = useQuery({ queryKey: [...keys.notes, 'trash'], queryFn: () => api<Page<Note>>('/trash?page_size=200') })
  const restore = useRestoreNote()
  const purge = usePurgeNote()
  const empty = useEmptyTrash()

  return (
    <section>
      <div className="page-head">
        <h1>Корзина</h1>
        <button className="danger" disabled={!data?.total} onClick={() => confirm('Удалить все заметки из корзины навсегда?') && empty.mutate(undefined)}>Очистить корзину</button>
      </div>
      <ul className="note-list">
        {data?.items.map((n) => (
          <NoteRow key={n.id} note={n} tz={tz} onOpen={() => open({ kind: 'note', noteId: n.id })} extra={
            <span className="row">
              <span className="muted small">удалена {formatDateTime(n.deleted_at!, tz)}</span>
              <button onClick={() => restore.mutate(n.id)}>Восстановить</button>
              <button className="danger" onClick={() => confirm('Удалить навсегда?') && purge.mutate(n.id)}>Удалить навсегда</button>
            </span>
          } />
        ))}
        {data?.items.length === 0 && <li className="muted">Корзина пуста</li>}
      </ul>
    </section>
  )
}
