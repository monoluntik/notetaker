/**
 * Черновик формы и разрешение конфликта правок (D14).
 *
 * base — значения, с которыми пользователь открыл форму (версия N). draft — то, что он ввёл.
 * Если сервер ответил «заметку уже изменили» (версия M > N), мы загружаем актуальную версию и
 * переносим на неё только те поля, которые пользователь действительно менял. Поля, которые
 * изменились и у пользователя, и на сервере, показываем как требующие проверки.
 */
export type Draft = Record<string, unknown>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function changedFields<T extends Draft>(base: T, draft: T): (keyof T)[] {
  return (Object.keys(draft) as (keyof T)[]).filter((k) => !same(base[k], draft[k]))
}

export function isDirty<T extends Draft>(base: T, draft: T): boolean {
  return changedFields(base, draft).length > 0
}

export interface Rebased<T> {
  draft: T // актуальная версия + правки пользователя
  overlapping: (keyof T)[] // поля, изменённые и пользователем, и в другой вкладке
}

export function rebaseDraft<T extends Draft>(base: T, draft: T, fresh: T): Rebased<T> {
  const mine = changedFields(base, draft)
  const theirs = new Set(changedFields(base, fresh))
  const merged = { ...fresh }
  for (const k of mine) merged[k] = draft[k]
  return { draft: merged, overlapping: mine.filter((k) => theirs.has(k) && !same(draft[k], fresh[k])) }
}
