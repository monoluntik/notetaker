"""Вхождения заметок в окне времени.

Вхождение — конкретный момент заметки. У обычной заметки одно вхождение, у повторяющейся —
по одному на каждый период серии (разворачивается в services/recurrence.py, этап 5).
Календарь, «Предстоящие» и напоминания работают с вхождениями, а не с записями заметок.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Note, Tag


@dataclass(frozen=True)
class Occurrence:
    note_id: int
    original_start: datetime  # идентификатор вхождения в серии (UTC)
    start_at: datetime  # фактический момент (с учётом переноса отдельного вхождения)
    title: str
    body: str
    is_active: bool
    timezone: str
    tags: tuple[Tag, ...]
    is_recurring: bool = False
    is_exception: bool = False


def note_occurrences(note: Note, start: datetime, end: datetime) -> list[Occurrence]:
    """Вхождения одной заметки с start_at в [start, end)."""
    if start <= note.start_at < end:
        return [
            Occurrence(
                note_id=note.id,
                original_start=note.start_at,
                start_at=note.start_at,
                title=note.title,
                body=note.body,
                is_active=note.is_active,
                timezone=note.timezone,
                tags=tuple(note.tags),
            )
        ]
    return []


def occurrences_between(
    db: Session,
    start: datetime,
    end: datetime,
    *,
    tag_ids: list[int] | None = None,
    active: bool | None = None,
) -> list[Occurrence]:
    stmt = select(Note).where(Note.deleted_at.is_(None), Note.start_at >= start, Note.start_at < end)
    if tag_ids:
        stmt = stmt.where(Note.tags.any(Tag.id.in_(tag_ids)))
    result: list[Occurrence] = []
    for note in db.scalars(stmt):
        result.extend(note_occurrences(note, start, end))
    if active is not None:
        result = [o for o in result if o.is_active is active]
    result.sort(key=lambda o: (o.start_at, o.note_id))
    return result
