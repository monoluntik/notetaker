import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { keys, useUserTz } from '../api/hooks'
import type { AppNotification } from '../api/types'
import { electLeader, pruneClaims, pruneShown, rememberShown, shouldShowSystemNotification, showSystemNotification, wasShown } from '../lib/notify'
import { formatDateTime, formatUntil } from '../lib/time'
import { useOpenEditor } from './NoteEditor'
import { Icon } from './ui/Icon'

const MAX_VISIBLE = 3 // больше карточек закрывают страницу; остальные — по кнопке «Ещё N»

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
  const tzRef = useRef(tz)  // для обработчика WebSocket: смена пояса не должна переподключать сокет
  useEffect(() => { tzRef.current = tz }, [tz])
  const open = useOpenEditor()
  const [items, setItems] = useState<AppNotification[]>([])
  const [online, setOnline] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // «через N минут» в тостах пересчитывается, пока карточка висит на экране
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (items.length === 0) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [items.length])

  const add = useCallback((list: AppNotification[]) => {
    rememberShown(list.map((n) => n.id))
    setItems((prev) => {
      const ids = new Set(prev.map((p) => p.id))
      return [...prev, ...list.filter((n) => !ids.has(n.id))]
    })
  }, [])

  useEffect(() => {
    try { pruneClaims(); pruneShown() } catch { /* localStorage может быть недоступен */ }
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
        // После (пере)подключения: непрочитанные уведомления, ещё не показанные в этом браузере
        // (однажды показанное не всплывает снова после обновления страницы), и свежие данные
        api<AppNotification[]>('/notifications').then((list) => add(list.filter((n) => !wasShown(n.id)))).catch(() => {})
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
            showSystemNotification(n.id, `Напоминание: ${n.title}`, `${formatUntil(n.occurrence_start, new Date())} · ${formatDateTime(n.occurrence_start, tzRef.current)}`)
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

  // Новые напоминания добавляются в конец — в свёрнутом виде видны самые свежие
  const showAll = expanded && items.length > MAX_VISIBLE
  const visible = showAll ? items : items.slice(-MAX_VISIBLE)
  const hidden = items.length - visible.length

  return (
    <ConnectionContext.Provider value={{ online }}>
      {children}
      {items.length > 0 && (
        <div className={`toasts reminder-toasts${showAll ? ' expanded' : ''}`} style={{ bottom: undefined, top: 'var(--s4)' }}
          aria-live="polite" role="region" aria-label="Напоминания">
          {items.length > 1 && (
            <span className="row" style={{ alignSelf: 'flex-end' }}>
              {hidden > 0 && (
                <button className="btn btn-sm" style={{ pointerEvents: 'auto' }} onClick={() => setExpanded(true)} data-testid="reminder-toasts-more">
                  Ещё {hidden}
                </button>
              )}
              {showAll && items.length > MAX_VISIBLE && (
                <button className="btn btn-sm" style={{ pointerEvents: 'auto' }} onClick={() => setExpanded(false)}>Свернуть</button>
              )}
              <button className="btn btn-sm" style={{ pointerEvents: 'auto' }} onClick={() => markRead(items.map((i) => i.id))}>
                Скрыть все ({items.length})
              </button>
            </span>
          )}
          {visible.map((n) => (
            <div key={n.id} className="reminder-toast" data-testid="reminder-toast">
              <strong><Icon name="bell" />{n.title}</strong>
              <span className="small muted">
                {formatUntil(n.occurrence_start, now)} · {formatDateTime(n.occurrence_start, tz)}{n.late && ' · с опозданием'}
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
