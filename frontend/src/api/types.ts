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
}

export interface NoteInput {
  title: string
  body: string
  start_at: string
  timezone: string
  tag_ids: number[]
  is_active: boolean
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
}

export interface Upcoming {
  now: string
  timezone: string
  day_end: string
  week_end: string
  today: Occurrence[]
  week: Occurrence[]
  overdue: Occurrence[]
}
