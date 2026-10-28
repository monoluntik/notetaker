import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { keys, useCreateNote, useTags, useTrashNote, useUpdateNote, useUserTz } from '../api/hooks'
import type { Note } from '../api/types'
import { fromLocalInput, toLocalInput } from '../lib/time'
import { Modal } from './Modal'
import { TagChip } from './TagChip'

export type EditorTarget = { kind: 'new'; startAt?: string } | { kind: 'note'; noteId: number }

const EditorContext = createContext<(t: EditorTarget) => void>(() => {})

export const useOpenEditor = () => useContext(EditorContext)

export function NoteEditorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const close = useCallback(() => setTarget(null), [])
  return (
    <EditorContext.Provider value={setTarget}>
      {children}
      {target && <NoteEditorModal target={target} onClose={close} />}
    </EditorContext.Provider>
  )
}

function NoteEditorModal({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const noteId = target.kind === 'note' ? target.noteId : null
  const { data: note, isLoading } = useQuery({
    queryKey: [...keys.notes, 'one', noteId],
    queryFn: () => api<Note>(`/notes/${noteId}`),
    enabled: noteId !== null,
  })
  if (noteId !== null && (isLoading || !note)) {
    return <Modal title="Заметка" onClose={onClose}><p>Загрузка…</p></Modal>
  }
  return (
    <NoteForm
      key={note?.id ?? 'new'}
      note={note}
      defaultStart={target.kind === 'new' ? target.startAt : undefined}
      onClose={onClose}
    />
  )
}

function defaultStartIso(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.toISOString()
}

function NoteForm({ note, defaultStart, onClose }: { note?: Note; defaultStart?: string; onClose: () => void }) {
  const tz = useUserTz()
  const { data: tags = [] } = useTags()
  const create = useCreateNote()
  const update = useUpdateNote()
  const trash = useTrashNote()

  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [start, setStart] = useState(toLocalInput(note?.start_at ?? defaultStart ?? defaultStartIso(), tz))
  const [tagIds, setTagIds] = useState<number[]>(note?.tags.map((t) => t.id) ?? [])
  const [active, setActive] = useState(note?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)

  const readOnly = note?.deleted_at != null
  const toggleTag = (id: number) => setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (tagIds.length === 0) return setError('Выберите хотя бы один тег')
    try {
      const payload = { title, body, start_at: fromLocalInput(start, tz), timezone: tz, tag_ids: tagIds, is_active: active }
      if (note) {
        // Часовой пояс заметки меняем, только если пользователь менял время (DECISIONS D4)
        const timeChanged = start !== toLocalInput(note.start_at, tz)
        await update.mutateAsync({ id: note.id, ...payload, timezone: timeChanged ? tz : note.timezone })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function moveToTrash() {
    if (!note) return
    await trash.mutateAsync(note.id)
    onClose()
  }

  return (
    <Modal title={note ? (readOnly ? 'Заметка (в корзине)' : 'Редактирование заметки') : 'Новая заметка'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <fieldset disabled={readOnly}>
          <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus /></label>
          <label>Текст<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} /></label>
          <label>
            Дата и время <span className="muted">({tz})</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <div className="field">
            <span>Теги</span>
            <div className="chips">
              {tags.length === 0 && <span className="muted">Сначала создайте тег на странице «Теги»</span>}
              {tags.map((t) => <TagChip key={t.id} tag={t} selected={tagIds.includes(t.id)} onClick={() => toggleTag(t.id)} />)}
            </div>
          </div>
          <label className="row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Активна</label>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        {note && <p className="muted small">Создана: {new Date(note.created_at).toLocaleString('ru')} · Изменена: {new Date(note.updated_at).toLocaleString('ru')}</p>}
        <div className="actions">
          {note && !readOnly && <button type="button" className="danger" onClick={moveToTrash}>В корзину</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Отмена</button>
          {!readOnly && <button type="submit" className="primary" disabled={create.isPending || update.isPending}>Сохранить</button>}
        </div>
      </form>
    </Modal>
  )
}
