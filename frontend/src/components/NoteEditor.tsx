import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { api } from '../api/client'
import {
  keys, useCancelOccurrence, useCreateNote, useOccurrence, useResetOccurrence, useTags, useTrashNote,
  useUpdateNote, useUpdateOccurrence, useUserTz,
} from '../api/hooks'
import type { Freq, Note, Occurrence } from '../api/types'
import { formatDateTime, fromLocalInput, toLocalInput } from '../lib/time'
import { Modal } from './Modal'
import { TagChip } from './TagChip'

export type EditorTarget =
  | { kind: 'new'; startAt?: string }
  | { kind: 'note'; noteId: number }
  | { kind: 'occurrence'; noteId: number; originalStart: string }

const EditorContext = createContext<(t: EditorTarget) => void>(() => {})

// eslint-disable-next-line react-refresh/only-export-components
export const useOpenEditor = () => useContext(EditorContext)

export function NoteEditorProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const close = useCallback(() => setTarget(null), [])
  return (
    <EditorContext.Provider value={setTarget}>
      {children}
      {target && <NoteEditorModal key={JSON.stringify(target)} target={target} onClose={close} />}
    </EditorContext.Provider>
  )
}

function useNote(noteId: number | null) {
  return useQuery({
    queryKey: [...keys.notes, 'one', noteId],
    queryFn: () => api<Note>(`/notes/${noteId}`),
    enabled: noteId !== null,
  })
}

