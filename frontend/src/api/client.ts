export class ApiError extends Error {
  status: number // 0 — запрос не дошёл до сервера
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : formatDetail(detail) ?? `Ошибка сервера (HTTP ${status})`)
    this.status = status
    this.detail = detail
  }
}

const FIELD: Record<string, string> = {
  title: 'Заголовок', body: 'Текст', start_at: 'Дата и время', tag_ids: 'Теги', timezone: 'Часовой пояс',
  recurrence: 'Повторение', until: 'Дата окончания', reminders: 'Напоминания', email: 'Email', name: 'Название',
  color: 'Цвет', version: 'Версия',
}

function formatDetail(detail: unknown): string | undefined {
  if (Array.isArray(detail)) {
    // Ошибки валидации FastAPI: [{loc, msg}]
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const loc = (d.loc ?? []).slice(1).map((x) => FIELD[String(x)] ?? String(x)).join(' → ')
        const msg = (d.msg ?? '').replace(/^Value error, /, '')
        return loc ? `${loc}: ${msg}` : msg
      })
      .join('; ')
  }
  return undefined
}

/** Ключ запроса создания: повтор с тем же ключом (двойное нажатие, повтор после обрыва связи)
 *  не создаёт вторую запись (DECISIONS D21). randomUUID есть только в безопасном контексте. */
export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409
export const isEditConflict = (e: unknown) => isConflict(e) && /друг(ой|ом)/.test((e as Error).message)
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await apiWithHeaders<T>(path, init)).data
}

export async function apiWithHeaders<T>(path: string, init: RequestInit = {}): Promise<{ data: T; headers: Headers }> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Изменения не сохранены — проверьте подключение и повторите.')
  }
  if (res.status === 204) return { data: undefined as T, headers: res.headers }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status >= 500 && !body?.detail) throw new ApiError(res.status, 'Сервер временно недоступен. Повторите попытку позже.')
    throw new ApiError(res.status, body?.detail ?? body)
  }
  return { data: body as T, headers: res.headers }
}
