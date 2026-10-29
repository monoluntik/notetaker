import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { Link } from 'react-router-dom'
import { api, isEditConflict, newIdempotencyKey } from '../api/client'
import {
  keys, useCancelOccurrence, useCreateNote, useCreateTag, useOccurrence, useResetOccurrence, useRestoreNote,
  useSettings, useSplitSeries, useTags, useTrashNote, useUpdateNote, useUpdateOccurrence, useUserTz,
} from '../api/hooks'
import type { Freq, Note, Occurrence } from '../api/types'
import { changedFields, isDirty, rebaseDraft } from '../lib/draft'
import { formatDateTime, inZone } from '../lib/time'
import { Switch, TogglePill } from './ui/controls'
import { Dialog } from './ui/Dialog'
import { useConfirm, useToast } from './ui/feedback'
import { Icon } from './ui/Icon'
import { ErrorState, Spinner } from './ui/states'

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

const fetchNote = (id: number) => api<Note>(`/notes/${id}`)
const fetchOcc = (id: number, start: string) => api<Occurrence>(`/notes/${id}/occurrences/${encodeURIComponent(start)}`)

type Scope = 'ask' | 'one' | 'following' | 'series'

function NoteEditorModal({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const noteId = target.kind === 'new' ? null : target.noteId
  const { data: note, error, refetch } = useQuery({
    queryKey: [...keys.notes, 'one', noteId],
    queryFn: () => fetchNote(noteId!),
    enabled: noteId !== null,
  })
  const [scope, setScope] = useState<Scope>(target.kind === 'occurrence' ? 'ask' : 'series')

  if (error) {
    return <Dialog title="Заметка" onClose={onClose}><ErrorState error={error} onRetry={() => refetch()} /></Dialog>
  }
  if (noteId !== null && !note) {
    return <Dialog title="Заметка" onClose={onClose}><div className="state"><Spinner /></div></Dialog>
  }
  if (target.kind === 'occurrence' && note?.recurrence && note.deleted_at == null) {
    if (scope === 'ask') return <ScopeChooser note={note} originalStart={target.originalStart} onPick={setScope} onClose={onClose} />
    if (scope === 'one') return <OccurrenceForm note={note} originalStart={target.originalStart} onClose={onClose} />
    if (scope === 'following') return <NoteForm note={note} splitFrom={target.originalStart} onClose={onClose} />
  }
  return <NoteForm note={note} defaultStart={target.kind === 'new' ? target.startAt : undefined} onClose={onClose} />
}

function ScopeChooser({ note, originalStart, onPick, onClose }: {
  note: Note; originalStart: string; onPick: (s: Scope) => void; onClose: () => void
}) {
  const tz = useUserTz()
  const isFirst = inZone(originalStart, note.timezone).toISODate() === inZone(note.start_at, note.timezone).toISODate()
  return (
    <Dialog size="sm" title={note.title} onClose={onClose}>
      <p className="muted small">Повторяющаяся заметка, вхождение {formatDateTime(originalStart, tz)}. Что изменить?</p>
      <div className="choice-list">
        <button className="choice" onClick={() => onPick('one')}>
          <Icon name="calendar" />
          <div><strong>Только это вхождение</strong><span>Остальные вхождения серии не изменятся</span></div>
        </button>
        {!isFirst && (
          <button className="choice" onClick={() => onPick('following')}>
            <Icon name="right" />
            <div><strong>Это и последующие</strong><span>Прошлые вхождения останутся как были</span></div>
          </button>
        )}
        <button className="choice" onClick={() => onPick('series')}>
          <Icon name="repeat" />
          <div><strong>Всю серию</strong><span>Включая прошедшие вхождения</span></div>
        </button>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Форма заметки / серии / «это и последующие»                         */
/* ------------------------------------------------------------------ */

type FreqOpt = Freq | 'none'
interface NoteDraft extends Record<string, unknown> {
  title: string
  body: string
  date: string // yyyy-MM-dd в поясе пользователя
  time: string // HH:mm
  tagIds: number[]
  active: boolean
  freq: FreqOpt
  until: string
  reminders: number[]
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Заголовок', body: 'Текст', date: 'Дата', time: 'Время', tagIds: 'Теги', active: 'Активность',
  freq: 'Повторение', until: 'Окончание серии', reminders: 'Напоминания',
}

const FREQ_OPTIONS: [FreqOpt, string][] = [['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц']]
const REMINDERS: [number, string][] = [[10, 'За 10 минут'], [60, 'За 1 час'], [1440, 'За 1 день']]

function defaultStartIso(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.toISOString()
}

const sortNum = (a: number[]) => [...a].sort((x, y) => x - y)

function draftFromNote(note: Note | undefined, startIso: string, tz: string): NoteDraft {
  const local = inZone(startIso, tz)
  return {
    title: note?.title ?? '',
    body: note?.body ?? '',
    date: local.toISODate()!,
    time: local.toFormat('HH:mm'),
    tagIds: sortNum(note?.tags.map((t) => t.id) ?? []),
    active: note?.is_active ?? true,
    freq: note?.recurrence?.freq ?? 'none',
    until: note?.recurrence?.until ?? local.plus({ months: 1 }).toISODate()!,
    reminders: sortNum(note?.reminders ?? []),
  }
}

function recurrenceSummary(d: NoteDraft): string {
  if (d.freq === 'none' || !d.date || !d.until) return ''
  const dt = DateTime.fromISO(`${d.date}T${d.time || '00:00'}`).setLocale('ru')
  const until = DateTime.fromISO(d.until).setLocale('ru').toFormat('d MMMM yyyy')
  const when = d.freq === 'daily' ? 'Каждый день' : d.freq === 'weekly' ? `Каждую неделю, ${dt.toFormat('cccc')}` : `Каждый месяц, ${dt.day}-го числа`
  return `${when} в ${d.time} до ${until} включительно`
}

function validate(d: NoteDraft): Partial<Record<keyof NoteDraft, string>> {
  const e: Partial<Record<keyof NoteDraft, string>> = {}
  if (!d.title.trim()) e.title = 'Введите заголовок'
  if (!d.date) e.date = 'Укажите дату'
  if (!d.time) e.time = 'Укажите время'
  if (d.freq !== 'none' && (!d.until || d.until < d.date)) e.until = 'Дата окончания не может быть раньше даты заметки'
  return e
}

function NoteForm({ note, defaultStart, splitFrom, onClose }: {
  note?: Note; defaultStart?: string; splitFrom?: string; onClose: () => void
}) {
  const tz = useUserTz()
  const confirm = useConfirm()
  const toast = useToast()
  const { data: tags = [], isLoading: tagsLoading } = useTags()
  const { data: settings } = useSettings()
  const create = useCreateNote()
  // Один ключ на открытую форму: повторная отправка той же формы не создаст вторую заметку
  const createKey = useRef(newIdempotencyKey())
  const update = useUpdateNote()
  const split = useSplitSeries()
  const trash = useTrashNote()
  const restore = useRestoreNote()

  const [base, setBase] = useState<NoteDraft>(() => draftFromNote(note, splitFrom ?? note?.start_at ?? defaultStart ?? defaultStartIso(), tz))
  const [draft, setDraft] = useState<NoteDraft>(base)
  const [version, setVersion] = useState(note?.version)
  const [errors, setErrors] = useState<Partial<Record<keyof NoteDraft, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [overlap, setOverlap] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const formId = useId().replace(/:/g, '')

  const readOnly = note?.deleted_at != null
  const dirty = isDirty(base, draft)
  // По WebSocket пришла новая версия, пока пользователь редактирует
  const stale = !!note && version !== undefined && note.version !== version
  const set = <K extends keyof NoteDraft>(k: K, v: NoteDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function requestClose() {
    if (dirty && !readOnly && !(await confirm({
      title: 'Закрыть без сохранения?', message: 'Внесённые изменения будут потеряны.',
      confirmLabel: 'Закрыть', cancelLabel: 'Продолжить редактирование', danger: true,
    }))) return
    onClose()
  }

  /** Загрузить актуальную версию; keepMine — перенести на неё правки пользователя. */
  async function rebase(keepMine: boolean) {
    if (!note) return
    try {
      const fresh = await fetchNote(note.id)
      const freshDraft = draftFromNote(fresh, splitFrom ?? fresh.start_at, tz)
      const r = keepMine ? rebaseDraft(base, draft, freshDraft) : { draft: freshDraft, overlapping: [] }
      setBase(freshDraft)
      setDraft(r.draft)
      setVersion(fresh.version)
      setOverlap(r.overlapping.map((k) => FIELD_LABEL[k as string] ?? String(k)))
      setConflict(false)
      setSubmitError(null)
    } catch (err) {
      setSubmitError((err as Error).message)
    }
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (readOnly || saving) return
    const v = validate(draft)
    setErrors(v)
    if (Object.keys(v).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${formId} [aria-invalid="true"]`)?.focus())
      return
    }
    setSubmitError(null)
    setSaving(true)
    const start = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: tz })
    const timeChanged = draft.date !== base.date || draft.time !== base.time
    const payload = {
      title: draft.title.trim(), body: draft.body, start_at: start.toUTC().toISO({ suppressMilliseconds: true })!,
      tag_ids: draft.tagIds, is_active: draft.active, reminders: draft.reminders,
      recurrence: draft.freq === 'none' ? null : { freq: draft.freq, until: draft.until },
      // Пояс заметки меняется, только если пользователь менял время (DECISIONS D4)
      timezone: note && !timeChanged ? note.timezone : tz,
    }
    try {
      if (note && splitFrom) {
        await split.mutateAsync({ noteId: note.id, originalStart: splitFrom, version: version!, ...payload })
        toast('Изменения применены к этому и последующим вхождениям')
      } else if (note) {
        await update.mutateAsync({ id: note.id, version: version!, ...payload })
        toast('Заметка сохранена')
      } else {
        await create.mutateAsync({ ...payload, idempotencyKey: createKey.current })
        toast('Заметка создана')
      }
      onClose()
    } catch (err) {
      if (isEditConflict(err)) setConflict(true)
      else setSubmitError((err as Error).message) // введённые данные остаются в форме
    } finally {
      setSaving(false)
    }
  }

  async function moveToTrash() {
    if (!note || version === undefined) return
    if (dirty && !(await confirm({ title: 'Удалить заметку?', message: 'Несохранённые изменения будут потеряны.', confirmLabel: 'В корзину', danger: true }))) return
    try {
      const trashed = await trash.mutateAsync({ id: note.id, version })
      onClose()
      toast(note.recurrence ? 'Серия перемещена в корзину' : 'Заметка перемещена в корзину', 'success', {
        label: 'Отменить', run: () => restore.mutate({ id: trashed.id, version: trashed.version }),
      })
    } catch (err) {
      if (isEditConflict(err)) setConflict(true)
      else setSubmitError((err as Error).message)
    }
  }

  // Ctrl/Cmd+Enter — сохранить
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const title = readOnly ? 'Заметка в корзине' : splitFrom ? 'Это и последующие вхождения'
    : note ? (note.recurrence ? 'Редактирование серии' : 'Редактирование заметки') : 'Новая заметка'
  const err = (k: keyof NoteDraft) => errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${formId}-${String(k)}` } : {}
  const errText = (k: keyof NoteDraft) => errors[k] && <span className="field-error" id={`${formId}-${String(k)}`}>{errors[k]}</span>
  const ruleChanged = !!note?.recurrence && !splitFrom && (draft.date !== base.date || draft.time !== base.time || draft.freq !== base.freq)

  return (
    <Dialog title={title} onClose={requestClose} initialFocus={note ? undefined : '[name="title"]'}
      footer={<>
        {note && !readOnly && !splitFrom && (
          <button type="button" className="btn btn-danger-ghost" onClick={moveToTrash} aria-label={note.recurrence ? 'Серию в корзину' : 'В корзину'}>
            <Icon name="trash" />
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={requestClose}>{readOnly ? 'Закрыть' : 'Отмена'}</button>
        {!readOnly && (
          <button type="submit" form={formId} className="btn btn-primary" disabled={saving || conflict}>
            {saving && <Spinner label="Сохранение" />} Сохранить
          </button>
        )}
      </>}>
      <form id={formId} className="stack" style={{ gap: 'var(--s4)' }} onSubmit={submit} noValidate>
        {(conflict || stale) && (
          <div className="banner banner-warn" role="alert" data-testid="conflict-banner">
            <Icon name="alert" />
            <div>
              <strong>Заметку изменили в другой вкладке или на другом устройстве.</strong>{' '}
              {conflict ? 'Ваше сохранение не применено, чтобы не перезаписать чужие изменения.' : 'Если сохранить сейчас, сервер отклонит изменения.'}
              {' '}Ваши правки не потеряны.
              <div className="banner-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => rebase(true)}>Перенести мои правки на актуальную версию</button>
                <button type="button" className="btn btn-sm" onClick={() => rebase(false)}>Отбросить мои правки</button>
              </div>
            </div>
          </div>
        )}
        {overlap.length > 0 && (
          <div className="banner banner-info" role="status">
            <Icon name="info" />
            <div>Правки перенесены на актуальную версию. Проверьте поля, изменённые и в другой вкладке: <strong>{overlap.join(', ')}</strong>. Затем сохраните.</div>
          </div>
        )}
        {readOnly && <div className="banner banner-info"><Icon name="info" /><div>Заметка в корзине. Восстановите её, чтобы редактировать.</div></div>}
        {splitFrom && (
          <div className="banner banner-info"><Icon name="info" /><div>
            Изменения применятся к вхождениям начиная с {formatDateTime(splitFrom, tz)}. Прошлые вхождения останутся как были.
          </div></div>
        )}

        <fieldset disabled={readOnly} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 'var(--s4)', minWidth: 0 }}>
          <label className="field">
            <span className="field-label">Заголовок</span>
            <input className="input" name="title" value={draft.title} maxLength={200} autoComplete="off"
              placeholder="Например, «Созвон с командой»" onChange={(e) => set('title', e.target.value)} {...err('title')} />
            {errText('title')}
          </label>
          <label className="field">
            <span className="field-label">Текст</span>
            <textarea className="textarea" name="body" value={draft.body} rows={4} placeholder="Подробности, ссылки, список дел…"
              onChange={(e) => set('body', e.target.value)} />
          </label>

          <div className="grid-2">
            <label className="field">
              <span className="field-label">Дата</span>
              <input className="input" type="date" name="date" value={draft.date} onChange={(e) => set('date', e.target.value)} {...err('date')} />
              {errText('date')}
            </label>
            <label className="field">
              <span className="field-label">Время <span className="muted">· {tz}</span></span>
              <input className="input" type="time" name="time" value={draft.time} onChange={(e) => set('time', e.target.value)} {...err('time')} />
              {errText('time')}
            </label>
          </div>

          <div className="field">
            <span className="field-label" id={`${formId}-freq`}>Повторение</span>
            <div className="segmented" role="radiogroup" aria-labelledby={`${formId}-freq`}>
              {FREQ_OPTIONS.map(([v, text]) => (
                <button key={v} type="button" role="radio" aria-checked={draft.freq === v} onClick={() => set('freq', v)}>{text}</button>
              ))}
            </div>
            {draft.freq !== 'none' && (
              <div className="grid-2" style={{ marginTop: 'var(--s2)', alignItems: 'end' }}>
                <label className="field">
                  <span className="field-label">До (включительно)</span>
                  <input className="input" type="date" name="until" value={draft.until} min={draft.date}
                    onChange={(e) => set('until', e.target.value)} {...err('until')} />
                  {errText('until')}
                </label>
                <span className="field-hint" style={{ paddingBottom: 10 }}>{recurrenceSummary(draft)}</span>
              </div>
            )}
            {ruleChanged && (
              <span className="field-hint" style={{ color: 'var(--warn)' }}>
                Изменение времени или частоты всей серии сбросит изменения отдельных вхождений. Чтобы не трогать прошлое,
                откройте вхождение в календаре и выберите «Это и последующие».
              </span>
            )}
          </div>

          <div className="field">
            <span className="field-label" id={`${formId}-tags`}>Теги</span>
            <div className="chips" role="group" aria-labelledby={`${formId}-tags`} {...err('tagIds')}>
              {tagsLoading && <Spinner />}
              {tags.map((t) => (
                <TogglePill key={t.id} color={t.color} pressed={draft.tagIds.includes(t.id)}
                  onClick={() => set('tagIds', draft.tagIds.includes(t.id) ? draft.tagIds.filter((x) => x !== t.id) : sortNum([...draft.tagIds, t.id]))}>
                  {t.name}
                </TogglePill>
              ))}
              <InlineTagCreator onCreated={(id) => set('tagIds', sortNum([...draft.tagIds, id]))} />
            </div>
            {errText('tagIds')}
          </div>

          <div className="field">
            <span className="field-label" id={`${formId}-rem`}>Напоминания</span>
            <div className="chips" role="group" aria-labelledby={`${formId}-rem`}>
              {REMINDERS.map(([m, label]) => (
                <TogglePill key={m} pressed={draft.reminders.includes(m)}
                  onClick={() => set('reminders', draft.reminders.includes(m) ? draft.reminders.filter((x) => x !== m) : sortNum([...draft.reminders, m]))}>
                  {label}
                </TogglePill>
              ))}
            </div>
            <span className="field-hint">
              {settings?.email
                ? <>Письмо на {settings.email} и уведомление в открытых вкладках. Только для активной заметки.</>
                : <>Email не указан — только уведомление в приложении. <Link to="/settings" onClick={onClose}>Указать email</Link></>}
            </span>
          </div>

          <Switch checked={draft.active} onChange={(v) => set('active', v)} label="Активна"
            hint="Неактивные заметки не напоминают о себе и не попадают в «Прошедшие активные»" />
        </fieldset>

        {submitError && (
          <div className="banner banner-error" role="alert">
            <Icon name={submitError.includes('связи') ? 'wifiOff' : 'alert'} />
            <div>{submitError}</div>
          </div>
        )}
        {note && (
          <p className="xsmall muted">Создана {formatDateTime(note.created_at, tz)} · изменена {formatDateTime(note.updated_at, tz)}</p>
        )}
      </form>
    </Dialog>
  )
}

const TAG_PALETTE = ['#4f46e5', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed']

function InlineTagCreator({ onCreated }: { onCreated: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateTag()
  if (!open) {
    return <button type="button" className="pill" onClick={() => setOpen(true)}><Icon name="plus" /><span>Новый тег</span></button>
  }
  async function add() {
    if (!name.trim()) return
    try {
      const tag = await create.mutateAsync({ name: name.trim(), color: TAG_PALETTE[name.trim().length % TAG_PALETTE.length] })
      onCreated(tag.id)
      setName(''); setOpen(false); setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <span className="row wrap" style={{ width: '100%' }}>
      <input className="input" style={{ flex: '1 1 160px', minHeight: 36 }} autoFocus value={name} maxLength={50}
        aria-label="Название нового тега" placeholder="Название тега" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }} />
      <button type="button" className="btn btn-sm btn-primary" onClick={add} disabled={create.isPending}>Добавить</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Форма одного вхождения                                              */
/* ------------------------------------------------------------------ */

interface OccDraft extends Record<string, unknown> { title: string; body: string; date: string; time: string; active: boolean }

const occDraft = (o: Occurrence, tz: string): OccDraft => {
  const l = inZone(o.start_at, tz)
  return { title: o.title, body: o.body, date: l.toISODate()!, time: l.toFormat('HH:mm'), active: o.is_active }
}

function OccurrenceForm({ note, originalStart, onClose }: { note: Note; originalStart: string; onClose: () => void }) {
  const { data: occ, error, refetch } = useOccurrence(note.id, originalStart)
  if (error) return <Dialog title="Вхождение" onClose={onClose}><ErrorState error={error} onRetry={() => refetch()} /></Dialog>
  if (!occ) return <Dialog title="Вхождение" onClose={onClose}><div className="state"><Spinner /></div></Dialog>
  return <OccurrenceFormInner note={note} occ={occ} onClose={onClose} />
}

function OccurrenceFormInner({ note, occ, onClose }: { note: Note; occ: Occurrence; onClose: () => void }) {
  const tz = useUserTz()
  const confirm = useConfirm()
  const toast = useToast()
  const update = useUpdateOccurrence()
  const cancel = useCancelOccurrence()
  const reset = useResetOccurrence()
  const [base, setBase] = useState(() => occDraft(occ, tz))
  const [draft, setDraft] = useState(base)
  const [version, setVersion] = useState(note.version)
  const [conflict, setConflict] = useState(false)
  const [overlap, setOverlap] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const formId = useId().replace(/:/g, '')
  const ref = { noteId: note.id, originalStart: occ.original_start }
  const dirty = isDirty(base, draft)
  const stale = note.version !== version
  const set = <K extends keyof OccDraft>(k: K, v: OccDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const run = async (p: () => Promise<unknown>, message: string) => {
    setError(null); setSaving(true)
    try {
      await p()
      toast(message)
      onClose()
    } catch (err) {
      if (isEditConflict(err)) setConflict(true)
      else setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function rebase(keepMine: boolean) {
    try {
      const [freshNote, freshOcc] = await Promise.all([fetchNote(note.id), fetchOcc(note.id, occ.original_start)])
      const fresh = occDraft(freshOcc, tz)
      const r = keepMine ? rebaseDraft(base, draft, fresh) : { draft: fresh, overlapping: [] }
      setBase(fresh); setDraft(r.draft); setVersion(freshNote.version); setConflict(false)
      setOverlap(r.overlapping.map((k) => FIELD_LABEL[k as string] ?? String(k)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) { setError('Введите заголовок'); return }
    const start = DateTime.fromISO(`${draft.date}T${draft.time}`, { zone: tz }).toUTC().toISO({ suppressMilliseconds: true })!
    run(() => update.mutateAsync({ ...ref, version, title: draft.title.trim(), body: draft.body, start_at: start, is_active: draft.active }),
      'Вхождение сохранено')
  }

  async function requestClose() {
    if (dirty && !(await confirm({ title: 'Закрыть без сохранения?', message: 'Внесённые изменения будут потеряны.', confirmLabel: 'Закрыть', danger: true }))) return
    onClose()
  }

  async function removeOne() {
    if (!(await confirm({
      title: 'Удалить это вхождение?', danger: true, confirmLabel: 'Удалить вхождение',
      message: <>Вхождение {formatDateTime(occ.start_at, tz)} исчезнет из календаря. Остальные вхождения серии останутся.</>,
    }))) return
    run(() => cancel.mutateAsync({ ...ref, version }), 'Вхождение удалено')
  }

  return (
    <Dialog title="Одно вхождение" onClose={requestClose}
      footer={<>
        <button type="button" className="btn btn-danger-ghost" onClick={removeOne} aria-label="Удалить это вхождение"><Icon name="trash" /></button>
        {occ.is_exception && (
          <button type="button" className="btn btn-ghost" onClick={() => run(() => reset.mutateAsync({ ...ref, version }), 'Вхождение снова как в серии')}>
            Как в серии
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={requestClose}>Отмена</button>
        <button type="submit" form={formId} className="btn btn-primary" disabled={saving || conflict}>
          {saving && <Spinner label="Сохранение" />} Сохранить
        </button>
      </>}>
      <form id={formId} className="stack" style={{ gap: 'var(--s4)' }} onSubmit={submit} noValidate>
        <p className="muted small">Серия «{note.title}» · вхождение {formatDateTime(occ.original_start, tz)}. Остальные вхождения не изменятся.</p>
        {(conflict || stale) && (
          <div className="banner banner-warn" role="alert" data-testid="conflict-banner">
            <Icon name="alert" />
            <div>
              <strong>Серию изменили в другой вкладке или на другом устройстве.</strong> Ваши правки не потеряны.
              <div className="banner-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => rebase(true)}>Перенести мои правки на актуальную версию</button>
                <button type="button" className="btn btn-sm" onClick={() => rebase(false)}>Отбросить мои правки</button>
              </div>
            </div>
          </div>
        )}
        {overlap.length > 0 && <div className="banner banner-info"><Icon name="info" /><div>Проверьте поля: <strong>{overlap.join(', ')}</strong>.</div></div>}
        <label className="field">
          <span className="field-label">Заголовок</span>
          <input className="input" name="title" value={draft.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Текст</span>
          <textarea className="textarea" name="body" value={draft.body} rows={4} onChange={(e) => set('body', e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field"><span className="field-label">Дата</span>
            <input className="input" type="date" name="date" value={draft.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span className="field-label">Время <span className="muted">· {tz}</span></span>
            <input className="input" type="time" name="time" value={draft.time} onChange={(e) => set('time', e.target.value)} /></label>
        </div>
        <Switch checked={draft.active} onChange={(v) => set('active', v)} disabled={!note.is_active} label="Активно"
          hint={!note.is_active ? 'Вся серия неактивна — включите её в настройках серии' : undefined} />
        {error && <div className="banner banner-error" role="alert"><Icon name="alert" /><div>{error}</div></div>}
        {changedFields(base, draft).length > 0 && <p className="xsmall muted">Есть несохранённые изменения</p>}
      </form>
    </Dialog>
  )
}
