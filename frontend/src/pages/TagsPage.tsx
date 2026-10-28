import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useCreateTag, useDeleteTag, useTagsWithCounts, useUpdateTag } from '../api/hooks'
import type { TagWithCount } from '../api/types'
import { useConfirm, useToast } from '../components/ui/feedback'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, SkeletonList, Spinner } from '../components/ui/states'

const PALETTE = ['#4f46e5', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#64748b']

function ColorPalette({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  const custom = !PALETTE.includes(value.toLowerCase())
  return (
    <div className="palette" role="radiogroup" aria-label={label}>
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={`Цвет ${c}`}
          style={{ background: c }} onClick={() => onChange(c)}>
          {value.toLowerCase() === c && <Icon name="check" className="icon" />}
        </button>
      ))}
      <span className="custom" role="radio" aria-checked={custom} style={{ width: 28, height: 28, borderRadius: '50%', display: 'inline-grid' }}
        title="Свой цвет">
        <input type="color" value={value} aria-label="Свой цвет" onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  )
}

export function TagsPage() {
  const { data: tags, isLoading, error, refetch } = useTagsWithCounts()
  const create = useCreateTag()
  const toast = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setFormError('Введите название тега'); return }
    setFormError(null)
    try {
      await create.mutateAsync({ name: name.trim(), color })
      toast(`Тег «${name.trim()}» создан`)
      setName('')
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Теги</h1>
          <p className="lead">У каждой заметки есть хотя бы один тег. Цвет тега отображается в списке и календаре.</p>
        </div>
      </div>

      <form className="card new-tag" onSubmit={submit} noValidate>
        <h2>Новый тег</h2>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <label className="field" style={{ flex: '1 1 220px' }}>
            <span className="field-label">Название</span>
            <input className="input" placeholder="Например, «Работа»" value={name} maxLength={50}
              onChange={(e) => { setName(e.target.value); setFormError(null) }}
              aria-invalid={!!formError} aria-describedby={formError ? 'tag-form-error' : undefined} />
          </label>
          <div className="field">
            <span className="field-label">Цвет</span>
            <ColorPalette value={color} onChange={setColor} label="Цвет нового тега" />
          </div>
        </div>
        {formError && <span className="field-error" id="tag-form-error" role="alert">{formError}</span>}
        <div><button className="btn btn-primary" type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner label="Создание" /> : <Icon name="plus" />}Создать тег
        </button></div>
      </form>

      {error && !tags ? <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>
        : isLoading ? <SkeletonList rows={3} height={120} />
        : tags!.length === 0 ? <div className="card"><EmptyState icon="tag" title="Тегов пока нет">Создайте первый тег — например, «Работа» или «Дом».</EmptyState></div>
        : <div className="tag-grid">{tags!.map((t) => <TagCard key={t.id} tag={t} />)}</div>}
    </>
  )
}

function TagCard({ tag }: { tag: TagWithCount }) {
  const update = useUpdateTag()
  const del = useDeleteTag()
  const confirm = useConfirm()
  const toast = useToast()
  const [name, setName] = useState(tag.name)
  const [editingColor, setEditingColor] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = name.trim() !== tag.name

  async function rename() {
    if (!name.trim() || !dirty) { setName(tag.name); return }
    setError(null)
    try {
      await update.mutateAsync({ id: tag.id, name: name.trim() })
      toast('Тег переименован')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function recolor(c: string) {
    setError(null)
    try { await update.mutateAsync({ id: tag.id, color: c }) } catch (err) { setError((err as Error).message) }
  }

  async function remove() {
    if (!(await confirm({
      title: `Удалить тег «${tag.name}»?`, danger: true, confirmLabel: 'Удалить тег',
      message: tag.note_count ? `Тег снимется с ${tag.note_count} заметок. Если у заметки это единственный тег, удаление будет отклонено.` : 'Тег не используется в заметках.',
    }))) return
    setError(null)
    try {
      await del.mutateAsync(tag.id)
      toast(`Тег «${tag.name}» удалён`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="card tag-card" data-testid="tag-card">
      <div className="tag-card-head">
        <button type="button" className="swatch" style={{ background: tag.color }} onClick={() => setEditingColor((v) => !v)}
          aria-expanded={editingColor} aria-label={`Изменить цвет тега ${tag.name}`}><Icon name="tag" /></button>
        <label className="field" style={{ flex: 1 }}>
          <span className="sr-only">Название тега</span>
          <input className="input" value={name} maxLength={50} aria-label="Название"
            onChange={(e) => setName(e.target.value)} onBlur={rename}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(tag.name) }} />
        </label>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={remove} aria-label={`Удалить тег ${tag.name}`}><Icon name="trash" /></button>
      </div>
      {editingColor && <ColorPalette value={tag.color} onChange={recolor} label={`Цвет тега ${tag.name}`} />}
      <div className="row small muted">
        <Link to={`/notes?tag=${tag.id}`}>{tag.note_count ? `${tag.note_count.toLocaleString('ru')} заметок` : 'Нет заметок'}</Link>
        {dirty && <span className="xsmall">Enter — сохранить, Esc — отменить</span>}
      </div>
      {error && <div className="banner banner-error" role="alert"><Icon name="alert" /><div>{error}</div></div>}
    </div>
  )
}
