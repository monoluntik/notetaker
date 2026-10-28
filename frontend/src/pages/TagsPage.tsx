import { useState, type FormEvent } from 'react'
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '../api/hooks'
import type { TagWithCount } from '../api/types'

export function TagsPage() {
  const { data: tags = [] } = useTags()
  const create = useCreateTag()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({ name, color })
      setName('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section>
      <h1>Теги</h1>
      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Название тега" value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Цвет" />
        <button className="primary" type="submit">Добавить</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="tag-list">
        {tags.map((t) => <TagRow key={t.id} tag={t} />)}
        {tags.length === 0 && <li className="muted">Тегов пока нет</li>}
      </ul>
    </section>
  )
}

function TagRow({ tag }: { tag: TagWithCount }) {
  const update = useUpdateTag()
  const del = useDeleteTag()
  const [name, setName] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)

  const run = async (p: Promise<unknown>) => {
    setError(null)
    try { await p } catch (err) { setError((err as Error).message); setName(tag.name) }
  }

  return (
    <li>
      <input type="color" value={tag.color} aria-label={`Цвет тега ${tag.name}`}
        onChange={(e) => run(update.mutateAsync({ id: tag.id, color: e.target.value }))} />
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Название"
        onBlur={() => name.trim() && name !== tag.name && run(update.mutateAsync({ id: tag.id, name }))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="muted small">{tag.note_count} заметок</span>
      <button className="danger" onClick={() => confirm(`Удалить тег «${tag.name}»?`) && run(del.mutateAsync(tag.id))}>Удалить</button>
      {error && <p className="error small" role="alert">{error}</p>}
    </li>
  )
}
