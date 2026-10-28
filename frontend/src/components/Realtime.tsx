import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { keys, useUserTz } from '../api/hooks'
import type { AppNotification } from '../api/types'
import { electLeader, pruneClaims, shouldShowSystemNotification, showSystemNotification } from '../lib/notify'
import { formatDateTime } from '../lib/time'
import { useOpenEditor } from './NoteEditor'
import { Icon } from './ui/Icon'

const OFFSET_TEXT: Record<number, string> = { 10: 'через 10 минут', 60: 'через 1 час', 1440: 'через 1 день' }

const ConnectionContext = createContext({ online: false })
// eslint-disable-next-line react-refresh/only-export-components
export const useConnection = () => useContext(ConnectionContext)

/**
 * WebSocket-соединение вкладки: синхронизация данных между вкладками и уведомления о напоминаниях.
 * Email отправляет только сервер, поэтому число вкладок на него не влияет.
 */
export function Realtime({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const tz = useUserTz()
  const open = useOpenEditor()
  const [items, setItems] = useState<AppNotification[]>([])
  const [online, setOnline] = useState(false)

  const add = useCallback((list: AppNotification[]) => {
    setItems((prev) => {
      const ids = new Set(prev.map((p) => p.id))
      return [...prev, ...list.filter((n) => !ids.has(n.id))]
    })
  }, [])

  useEffect(() => {
    try { pruneClaims() } catch { /* localStorage может быть недоступен */ }
    const leadership = electLeader()
    let ws: WebSocket | null = null
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        retry = 0
        setOnline(true)
        // После (пере)подключения: непрочитанные уведомления и свежие данные
        api<AppNotification[]>('/notifications').then(add).catch(() => {})
        qc.invalidateQueries({ queryKey: keys.notes })
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'changed') {
          qc.invalidateQueries({ queryKey: keys.notes })
          qc.invalidateQueries({ queryKey: keys.tags })
          if (String(msg.path).startsWith('/api/settings')) qc.invalidateQueries({ queryKey: keys.settings })
        } else if (msg.type === 'reminder') {
          const n = msg.notification as AppNotification
          add([n])
          // Системное уведомление — только во вкладке-лидере (одно на все вкладки)
          if (shouldShowSystemNotification(n.id, leadership)) {
            showSystemNotification(n.id, `Напоминание: ${n.title}`, OFFSET_TEXT[n.offset_minutes] ?? '')
          }
        } else if (msg.type === 'notifications_read') {
          const ids = new Set<number>(msg.ids)
          setItems((prev) => prev.filter((p) => !ids.has(p.id)))
        }
      }
      ws.onclose = () => {
        setOnline(false)
        if (stopped) return
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++))
      }
    }
    connect()
    return () => {
      stopped = true
      leadership.release()
      clearTimeout(timer)
      ws?.close()
    }
  }, [qc, add])

  const markRead = (ids: number[]) => {
    api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) })
      .then(() => setItems((prev) => prev.filter((p) => !ids.includes(p.id))))
      .catch(() => {})
  }

  return (
    <ConnectionContext.Provider value={{ online }}>
      {children}
      {items.length > 0 && (
        <div className="toasts" style={{ bottom: undefined, top: 'var(--s4)' }} aria-live="polite" role="region" aria-label="Напоминания">
          {items.length > 1 && (
            <button className="btn btn-sm" style={{ pointerEvents: 'auto', alignSelf: 'flex-end' }} onClick={() => markRead(items.map((i) => i.id))}>
              Скрыть все ({items.length})
            </button>
          )}
          {items.map((n) => (
            <div key={n.id} className="reminder-toast" data-testid="reminder-toast">
              <strong><Icon name="bell" />{n.title}</strong>
              <span className="small muted">
                {OFFSET_TEXT[n.offset_minutes]} · {formatDateTime(n.occurrence_start, tz)}{n.late && ' · с опозданием'}
              </span>
              <span className="row">
                <button className="btn btn-sm btn-primary" onClick={() => { markRead([n.id]); open({ kind: 'note', noteId: n.note_id }) }}>Открыть</button>
                <button className="btn btn-sm" onClick={() => markRead([n.id])}>Прочитано</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </ConnectionContext.Provider>
  )
}
