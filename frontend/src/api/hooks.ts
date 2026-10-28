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

function useNotesMutation<TVars, TResult>(fn: (v: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: fn, onSuccess: invalidate })
}

export const useCreateNote = () =>
  useNotesMutation((v: NoteInput) => api<Note>('/notes', { method: 'POST', body: JSON.stringify(v) }))

export const useUpdateNote = () =>
  useNotesMutation(({ id, ...v }: Partial<NoteInput> & { id: number }) =>
    api<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(v) }),
  )

export const useTrashNote = () => useNotesMutation((id: number) => api<Note>(`/notes/${id}`, { method: 'DELETE' }))
export const useRestoreNote = () =>
  useNotesMutation((id: number) => api<Note>(`/notes/${id}/restore`, { method: 'POST' }))
export const usePurgeNote = () =>
  useNotesMutation((id: number) => api<void>(`/notes/${id}/purge`, { method: 'DELETE' }))
export const useEmptyTrash = () => useNotesMutation(() => api<{ deleted: number }>('/trash', { method: 'DELETE' }))

export const useCreateTag = () =>
  useNotesMutation((v: { name: string; color: string }) =>
    api<Tag>('/tags', { method: 'POST', body: JSON.stringify(v) }),
  )
export const useUpdateTag = () =>
  useNotesMutation(({ id, ...v }: { id: number; name?: string; color?: string }) =>
    api<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(v) }),
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

export function useOccurrence(noteId: number, originalStart: string) {
  return useQuery({
    queryKey: [...keys.notes, 'occurrence', noteId, originalStart],
    queryFn: () => api<Occurrence>(occUrl(noteId, originalStart)),
  })
}

export const useUpdateOccurrence = () =>
  useNotesMutation(({ noteId, originalStart, ...v }: OccurrenceInput & { noteId: number; originalStart: string }) =>
    api<Occurrence>(occUrl(noteId, originalStart), { method: 'PATCH', body: JSON.stringify(v) }),
  )
export const useCancelOccurrence = () =>
  useNotesMutation(({ noteId, originalStart }: { noteId: number; originalStart: string }) =>
    api<void>(occUrl(noteId, originalStart), { method: 'DELETE' }),
  )
export const useResetOccurrence = () =>
  useNotesMutation(({ noteId, originalStart }: { noteId: number; originalStart: string }) =>
    api<Occurrence>(`${occUrl(noteId, originalStart)}/override`, { method: 'DELETE' }),
  )
