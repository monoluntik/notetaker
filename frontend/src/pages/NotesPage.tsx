import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { isEditConflict } from '../api/client'
import { useInvalidateAll, useNotesPage, useTags, useUpdateNote, useUserTz } from '../api/hooks'
import type { Note } from '../api/types'
import { useOpenEditor } from '../components/NoteEditor'
import { NoteCard } from '../components/NoteCard'
import { Segmented, Switch, TogglePill } from '../components/ui/controls'
import { useToast } from '../components/ui/feedback'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, SkeletonList, Spinner } from '../components/ui/states'
import { localDateToUtc } from '../lib/time'
import { useIsMobile } from '../lib/useMedia'

const PAGE_SIZE = 20
const FILTER_KEYS = ['q', 'tag', 'active', 'from', 'to']

export function NotesPage() {
  const tz = useUserTz()
  const open = useOpenEditor()
  const toast = useToast()
  const invalidate = useInvalidateAll()
  const isMobile = useIsMobile()
  const { data: tags = [] } = useTags()
  const toggle = useUpdateNote()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)

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
    const id = setTimeout(() => { if ((params.get('q') ?? '') !== search) set({ q: search }) }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const selectedTags = params.getAll('tag')
  const page = Number(params.get('page') ?? 1)
  const activeFilters = ['tag', 'active', 'from', 'to'].reduce((n, k) => n + (params.getAll(k).length ? 1 : 0), 0)
  const hasFilters = FILTER_KEYS.some((k) => params.has(k))
  const resetFilters = () => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }

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

  const { data, isLoading, isFetching, error, refetch } = useNotesPage(apiParams)
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const totalText = data ? `${data.total.toLocaleString('ru')}${data.total_capped ? '+' : ''}` : ''
  const from = data && data.total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = data ? Math.min(page * PAGE_SIZE, data.total) : 0

  async function toggleActive(n: Note) {
    try {
      await toggle.mutateAsync({ id: n.id, version: n.version, is_active: !n.is_active })
      toast(n.is_active ? `«${n.title}» — неактивна` : `«${n.title}» — активна`)
    } catch (err) {
      invalidate()
      toast(isEditConflict(err) ? 'Заметку только что изменили в другой вкладке — данные обновлены, повторите действие' : (err as Error).message, 'error')
    }
  }

  const filterPanel = (
    <div className="card card-pad stack" id="filters" style={{ gap: 'var(--s4)' }}>
      <div className="filters-row">
        <div className="field" style={{ flex: '0 1 auto' }}>
          <span className="field-label">Статус</span>
          <Segmented label="Статус" value={params.get('active') ?? ''} onChange={(v) => set({ active: v })}
            options={[['', 'Все'], ['true', 'Активные'], ['false', 'Неактивные']]} />
        </div>
        <label className="field">
          <span className="field-label">С даты</span>
          <input className="input" type="date" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">По дату</span>
          <input className="input" type="date" value={params.get('to') ?? ''} min={params.get('from') ?? undefined} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>
      {tags.length > 0 && (
        <div className="field">
          <span className="field-label" id="tag-filter-label">Теги <span className="muted">· любой из выбранных</span></span>
          <div className="chips" role="group" aria-labelledby="tag-filter-label">
            {tags.map((t) => {
              const on = selectedTags.includes(String(t.id))
              return (
                <TogglePill key={t.id} color={t.color} pressed={on}
                  onClick={() => set({ tag: on ? selectedTags.filter((x) => x !== String(t.id)) : [...selectedTags, String(t.id)] })}>
                  {t.name}
                </TogglePill>
              )
            })}
          </div>
        </div>
      )}
      {hasFilters && <div><button className="btn btn-sm btn-ghost" onClick={resetFilters}><Icon name="x" />Сбросить фильтры</button></div>}
    </div>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Заметки</h1>
          <p className="lead">Поиск и фильтры применяются ко всем заметкам, а не только к текущей странице.</p>
        </div>
        <Link to="/trash" className="btn btn-ghost"><Icon name="trash" />Корзина</Link>
      </div>

      <div className="toolbar">
        <label className="input-with-icon grow">
          <Icon name="search" />
          <span className="sr-only">Поиск</span>
          <input className="input" type="search" placeholder="Поиск по заголовку и тексту" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
        </label>
        {isMobile && (
          <button className="btn" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen((v) => !v)}>
            <Icon name="filter" />Фильтры{activeFilters > 0 && <span className="count">{activeFilters}</span>}
          </button>
        )}
        <label className="field" style={{ flex: '0 1 220px' }}>
          <span className="sr-only">Сортировка</span>
          <select className="select" aria-label="Сортировка" value={`${params.get('sort') ?? 'start_at'}:${params.get('order') ?? 'asc'}`}
            onChange={(e) => { const [s, o] = e.target.value.split(':'); set({ sort: s, order: o }) }}>
            <option value="start_at:asc">Сначала ранние</option>
            <option value="start_at:desc">Сначала поздние</option>
            <option value="updated_at:desc">Недавно изменённые</option>
            <option value="updated_at:asc">Давно изменённые</option>
          </select>
        </label>
      </div>
      {(!isMobile || filtersOpen) && filterPanel}

      <div className="list-meta" aria-live="polite">
        {data ? <span data-testid="list-range">{data.total ? `${from}–${to} из ${totalText}` : 'Ничего не найдено'}</span> : <span>&nbsp;</span>}
        {data?.total_capped && <span className="xsmall">Уточните поиск или фильтры, чтобы увидеть точное число.</span>}
        {isFetching && !isLoading && <Spinner label="Обновление" />}
      </div>

      {error && !data ? <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>
        : isLoading ? <SkeletonList rows={6} height={88} />
        : data && data.items.length === 0 ? (
          <div className="card" data-testid="notes-empty">
            {hasFilters ? (
              <EmptyState icon="search" title="Ничего не найдено" action={<button className="btn" onClick={resetFilters}>Сбросить фильтры</button>}>
                Попробуйте изменить запрос или условия фильтрации.
              </EmptyState>
            ) : tags.length === 0 ? (
              <EmptyState icon="tag" title="Заметок пока нет" action={<Link to="/tags" className="btn btn-primary">Создать тег</Link>}>
                У каждой заметки есть хотя бы один тег — начните с создания тега. Его можно создать и прямо в форме заметки.
              </EmptyState>
            ) : (
              <EmptyState icon="note" title="Заметок пока нет" action={<button className="btn btn-primary" onClick={() => open({ kind: 'new' })}><Icon name="plus" />Создать первую заметку</button>}>
                Заметки привязаны к дате и времени, могут повторяться и напоминать о себе.
              </EmptyState>
            )}
          </div>
        ) : (
          <ul className="note-list">
            {data?.items.map((n) => (
              <NoteCard key={n.id} note={n} tz={tz} onOpen={() => open({ kind: 'note', noteId: n.id })}
                side={<Switch checked={n.is_active} onChange={() => toggleActive(n)} label={<span className="sr-only">Активна: {n.title}</span>} />} />
            ))}
          </ul>
        )}

      {data && data.total > PAGE_SIZE && (
        <nav className="pager" aria-label="Страницы">
          <button className="btn" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><Icon name="left" />Назад</button>
          <span className="list-meta">
            Страница
            <select className="select" style={{ width: 'auto' }} aria-label="Номер страницы" value={page}
              onChange={(e) => set({ page: e.target.value })}>
              {Array.from({ length: Math.min(pages, 500) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            из {pages}{data.total_capped ? '+' : ''}
          </span>
          <button className="btn" disabled={page >= pages && !data.total_capped} onClick={() => set({ page: String(page + 1) })}>Вперёд<Icon name="right" /></button>
        </nav>
      )}
    </>
  )
}
