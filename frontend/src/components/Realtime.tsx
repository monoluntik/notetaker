import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { keys, useUserTz } from '../api/hooks'
import type { AppNotification } from '../api/types'
import { claimOnce, pruneClaims, showSystemNotification } from '../lib/notify'
import { formatDateTime } from '../lib/time'
import { useOpenEditor } from './NoteEditor'

const OFFSET_TEXT: Record<number, string> = { 10: 'через 10 минут', 60: 'через 1 час', 1440: 'через 1 день' }

/**
 * WebSocket-соединение вкладки: синхронизация данных между вкладками и уведомления о напоминаниях.
 * Email отправляет только сервер, поэтому число вкладок на него не влияет.
 */
export function Realtime() {
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
    pruneClaims()
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
          claimOnce(n.id).then((mine) => {
            if (mine) showSystemNotification(n.id, `Напоминание: ${n.title}`, OFFSET_TEXT[n.offset_minutes] ?? '')
          })
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
      clearTimeout(timer)
      ws?.close()
    }
  }, [qc, add])

  const markRead = (ids: number[]) => {
    setItems((prev) => prev.filter((p) => !ids.includes(p.id)))
    api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => {})
  }

  return (
    <>
      <span className={`badge ${online ? 'ok' : 'err'}`} title="Обновления в реальном времени">
        {online ? 'онлайн' : 'нет соединения'}
      </span>
      {items.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {items.length > 1 && <button className="small" onClick={() => markRead(items.map((i) => i.id))}>Скрыть все</button>}
          {items.map((n) => (
            <div key={n.id} className="toast" data-testid="reminder-toast">
              <strong>🔔 {n.title}</strong>
              <span className="small">
                {OFFSET_TEXT[n.offset_minutes]} · {formatDateTime(n.occurrence_start, tz)}
                {n.late && ' · с опозданием'}
              </span>
              <span className="row">
                <button className="small" onClick={() => { markRead([n.id]); open({ kind: 'note', noteId: n.note_id }) }}>Открыть</button>
                <button className="small" onClick={() => markRead([n.id])}>Прочитано</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
