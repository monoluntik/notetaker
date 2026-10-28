from datetime import datetime, timedelta

from sqlalchemy import Date, DateTime, Select, and_, cast, delete, func, literal, or_, select
from sqlalchemy.orm import Session

from app.errors import Conflict, Invalid, NotFound
from app.models import Note, NoteReminder, OccurrenceOverride, Tag, note_tags
from app.schemas import NoteCreate, NoteUpdate, Recurrence, SortField, SortOrder
from app.services.recurrence import local_date
from app.services.settings import get_settings_row
from app.timeutil import ensure_aware, utcnow


def _load_tags(db: Session, tag_ids: list[int]) -> list[Tag]:
    ids = list(dict.fromkeys(tag_ids))
    tags = db.scalars(select(Tag).where(Tag.id.in_(ids))).all()
    missing = set(ids) - {t.id for t in tags}
    if missing:
        raise Invalid(f"Теги не найдены: {sorted(missing)}")
    return list(tags)


MAX_SERIES_SPAN = timedelta(days=5 * 366)


def _validate_recurrence(rec: Recurrence | None, start_at: datetime, tz: str) -> None:
    if rec is None:
        return
    first = local_date(start_at, tz)
    if rec.until < first:
        raise Invalid("Дата окончания повторения раньше даты заметки")
    if rec.until - first > MAX_SERIES_SPAN:
        raise Invalid("Серия не может быть длиннее 5 лет")


def get_note(db: Session, note_id: int, *, include_deleted: bool = True) -> Note:
    note = db.get(Note, note_id)
    if note is None or (not include_deleted and note.deleted_at is not None):
        raise NotFound(f"Заметка {note_id} не найдена")
    return note


def _get_editable(db: Session, note_id: int) -> Note:
    note = get_note(db, note_id)
    if note.deleted_at is not None:
        raise Conflict("Заметка в корзине: сначала восстановите её")
    return note


def create_note(db: Session, data: NoteCreate) -> Note:
    tz = data.timezone or get_settings_row(db).timezone
    note = Note(
        title=data.title,
        body=data.body,
        start_at=ensure_aware(data.start_at, "start_at"),
        timezone=tz,
        is_active=data.is_active,
        tags=_load_tags(db, data.tag_ids),
    )
    _validate_recurrence(data.recurrence, note.start_at, tz)
    if data.recurrence:
        note.recurrence_freq = data.recurrence.freq
        note.recurrence_until = data.recurrence.until
    note.reminder_rules = [NoteReminder(offset_minutes=m) for m in data.reminders]
    db.add(note)
    db.commit()
    return note


def update_note(db: Session, note_id: int, data: NoteUpdate) -> Note:
    note = _get_editable(db, note_id)
    fields = data.model_fields_set
    old_rule = (note.start_at, note.timezone, note.recurrence_freq)
    if "title" in fields and data.title is not None:
        note.title = data.title
    if "body" in fields and data.body is not None:
        note.body = data.body
    if "start_at" in fields and data.start_at is not None:
        note.start_at = ensure_aware(data.start_at, "start_at")
    if "timezone" in fields and data.timezone is not None:
        note.timezone = data.timezone
    if "is_active" in fields and data.is_active is not None:
        note.is_active = data.is_active
    if "tag_ids" in fields and data.tag_ids is not None:
        note.tags = _load_tags(db, data.tag_ids)
    if "reminders" in fields and data.reminders is not None:
        keep = {r.offset_minutes: r for r in note.reminder_rules}
        note.reminder_rules = [keep.get(m) or NoteReminder(offset_minutes=m) for m in data.reminders]
    if "recurrence" in fields:
        rec = data.recurrence
        note.recurrence_freq = rec.freq if rec else "none"
        note.recurrence_until = rec.until if rec else None
    if note.is_recurring:
        rec = Recurrence(freq=note.recurrence_freq, until=note.recurrence_until)
        _validate_recurrence(rec, note.start_at, note.timezone)
    # Исключения привязаны к моментам, которые даёт правило. Если правило изменилось, они
    # больше не соответствуют вхождениям и удаляются (DECISIONS D5). Смена until их не трогает.
    if (note.start_at, note.timezone, note.recurrence_freq) != old_rule:
        note.overrides.clear()
    note.updated_at = func.now()  # теги меняют только связь, поэтому время обновляем явно
    db.commit()
    db.refresh(note)
    return note


def trash_note(db: Session, note_id: int) -> Note:
    note = get_note(db, note_id)
    if note.deleted_at is None:
        note.deleted_at = utcnow()
        db.commit()
    return note


def restore_note(db: Session, note_id: int) -> Note:
    note = get_note(db, note_id)
    if note.deleted_at is not None:
        note.deleted_at = None
        db.commit()
    return note


def purge_note(db: Session, note_id: int) -> None:
    note = get_note(db, note_id)
    if note.deleted_at is None:
        raise Conflict("Окончательно удалить можно только заметку из корзины")
    db.delete(note)
    db.commit()


def empty_trash(db: Session) -> int:
    result = db.execute(delete(Note).where(Note.deleted_at.is_not(None)))
    db.commit()
    return result.rowcount or 0


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_list_query(
    *,
    q: str | None = None,
    tag_ids: list[int] | None = None,
    active: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    deleted: bool = False,
) -> Select:
    stmt = select(Note).where(Note.deleted_at.is_not(None) if deleted else Note.deleted_at.is_(None))
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        # Серия находится и по изменённому заголовку/тексту отдельного (не удалённого) вхождения
        in_occurrence = select(OccurrenceOverride.note_id).where(
            OccurrenceOverride.is_cancelled.is_(False),
            or_(
                OccurrenceOverride.title.ilike(pattern, escape="\\"),
                OccurrenceOverride.body.ilike(pattern, escape="\\"),
            ),
        )
        stmt = stmt.where(
            or_(
                Note.title.ilike(pattern, escape="\\"),
                Note.body.ilike(pattern, escape="\\"),
                Note.id.in_(in_occurrence),
            )
        )
    if tag_ids:
        # «любой из выбранных тегов»
        stmt = stmt.where(Note.id.in_(select(note_tags.c.note_id).where(note_tags.c.tag_id.in_(tag_ids))))
    if active is not None:
        stmt = stmt.where(Note.is_active.is_(active))
    if date_from is not None:
        # Серия попадает в период, если её диапазон [start, until] пересекается с ним (D9).
        # Конец серии — полночь после until в поясе заметки.
        series_end = func.timezone(Note.timezone, cast(cast(Note.recurrence_until + literal(1), Date), DateTime()))
        stmt = stmt.where(
            or_(
                and_(Note.recurrence_freq == "none", Note.start_at >= date_from),
                and_(Note.recurrence_freq != "none", series_end > date_from),
            )
        )
    if date_to is not None:
        stmt = stmt.where(Note.start_at < date_to)
    return stmt


def list_notes(
    db: Session,
    *,
    page: int,
    page_size: int,
    sort: SortField = "start_at",
    order: SortOrder = "asc",
    **filters,
) -> tuple[list[Note], int]:
    base = build_list_query(**filters)
    total = db.scalar(select(func.count()).select_from(base.order_by(None).subquery())) or 0
    col = Note.start_at if sort == "start_at" else Note.updated_at
    ordering = [col.asc(), Note.id.asc()] if order == "asc" else [col.desc(), Note.id.desc()]
    if filters.get("deleted"):
        ordering = [Note.deleted_at.desc(), Note.id.desc()]
    items = db.scalars(base.order_by(*ordering).offset((page - 1) * page_size).limit(page_size)).all()
    return list(items), total
