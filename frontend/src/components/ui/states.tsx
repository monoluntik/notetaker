import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Spinner({ label = 'Загрузка' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />
}

export function SkeletonList({ rows = 5, height = 68 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height }} />)}
    </div>
  )
}

export function EmptyState({ icon = 'note', title, children, action }: {
  icon?: IconName; title: string; children?: ReactNode; action?: ReactNode
}) {
  return (
    <div className="state" data-testid="empty-state">
      <div className="state-icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  const network = /fetch|network|Failed/i.test(msg)
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon"><Icon name={network ? 'wifiOff' : 'alert'} /></div>
      <h3>{network ? 'Нет связи с сервером' : 'Не удалось загрузить данные'}</h3>
      <p>{network ? 'Проверьте подключение — данные загрузятся, когда сервер снова будет доступен.' : msg}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Повторить</button>}
    </div>
  )
}
