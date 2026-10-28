"""Вхождения заметок в окне времени.

Вхождение — конкретный момент заметки. У обычной заметки одно вхождение, у повторяющейся —
по одному на каждый период серии с учётом исключений (occurrence_overrides).
Календарь, «Предстоящие» и напоминания работают с вхождениями, а не с записями заметок.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.errors import Conflict, NotFound
from app.models import Note, OccurrenceOverride, Tag
from app.schemas import OccurrenceUpdate
from app.services.recurrence import is_occurrence, iter_occurrence_starts, local_date
from app.timeutil import ensure_aware, get_zone


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


def build_occurrence(note: Note, original_start: datetime, ov: OccurrenceOverride | None) -> Occurrence:
    return Occurrence(
        note_id=note.id,
        original_start=original_start,
        start_at=(ov.start_at if ov and ov.start_at else original_start),
        title=(ov.title if ov and ov.title is not None else note.title),
        body=(ov.body if ov and ov.body is not None else note.body),
        # Неактивная серия → все вхождения неактивны; иначе решает исключение (D5)
        is_active=note.is_active and (ov.is_active if ov and ov.is_active is not None else True),
        timezone=note.timezone,
        tags=tuple(note.tags),
        is_recurring=note.is_recurring,
        is_exception=ov is not None,
    )


def _is_valid_original(note: Note, instant: datetime) -> bool:
    return is_occurrence(note.start_at, note.timezone, note.recurrence_freq, note.recurrence_until, instant)


def note_occurrences(note: Note, start: datetime, end: datetime) -> list[Occurrence]:
    """Вхождения заметки, фактический момент которых попадает в [start, end)."""
    if not note.is_recurring:
        return [build_occurrence(note, note.start_at, None)] if start <= note.start_at < end else []

    ovs = {ov.original_start: ov for ov in note.overrides}
    result: list[Occurrence] = []
    in_window: set[datetime] = set()
    for orig in iter_occurrence_starts(
        note.start_at, note.timezone, note.recurrence_freq, note.recurrence_until, start, end
    ):
        in_window.add(orig)
        ov = ovs.get(orig)
        if ov and ov.is_cancelled:
            continue
        occ = build_occurrence(note, orig, ov)
        if start <= occ.start_at < end:
            result.append(occ)
    # Вхождения, перенесённые в окно из-за его пределов
    for orig, ov in ovs.items():
        if (
            not ov.is_cancelled
            and ov.start_at is not None
            and start <= ov.start_at < end
            and orig not in in_window
            and _is_valid_original(note, orig)
        ):
            result.append(build_occurrence(note, orig, ov))
    return result


def occurrences_between(
    db: Session,
    start: datetime,
    end: datetime,
    *,
    tag_ids: list[int] | None = None,
    active: bool | None = None,
) -> list[Occurrence]:
    moved_in = select(OccurrenceOverride.note_id).where(
        OccurrenceOverride.start_at >= start, OccurrenceOverride.start_at < end
    )
    stmt = select(Note).where(
        Note.deleted_at.is_(None),
        or_(
            and_(Note.recurrence_freq == "none", Note.start_at >= start, Note.start_at < end),
            and_(
                Note.recurrence_freq != "none",
                Note.start_at < end,
                # until — локальная дата; запас в сутки покрывает любые часовые пояса
                Note.recurrence_until >= (start - timedelta(days=1)).date(),
            ),
            Note.id.in_(moved_in),
        ),
    )
    if tag_ids:
        stmt = stmt.where(Note.tags.any(Tag.id.in_(tag_ids)))
    result: list[Occurrence] = []
    for note in db.scalars(stmt):
        result.extend(note_occurrences(note, start, end))
    if active is not None:
        result = [o for o in result if o.is_active is active]
    result.sort(key=lambda o: (o.start_at, o.note_id))
    return result


# ---------- Операции над одним вхождением серии ----------

def _get_series(db: Session, note_id: int, expected_version: int | None = None) -> Note:
    from app.services.notes import check_version, lock_note  # избегаем циклического импорта

    note = lock_note(db, note_id)
    check_version(note, expected_version)
    if note.deleted_at is not None:
        raise Conflict("Заметка в корзине: сначала восстановите её")
    if not note.is_recurring:
        raise Conflict("Заметка не повторяется: редактируйте её целиком")
    return note


def _find_override(note: Note, original_start: datetime) -> OccurrenceOverride | None:
    return next((ov for ov in note.overrides if ov.original_start == original_start), None)


def _resolve(db: Session, note_id: int, original_start: datetime,
             expected_version: int | None = None) -> tuple[Note, datetime]:
    note = _get_series(db, note_id, expected_version)
    original_start = ensure_aware(original_start, "original_start")
    if not _is_valid_original(note, original_start):
        raise NotFound("Такого вхождения в серии нет")
    return note, original_start


def current_occurrence(note: Note, original_start: datetime) -> Occurrence | None:
    """Вхождение в текущем состоянии заметки или None, если его больше нет (удалено/правило изменилось)."""
    if not note.is_recurring:
        return build_occurrence(note, note.start_at, None)  # у обычной заметки вхождение одно
    if not _is_valid_original(note, original_start):
        return None
    ov = _find_override(note, original_start)
    if ov and ov.is_cancelled:
        return None
    return build_occurrence(note, original_start, ov)


def get_occurrence(db: Session, note_id: int, original_start: datetime) -> Occurrence:
    note, orig = _resolve(db, note_id, original_start)
    ov = _find_override(note, orig)
    if ov and ov.is_cancelled:
        raise NotFound("Вхождение удалено")
    return build_occurrence(note, orig, ov)


def _check_move(note: Note, original_start: datetime, new_start: datetime) -> None:
    """Перенос вхождения не должен ломать модель повторения (используется и для DnD)."""
    tz = note.timezone
    new_day = local_date(new_start, tz)
    first_day = local_date(note.start_at, tz)
    if new_day < first_day or (note.recurrence_until and new_day > note.recurrence_until):
        raise Conflict(
            f"Вхождение можно перенести только в пределах серии ({first_day:%d.%m.%Y} – "
            f"{note.recurrence_until:%d.%m.%Y})"
        )
    zone = get_zone(tz)
    day_start = datetime.combine(new_day, datetime.min.time()).replace(tzinfo=zone)
    day_end = datetime.combine(new_day + timedelta(days=1), datetime.min.time()).replace(tzinfo=zone)
    clash = [o for o in note_occurrences(note, day_start, day_end) if o.original_start != original_start]
    if clash:
        raise Conflict(f"На {new_day:%d.%m.%Y} уже есть вхождение этой серии")


def update_occurrence(db: Session, note_id: int, original_start: datetime, data: OccurrenceUpdate) -> Occurrence:
    note, orig = _resolve(db, note_id, original_start, data.version)
    ov = _find_override(note, orig)
    if ov is not None and ov.is_cancelled:
        raise NotFound("Вхождение удалено")
    if ov is None:
        ov = OccurrenceOverride(note_id=note.id, original_start=orig)
        note.overrides.append(ov)
    fields = data.model_fields_set
    if "title" in fields and data.title is not None:
        ov.title = data.title
    if "body" in fields and data.body is not None:
        ov.body = data.body
    if "is_active" in fields and data.is_active is not None:
        ov.is_active = data.is_active
    if "start_at" in fields and data.start_at is not None:
        new_start = ensure_aware(data.start_at, "start_at")
        _check_move(note, orig, new_start)
        ov.start_at = None if new_start == orig else new_start
    note.version += 1
    db.commit()
    db.refresh(note)
    return build_occurrence(note, orig, _find_override(note, orig))


def cancel_occurrence(db: Session, note_id: int, original_start: datetime) -> None:
    """Удаляет только одно вхождение серии."""
    note, orig = _resolve(db, note_id, original_start)
    ov = _find_override(note, orig)
    if ov is None:
        note.overrides.append(OccurrenceOverride(note_id=note.id, original_start=orig, is_cancelled=True))
    else:
        ov.is_cancelled = True
    note.version += 1
    db.commit()


def reset_occurrence(db: Session, note_id: int, original_start: datetime) -> Occurrence:
    """Убирает исключение: вхождение снова как в серии (в т.ч. возвращает удалённое)."""
    note, orig = _resolve(db, note_id, original_start)
    ov = _find_override(note, orig)
    if ov is not None:
        note.overrides.remove(ov)
        note.version += 1
        db.commit()
        db.refresh(note)
    return build_occurrence(note, orig, None)
