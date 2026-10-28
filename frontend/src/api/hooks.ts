import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Note, NoteInput, Occurrence, OccurrenceInput, Page, Tag, TagWithCount, UserSettings } from './types'

export const keys = {
  settings: ['settings'] as const,
  tags: ['tags'] as const,
  notes: ['notes'] as const, // префикс для всех запросов, зависящих от заметок
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<UserSettings>('/settings') })
}

/** Часовой пояс пользователя для отображения; до загрузки настроек — пояс браузера. */
export function useUserTz(): string {
  const { data } = useSettings()
  return data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api<TagWithCount[]>('/tags') })
}

export function useInvalidateAll() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: keys.notes })
    qc.invalidateQueries({ queryKey: keys.tags })
  }
}

/** Мутация с обновлением данных после ответа сервера (успех не показывается заранее). */
function useNotesMutation<TVars, TResult>(fn: (v: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: fn, onSettled: invalidate })
}

/* Каждое изменение заметки передаёт версию, которую видел клиент (D14): устаревшая → 409. */
type Versioned = { id: number; version: number }
const v = (version: number) => `version=${version}`

export const useCreateNote = () =>
  useNotesMutation((body: Omit<NoteInput, 'version'>) => api<Note>('/notes', { method: 'POST', body: JSON.stringify(body) }))

export const useUpdateNote = () =>
  useNotesMutation(({ id, ...body }: Partial<NoteInput> & Versioned) =>
    api<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  )

export const useTrashNote = () =>
  useNotesMutation(({ id, version }: Versioned) => api<Note>(`/notes/${id}?${v(version)}`, { method: 'DELETE' }))
export const useRestoreNote = () =>
  useNotesMutation(({ id, version }: Versioned) => api<Note>(`/notes/${id}/restore?${v(version)}`, { method: 'POST' }))
export const usePurgeNote = () =>
  useNotesMutation(({ id, version }: Versioned) => api<void>(`/notes/${id}/purge?${v(version)}`, { method: 'DELETE' }))
export const useEmptyTrash = () => useNotesMutation(() => api<{ deleted: number }>('/trash', { method: 'DELETE' }))

export const useCreateTag = () =>
  useNotesMutation((body: { name: string; color: string }) => api<Tag>('/tags', { method: 'POST', body: JSON.stringify(body) }))
export const useUpdateTag = () =>
  useNotesMutation(({ id, ...body }: { id: number; name?: string; color?: string }) =>
    api<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  )
export const useDeleteTag = () => useNotesMutation((id: number) => api<void>(`/tags/${id}`, { method: 'DELETE' }))

export function useNotesPage(params: URLSearchParams) {
  const qs = params.toString()
  return useQuery({
    queryKey: [...keys.notes, 'list', qs],
    queryFn: () => api<Page<Note>>(`/notes?${qs}`),
    placeholderData: (prev) => prev,
  })
}

const occUrl = (noteId: number, originalStart: string) =>
  `/notes/${noteId}/occurrences/${encodeURIComponent(originalStart)}`

type OccRef = { noteId: number; originalStart: string; version: number }

export function useOccurrence(noteId: number, originalStart: string) {
  return useQuery({
    queryKey: [...keys.notes, 'occurrence', noteId, originalStart],
    queryFn: () => api<Occurrence>(occUrl(noteId, originalStart)),
  })
}

export const useUpdateOccurrence = () =>
  useNotesMutation(({ noteId, originalStart, ...body }: Omit<OccurrenceInput, 'version'> & OccRef) =>
    api<Occurrence>(occUrl(noteId, originalStart), { method: 'PATCH', body: JSON.stringify(body) }),
  )
export const useCancelOccurrence = () =>
  useNotesMutation(({ noteId, originalStart, version }: OccRef) =>
    api<void>(`${occUrl(noteId, originalStart)}?${v(version)}`, { method: 'DELETE' }),
  )
export const useResetOccurrence = () =>
  useNotesMutation(({ noteId, originalStart, version }: OccRef) =>
    api<Occurrence>(`${occUrl(noteId, originalStart)}/override?${v(version)}`, { method: 'DELETE' }),
  )
/** Изменить серию начиная с этого вхождения; прошлые вхождения не меняются (D17). */
export const useSplitSeries = () =>
  useNotesMutation(({ noteId, originalStart, ...body }: Partial<NoteInput> & OccRef) =>
    api<Note>(`${occUrl(noteId, originalStart)}/split`, { method: 'POST', body: JSON.stringify(body) }),
  )
