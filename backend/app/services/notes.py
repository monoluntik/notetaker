from datetime import datetime, timedelta

from sqlalchemy import ARRAY, Date, DateTime, Integer, Select, and_, cast, delete, func, literal, or_, select
from sqlalchemy.orm import Session

from app.errors import Conflict, Invalid, NotFound
from app.models import Note, NoteReminder, OccurrenceOverride, ReminderDelivery, Tag, note_tags
from app.schemas import NoteCreate, NoteSplit, NoteUpdate, Recurrence, SortField, SortOrder
from app.services.recurrence import is_occurrence, local_date
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
TOTAL_CAP = 10_000  # точный подсчёт найденных — до этого числа, дальше «10 000+»


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


EDIT_CONFLICT = (
    "Заметку уже изменили в другой вкладке или на другом устройстве. "
    "Загрузите актуальную версию и повторите изменения."
)


def lock_note(db: Session, note_id: int) -> Note:
    """Заметка с блокировкой строки до конца транзакции: правки одной заметки идут по очереди."""
    note = db.get(Note, note_id, with_for_update=True, populate_existing=True)
    if note is None:
        raise NotFound(f"Заметка {note_id} не найдена")
    return note


def check_version(note: Note, expected: int | None) -> None:
    if expected is not None and expected != note.version:
        raise Conflict(EDIT_CONFLICT)


def _get_editable(db: Session, note_id: int, expected_version: int | None = None) -> Note:
    note = lock_note(db, note_id)
    if note.deleted_at is not None:
        raise Conflict("Заметка в корзине: сначала восстановите её")
    check_version(note, expected_version)
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
    note = _get_editable(db, note_id, data.version)
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
    note.version += 1
    db.commit()
    db.refresh(note)
    return note


def split_series(db: Session, note_id: int, original_start: datetime, data: NoteSplit) -> Note:
    """Изменяет серию начиная с вхождения original_start; прошлые вхождения не меняются (D17).

    Старая серия заканчивается накануне выбранного вхождения, с него начинается новая серия
    с изменёнными полями. Если правило не меняется (то же время, пояс и частота), исключения
    и журнал напоминаний будущих вхождений переходят к новой серии — повторных напоминаний нет.
    """
    note = _get_editable(db, note_id, data.version)
    if not note.is_recurring:
        raise Conflict("Заметка не повторяется: редактируйте её целиком")
    orig = ensure_aware(original_start, "original_start")
    if not is_occurrence(note.start_at, note.timezone, note.recurrence_freq, note.recurrence_until, orig):
        raise NotFound("Такого вхождения в серии нет")
    if local_date(orig, note.timezone) == local_date(note.start_at, note.timezone):
        return update_note(db, note_id, data)  # с первого вхождения — это правка всей серии

    fields = data.model_fields_set
    tz = data.timezone if "timezone" in fields and data.timezone else note.timezone
    start = ensure_aware(data.start_at, "start_at") if "start_at" in fields and data.start_at else orig
    if "recurrence" in fields:
        rec = data.recurrence
    else:
        rec = Recurrence(freq=note.recurrence_freq, until=note.recurrence_until)
    new = Note(
        title=data.title if "title" in fields and data.title is not None else note.title,
        body=data.body if "body" in fields and data.body is not None else note.body,
        start_at=start,
        timezone=tz,
        is_active=data.is_active if "is_active" in fields and data.is_active is not None else note.is_active,
        tags=_load_tags(db, data.tag_ids) if "tag_ids" in fields and data.tag_ids else list(note.tags),
        recurrence_freq=rec.freq if rec else "none",
        recurrence_until=rec.until if rec else None,
    )
    reminders = data.reminders if "reminders" in fields and data.reminders is not None else note.reminders
    new.reminder_rules = [NoteReminder(offset_minutes=m) for m in reminders]
    _validate_recurrence(rec, start, tz)
    db.add(new)
    db.flush()

    same_rule = start == orig and tz == note.timezone and new.recurrence_freq == note.recurrence_freq
    future = [ov for ov in note.overrides if ov.original_start >= orig]
    for ov in future:
        note.overrides.remove(ov)
        if same_rule:
            new.overrides.append(
                OccurrenceOverride(original_start=ov.original_start, is_cancelled=ov.is_cancelled, title=ov.title,
                                   body=ov.body, start_at=ov.start_at, is_active=ov.is_active)
            )
    if same_rule:
        db.query(ReminderDelivery).filter(
            ReminderDelivery.note_id == note.id, ReminderDelivery.original_start >= orig
        ).update({ReminderDelivery.note_id: new.id}, synchronize_session=False)

    note.recurrence_until = local_date(orig, note.timezone) - timedelta(days=1)
    note.version += 1
    note.updated_at = func.now()
    db.commit()
    db.refresh(new)
    return new


