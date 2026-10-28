/**
 * Системное уведомление браузера должно появиться один раз, даже если открыто несколько вкладок.
 * Каждая вкладка получает событие по WebSocket; «право» показать уведомление забирает первая
 * вкладка, записавшая метку в localStorage (общий для вкладок одного origin). Проверка и запись
 * выполняются под Web Lock, поэтому гонки между вкладками нет. Дополнительно Notification.tag
 * совпадает с id — браузер сам заменяет одинаковые уведомления.
 */
const KEY = (id: number) => `notetaker:notified:${id}`

export async function claimOnce(id: number, storage: Storage = localStorage,
  locks: LockManager | undefined = globalThis.navigator?.locks): Promise<boolean> {
  const tryClaim = () => {
    if (storage.getItem(KEY(id))) return false
    storage.setItem(KEY(id), String(Date.now()))
    return true
  }
  if (!locks) return tryClaim()
  return locks.request(`notetaker-notify-${id}`, async () => tryClaim())
}

export function showSystemNotification(id: number, title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(title, { body, tag: `reminder-${id}` })
}

/** Убираем старые метки, чтобы localStorage не рос бесконечно. */
export function pruneClaims(storage: Storage = localStorage, maxAgeMs = 7 * 24 * 3600_000) {
  const now = Date.now()
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i)
    if (k?.startsWith('notetaker:notified:') && now - Number(storage.getItem(k)) > maxAgeMs) storage.removeItem(k)
  }
}
