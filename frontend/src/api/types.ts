export interface Tag {
  id: number
  name: string
  color: string
}

export interface TagWithCount extends Tag {
  note_count: number
}

export interface Note {
  id: number
  title: string
  body: string
  start_at: string // UTC ISO
  timezone: string
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  tags: Tag[]
  recurrence: Recurrence | null
  reminders: number[]
  version: number
}

export type Freq = 'daily' | 'weekly' | 'monthly'

export interface Recurrence {
  freq: Freq
  until: string // yyyy-mm-dd, локальная дата в поясе заметки, включительно
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface UserSettings {
  email: string | null
  timezone: string
  trash_retention_days?: number
}

export interface NoteInput {
  title: string
  body: string
  start_at: string
  timezone: string
  tag_ids: number[]
  is_active: boolean
  recurrence: Recurrence | null
  reminders: number[]
  version?: number
}

export interface OccurrenceInput {
  title?: string
  body?: string
  start_at?: string
  is_active?: boolean
  version?: number
}

export interface Occurrence {
  note_id: number
  original_start: string
  start_at: string
  title: string
  body: string
  is_active: boolean
  timezone: string
  tags: Tag[]
  is_recurring: boolean
  is_exception: boolean
  note_version: number
}

export interface Upcoming {
  now: string
  timezone: string
  day_end: string
  week_end: string
  today: Occurrence[]
  week: Occurrence[]
  overdue: Occurrence[]
  overdue_total: number
  today_total: number
  week_total: number
}

export interface AppNotification {
  id: number
  note_id: number
  original_start: string
  occurrence_start: string
  fire_at: string
  offset_minutes: number
  title: string
  status: string
  late: boolean
  created_at: string
  read_at: string | null
}