def trash_note(db: Session, note_id: int, version: int) -> Note:
    note = lock_note(db, note_id)
    check_version(note, version)
    if note.deleted_at is None:
        note.deleted_at = utcnow()
        note.version += 1
        db.commit()
    return note


def restore_note(db: Session, note_id: int, version: int) -> Note:
    note = lock_note(db, note_id)
    check_version(note, version)
    if note.deleted_at is not None:
        note.deleted_at = None
        note.version += 1
        db.commit()
    return note


def purge_note(db: Session, note_id: int, version: int) -> None:
    note = lock_note(db, note_id)
    check_version(note, version)
    if note.deleted_at is None:
        raise Conflict("Окончательно удалить можно только заметку из корзины")
    db.delete(note)
    db.commit()


def purge_expired_trash(db: Session, now: datetime, retention_days: int) -> int:
    """Окончательно удаляет заметки, лежащие в корзине дольше retention_days."""
    result = db.execute(delete(Note).where(Note.deleted_at < now - timedelta(days=retention_days)))
    db.commit()
    return result.rowcount or 0


def empty_trash(db: Session) -> int:
    result = db.execute(delete(Note).where(Note.deleted_at.is_not(None)))
    db.commit()
    return result.rowcount or 0


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def matching_override_note_ids(db: Session, q: str | None) -> list[int]:
    """id серий, у которых изменённый заголовок/текст вхождения содержит q (таблица исключений мала)."""
    if not q or not q.strip():
        return []
    pattern = f"%{_escape_like(q.strip())}%"
    return list(db.scalars(
        select(OccurrenceOverride.note_id).distinct().where(
            OccurrenceOverride.is_cancelled.is_(False),
            or_(OccurrenceOverride.title.ilike(pattern, escape="\\"), OccurrenceOverride.body.ilike(pattern, escape="\\")),
        )
    ))


def build_list_query(
    *,
    q: str | None = None,
    override_ids: list[int] | None = None,
    tag_ids: list[int] | None = None,
    active: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    deleted: bool = False,
) -> Select:
    stmt = select(Note).where(Note.deleted_at.is_not(None) if deleted else Note.deleted_at.is_(None))
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        # Серия находится и по изменённому заголовку/тексту отдельного (не удалённого) вхождения.
        # Все три условия индексируемые: trigram-индексы по title/body и первичный ключ для id
        # (id серий с подходящими исключениями — из маленькой таблицы исключений, заранее).
        # Тогда планировщик сам выбирает: BitmapOr по индексам для редкого слова или обход в
        # порядке сортировки для частого (docs/LOADTEST.md). OR с подзапросом давал полный
        # перебор таблицы, UNION — сотни тысяч id для частых слов.
        stmt = stmt.where(
            or_(
                Note.title.ilike(pattern, escape="\\"),
                Note.body.ilike(pattern, escape="\\"),
                Note.id == func.any(literal(override_ids or [0], ARRAY(Integer))),
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
) -> tuple[list[Note], int, bool]:
    """Страница заметок, число найденных и признак «больше TOTAL_CAP» (тогда total = TOTAL_CAP).

    Точный count(*) по миллионам строк стоил сотни миллисекунд на каждый запрос страницы
    (docs/LOADTEST.md); интерфейсу достаточно «10 000+»."""
    filters["override_ids"] = matching_override_note_ids(db, filters.get("q"))
    base = build_list_query(**filters)
    capped_rows = base.order_by(None).with_only_columns(Note.id).limit(TOTAL_CAP + 1).subquery()
    total = db.scalar(select(func.count()).select_from(capped_rows)) or 0
    capped = total > TOTAL_CAP
    total = min(total, TOTAL_CAP)
    col = Note.start_at if sort == "start_at" else Note.updated_at
    ordering = [col.asc(), Note.id.asc()] if order == "asc" else [col.desc(), Note.id.desc()]
    if filters.get("deleted"):
        ordering = [Note.deleted_at.desc(), Note.id.desc()]
    items = db.scalars(base.order_by(*ordering).offset((page - 1) * page_size).limit(page_size)).all()
    return list(items), total, capped
