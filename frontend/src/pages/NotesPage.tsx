import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNotesPage, useTags, useUpdateNote, useUserTz } from '../api/hooks'
import { useOpenEditor } from '../components/NoteEditor'
import { NoteRow } from '../components/NoteRow'
import { TagChip } from '../components/TagChip'
import { localDateToUtc } from '../lib/time'

const PAGE_SIZE = 20

export function NotesPage() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const { data: tags = [] } = useTags()
  const toggle = useUpdateNote()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')

  const set = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k)
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
      else if (v) next.set(k, v)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  // Поиск с задержкой, чтобы не слать запрос на каждый символ
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) set({ q: search })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const selectedTags = params.getAll('tag')
  const hasFilters = ['q', 'tag', 'active', 'from', 'to'].some((k) => params.has(k))
  const page = Number(params.get('page') ?? 1)

  // Параметры API: даты периода переводим из локальных дат пользователя в UTC
  const apiParams = new URLSearchParams()
  if (params.get('q')) apiParams.set('q', params.get('q')!)
  selectedTags.forEach((t) => apiParams.append('tag', t))
  if (params.get('active')) apiParams.set('active', params.get('active')!)
  if (params.get('from')) apiParams.set('from', localDateToUtc(params.get('from')!, tz))
  if (params.get('to')) apiParams.set('to', localDateToUtc(params.get('to')!, tz, true))
  apiParams.set('sort', params.get('sort') ?? 'start_at')
  apiParams.set('order', params.get('order') ?? 'asc')
  apiParams.set('page', String(page))
  apiParams.set('page_size', String(PAGE_SIZE))

  const { data, isFetching, error } = useNotesPage(apiParams)
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <section>
      <div className="page-head">
        <h1>Заметки</h1>
        <button className="primary" onClick={() => open({ kind: 'new' })}>+ Новая заметка</button>
      </div>

      <div className="filters">
        <input type="search" placeholder="Поиск по заголовку и тексту" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
        <select value={params.get('active') ?? ''} onChange={(e) => set({ active: e.target.value })} aria-label="Активность">
          <option value="">Все</option>
          <option value="true">Активные</option>
          <option value="false">Неактивные</option>
        </select>
        <label className="inline">с <input type="date" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="inline">по <input type="date" value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value })} /></label>
        <select value={`${params.get('sort') ?? 'start_at'}:${params.get('order') ?? 'asc'}`} aria-label="Сортировка"
          onChange={(e) => { const [s, o] = e.target.value.split(':'); set({ sort: s, order: o }) }}>
          <option value="start_at:asc">Дата заметки ↑</option>
          <option value="start_at:desc">Дата заметки ↓</option>
          <option value="updated_at:desc">Изменены недавно</option>
          <option value="updated_at:asc">Изменены давно</option>
        </select>
      </div>
      {tags.length > 0 && (
        <div className="chips filter-tags">
          <span className="muted small">Теги:</span>
          {tags.map((t) => {
            const on = selectedTags.includes(String(t.id))
            return <TagChip key={t.id} tag={t} selected={on}
              onClick={() => set({ tag: on ? selectedTags.filter((x) => x !== String(t.id)) : [...selectedTags, String(t.id)] })} />
          })}
        </div>
      )}

      {error && <p className="error">{(error as Error).message}</p>}
      <p className="muted small">Найдено: {data?.total ?? '…'} {isFetching && '· обновление…'}</p>
      <ul className="note-list">
        {data?.items.map((n) => (
          <NoteRow key={n.id} note={n} tz={tz} onOpen={() => open({ kind: 'note', noteId: n.id })}
            extra={<label className="row small"><input type="checkbox" checked={n.is_active}
              onChange={() => toggle.mutate({ id: n.id, is_active: !n.is_active })} /> активна</label>} />
        ))}
        {data && data.items.length === 0 && (
          <li className="empty" data-testid="notes-empty">
            {hasFilters ? (
              <>Ничего не найдено по заданным условиям.{' '}
                <button className="small" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }}>
                  Сбросить фильтры
                </button>
              </>
            ) : tags.length === 0 ? (
              <>Заметок пока нет. У каждой заметки должен быть тег — начните с <Link to="/tags">создания тега</Link>.</>
            ) : (
              <>Заметок пока нет. <button className="small primary" onClick={() => open({ kind: 'new' })}>Создать первую заметку</button></>
            )}
          </li>
        )}
      </ul>

      <div className="pager">
        <button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>← Назад</button>
        <span>Страница {page} из {pages}</span>
        <button disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Вперёд →</button>
      </div>
    </section>
  )
}
