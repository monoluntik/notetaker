/**
 * Системное уведомление браузера должно появиться один раз, даже если открыто несколько вкладок.
 *
 * Каждая вкладка получает событие по WebSocket и показывает его внутри страницы, а системное
 * уведомление показывает только вкладка-«лидер». Лидер — вкладка, удерживающая Web Lock
 * `notetaker-leader` всё время, пока она открыта; блокировки согласует сам браузер, поэтому
 * двух лидеров одновременно не бывает. Когда лидер закрывается, блокировку получает следующая
 * вкладка.
 *
 * Первая версия делала «захват» через метку в localStorage под Web Lock, но e2e-тест показал
 * 2 уведомления: вкладки Chromium работают в разных процессах, и запись в localStorage доходит
 * до другой вкладки асинхронно. Метка оставлена только как запасной вариант для браузеров без
 * Web Locks. Дополнительно Notification.tag = id: браузер заменяет одинаковые уведомления.
 */

const LOCK_NAME = 'notetaker-leader'

export interface Leadership {
  isLeader: () => boolean
  release: () => void
}

export function electLeader(locks: LockManager | undefined = globalThis.navigator?.locks): Leadership {
  if (!locks) return { isLeader: () => false, release: () => {} }
  let leader = false
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  locks
    .request(LOCK_NAME, async () => {
      leader = true
      await held // держим блокировку, пока вкладка открыта
      leader = false
    })
    .catch(() => { leader = false })
  return { isLeader: () => leader, release: () => release() }
}

const KEY = (id: number) => `notetaker:notified:${id}`

/** Запасной вариант без Web Locks: первая вкладка, увидевшая id, показывает уведомление. */
export function claimOnceFallback(id: number, storage: Storage = localStorage): boolean {
  if (storage.getItem(KEY(id))) return false
  storage.setItem(KEY(id), String(Date.now()))
  return true
}

export function shouldShowSystemNotification(id: number, leadership: Leadership,
  hasLocks = !!globalThis.navigator?.locks): boolean {
  return hasLocks ? leadership.isLeader() : claimOnceFallback(id)
}

export function showSystemNotification(id: number, title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(title, { body, tag: `reminder-${id}` })
}

/** Убираем старые метки запасного варианта, чтобы localStorage не рос бесконечно. */
export function pruneClaims(storage: Storage = localStorage, maxAgeMs = 7 * 24 * 3600_000) {
  const now = Date.now()
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i)
    if (k?.startsWith('notetaker:notified:') && now - Number(storage.getItem(k)) > maxAgeMs) storage.removeItem(k)
  }
}

/**
 * Требование задания: «однажды показанное уведомление не всплывает снова после обновления
 * страницы». Показанные в этом браузере id запоминаются; при (пере)загрузке непрочитанных с
 * сервера уже показанные отбрасываются. Живое событие по WebSocket показывается во всех
 * открытых вкладках (оно приходит один раз). Метки старше 7 дней удаляет pruneShown.
 */
const SHOWN = (id: number) => `notetaker:shown:${id}`

function safeStorage(storage?: Storage): Storage | null {
  try { return storage ?? globalThis.localStorage ?? null } catch { return null }
}

export function rememberShown(ids: number[], storage?: Storage) {
  const s = safeStorage(storage)
  if (!s) return
  for (const id of ids) {
    try { if (!s.getItem(SHOWN(id))) s.setItem(SHOWN(id), String(Date.now())) } catch { /* хранилище недоступно */ }
  }
}

export function wasShown(id: number, storage?: Storage): boolean {
  const s = safeStorage(storage)
  try { return !!s?.getItem(SHOWN(id)) } catch { return false }
}

export function pruneShown(storage?: Storage, maxAgeMs = 7 * 24 * 3600_000) {
  const s = safeStorage(storage)
  if (!s) return
  const now = Date.now()
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i)
    if (k?.startsWith('notetaker:shown:') && now - Number(s.getItem(k)) > maxAgeMs) s.removeItem(k)
  }
}