function NoteEditorModal({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const noteId = target.kind === 'new' ? null : target.noteId
  const { data: note, isLoading, error } = useNote(noteId)
  // Для вхождения серии сначала спрашиваем: изменить только его или всю серию
  const [scope, setScope] = useState<'ask' | 'one' | 'series'>(target.kind === 'occurrence' ? 'ask' : 'series')

  if (error) return <Modal title="Заметка" onClose={onClose}><p className="error">{(error as Error).message}</p></Modal>
  if (noteId !== null && (isLoading || !note)) return <Modal title="Заметка" onClose={onClose}><p>Загрузка…</p></Modal>

  if (target.kind === 'occurrence' && note?.recurrence && note.deleted_at == null) {
    if (scope === 'ask') {
      return (
        <Modal title={note.title} onClose={onClose}>
          <p>Это вхождение повторяющейся заметки. Что изменить?</p>
          <div className="actions">
            <button className="primary" onClick={() => setScope('one')}>Только это вхождение</button>
            <button onClick={() => setScope('series')}>Всю серию</button>
          </div>
        </Modal>
      )
    }
    if (scope === 'one') return <OccurrenceForm note={note} originalStart={target.originalStart} onClose={onClose} />
  }
  return <NoteForm note={note} defaultStart={target.kind === 'new' ? target.startAt : undefined} onClose={onClose} />
}

function defaultStartIso(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.toISOString()
}

const FREQ_LABEL: Record<Freq | 'none', string> = {
  none: 'Не повторять', daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно',
}

function NoteForm({ note, defaultStart, onClose }: { note?: Note; defaultStart?: string; onClose: () => void }) {
  const tz = useUserTz()
  const { data: tags = [] } = useTags()
  const create = useCreateNote()
  const update = useUpdateNote()
  const trash = useTrashNote()

  const initialStart = toLocalInput(note?.start_at ?? defaultStart ?? defaultStartIso(), tz)
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [start, setStart] = useState(initialStart)
  const [tagIds, setTagIds] = useState<number[]>(note?.tags.map((t) => t.id) ?? [])
  const [active, setActive] = useState(note?.is_active ?? true)
  const [freq, setFreq] = useState<Freq | 'none'>(note?.recurrence?.freq ?? 'none')
  const [until, setUntil] = useState(
    note?.recurrence?.until ?? DateTime.fromISO(initialStart).plus({ months: 1 }).toISODate()!,
  )
  const [error, setError] = useState<string | null>(null)

  const readOnly = note?.deleted_at != null
  const timeChanged = note ? start !== toLocalInput(note.start_at, tz) : false
  const ruleChanged = !!note?.recurrence && (timeChanged || freq !== note.recurrence.freq)
  const toggleTag = (id: number) => setTagIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (tagIds.length === 0) return setError('Выберите хотя бы один тег')
    try {
      const payload = {
        title, body, start_at: fromLocalInput(start, tz), tag_ids: tagIds, is_active: active,
        recurrence: freq === 'none' ? null : { freq, until },
        // Пояс заметки меняется, только если пользователь менял время (DECISIONS D4)
        timezone: note && !timeChanged ? note.timezone : tz,
      }
      if (note) await update.mutateAsync({ id: note.id, ...payload })
      else await create.mutateAsync(payload)
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

  const title_ = note ? (readOnly ? 'Заметка (в корзине)' : note.recurrence ? 'Редактирование серии' : 'Редактирование заметки') : 'Новая заметка'
  return (
    <Modal title={title_} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <fieldset disabled={readOnly}>
          <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus /></label>
          <label>Текст<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} /></label>
          <label>
            Дата и время <span className="muted">({tz})</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <div className="grid2">
            <label>
              Повторение
              <select value={freq} onChange={(e) => setFreq(e.target.value as Freq | 'none')}>
                {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {freq !== 'none' && (
              <label>
                До (включительно)
                <input type="date" value={until} min={start.slice(0, 10)} onChange={(e) => setUntil(e.target.value)} required />
              </label>
            )}
          </div>
          {ruleChanged && (
            <p className="warn small">Изменение времени или частоты серии сбросит изменения отдельных вхождений.</p>
          )}
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
        {note && <p className="muted small">Создана: {formatDateTime(note.created_at, tz)} · Изменена: {formatDateTime(note.updated_at, tz)}</p>}
        <div className="actions">
          {note && !readOnly && (
            <button type="button" className="danger" onClick={moveToTrash}>
              {note.recurrence ? 'Серию в корзину' : 'В корзину'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Отмена</button>
          {!readOnly && <button type="submit" className="primary" disabled={create.isPending || update.isPending}>Сохранить</button>}
        </div>
      </form>
    </Modal>
  )
}

function OccurrenceForm({ note, originalStart, onClose }: { note: Note; originalStart: string; onClose: () => void }) {
  const { data: occ, error } = useOccurrence(note.id, originalStart)
  if (error) return <Modal title="Вхождение" onClose={onClose}><p className="error">{(error as Error).message}</p></Modal>
  if (!occ) return <Modal title="Вхождение" onClose={onClose}><p>Загрузка…</p></Modal>
  return <OccurrenceFormInner note={note} occ={occ} onClose={onClose} />
}

function OccurrenceFormInner({ note, occ, onClose }: { note: Note; occ: Occurrence; onClose: () => void }) {
  const tz = useUserTz()
  const update = useUpdateOccurrence()
  const cancel = useCancelOccurrence()
  const reset = useResetOccurrence()
  const [title, setTitle] = useState(occ.title)
  const [body, setBody] = useState(occ.body)
  const [start, setStart] = useState(toLocalInput(occ.start_at, tz))
  const [active, setActive] = useState(occ.is_active)
  const [error, setError] = useState<string | null>(null)
  const ids = { noteId: note.id, originalStart: occ.original_start }

  const run = async (p: Promise<unknown>) => {
    setError(null)
    try { await p; onClose() } catch (err) { setError((err as Error).message) }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(update.mutateAsync({ ...ids, title, body, start_at: fromLocalInput(start, tz), is_active: active }))
  }

  return (
    <Modal title="Изменение одного вхождения" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted small">
          Серия «{note.title}», вхождение от {formatDateTime(occ.original_start, tz)}. Остальные вхождения не изменятся.
        </p>
        <label>Заголовок<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus /></label>
        <label>Текст<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} /></label>
        <label>Дата и время <span className="muted">({tz})</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!note.is_active} /> Активно
          {!note.is_active && <span className="muted small">(вся серия неактивна)</span>}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="danger" onClick={() => run(cancel.mutateAsync(ids))}>Удалить это вхождение</button>
          {occ.is_exception && <button type="button" onClick={() => run(reset.mutateAsync(ids))}>Как в серии</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  )
}
