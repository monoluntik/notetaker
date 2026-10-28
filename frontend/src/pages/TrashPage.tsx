import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { api, isEditConflict } from '../api/client'
import { keys, useEmptyTrash, useInvalidateAll, usePurgeNote, useRestoreNote, useSettings, useUserTz } from '../api/hooks'
import type { Note, Page } from '../api/types'
import { TagBadge } from '../components/ui/controls'
import { useConfirm, useToast } from '../components/ui/feedback'
import { Icon } from '../components/ui/Icon'
import { EmptyState, ErrorState, SkeletonList } from '../components/ui/states'
import { formatDateTime } from '../lib/time'

export function TrashPage() {
  const tz = useUserTz()
  const confirm = useConfirm()
  const toast = useToast()
  const invalidate = useInvalidateAll()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...keys.notes, 'trash'], queryFn: () => api<Page<Note>>('/trash?page_size=200') })
  const restore = useRestoreNote()
  const purge = usePurgeNote()
  const empty = useEmptyTrash()
  const retention = useSettings().data?.trash_retention_days ?? 30
  const purgeAt = (deletedAt: string) => DateTime.fromISO(deletedAt).plus({ days: retention })

  const fail = (err: unknown) => {
    invalidate()
    toast(isEditConflict(err) ? 'Заметку только что изменили в другой вкладке — список обновлён' : (err as Error).message, 'error')
  }

  async function doRestore(n: Note) {
    try { await restore.mutateAsync({ id: n.id, version: n.version }); toast(`«${n.title}» восстановлена`) } catch (e) { fail(e) }
  }
  async function doPurge(n: Note) {
    if (!(await confirm({ title: 'Удалить навсегда?', danger: true, confirmLabel: 'Удалить навсегда',
      message: <>Заметка «{n.title}»{n.recurrence ? ' (вся серия)' : ''} будет удалена без возможности восстановления.</> }))) return
    try { await purge.mutateAsync({ id: n.id, version: n.version }); toast('Заметка удалена навсегда') } catch (e) { fail(e) }
  }
  async function doEmpty() {
    if (!(await confirm({ title: 'Очистить корзину?', danger: true, confirmLabel: 'Очистить',
      message: `Все заметки в корзине (${data?.total ?? 0}) будут удалены без возможности восстановления.` }))) return
    try { const r = await empty.mutateAsync(undefined); toast(`Удалено заметок: ${r.deleted}`) } catch (e) { fail(e) }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Корзина</h1>
          <p className="lead">Заметки удаляются отсюда навсегда автоматически через {retention} дней.</p>
        </div>
        <button className="btn btn-danger-ghost" disabled={!data?.total} onClick={doEmpty}><Icon name="trash" />Очистить корзину</button>
      </div>
      {error && !data ? <div className="card"><ErrorState error={error} onRetry={() => refetch()} /></div>
        : isLoading ? <SkeletonList rows={3} />
        : data!.items.length === 0 ? <div className="card"><EmptyState icon="trash" title="Корзина пуста">Удалённые заметки появятся здесь, и их можно будет восстановить.</EmptyState></div>
        : (
          <ul className="note-list">
            {data!.items.map((n) => {
              const days = Math.max(0, Math.ceil(purgeAt(n.deleted_at!).diffNow('days').days))
              return (
                <li key={n.id} className="card trash-item">
                  <div className="grow">
                    <span className="note-title clamp-2">{n.title}</span>
                    <span className="note-meta">
                      {n.tags.map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)}
                      {n.recurrence && <span className="meta-item"><Icon name="repeat" />серия</span>}
                    </span>
                    <span className="xsmall muted">
                      Удалена {formatDateTime(n.deleted_at!, tz)} · удалится навсегда через {days} дн. ({formatDateTime(purgeAt(n.deleted_at!).toUTC().toISO()!, tz)})
                    </span>
                  </div>
                  <div className="row wrap">
                    <button className="btn" onClick={() => doRestore(n)}><Icon name="restore" />Восстановить</button>
                    <button className="btn btn-danger-ghost" onClick={() => doPurge(n)}>Удалить навсегда</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
    </>
  )
}
