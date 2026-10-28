"""Вхождения заметок в окне времени.

Вхождение — конкретный момент заметки. У обычной заметки одно вхождение, у повторяющейся —
по одному на каждый период серии с учётом исключений (occurrence_overrides).
Календарь, «Предстоящие» и напоминания работают с вхождениями, а не с записями заметок.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.errors import Conflict, NotFound
from app.models import Note, OccurrenceOverride, Tag, note_tags
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
    note_version: int = 1


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
        note_version=note.version,
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


def _filters_sql(alias: str, tag_ids: list[int] | None, with_reminders: bool) -> str:
    parts = []
    if tag_ids:
        parts.append(f"EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = {alias}.id AND nt.tag_id = ANY(:tag_ids))")
    if with_reminders:
        parts.append(f"EXISTS (SELECT 1 FROM note_reminders nr WHERE nr.note_id = {alias}.id)")
    return "".join(f" AND {p}" for p in parts)


def _window_cte(filters_n: str, filters_s: str, singles_tail: str = "") -> str:
    """Вхождения (note_id, original_start) с исходным или перенесённым моментом в окне [:a, :b).

    Серии разворачиваются в SQL (миграция 0005): номера вхождений в окне — между
    nt_count_before(:a) и nt_count_before(:b) − 1, поэтому работа пропорциональна размеру окна,
    а не длине истории. Обычные заметки идут по индексу (deleted_at, start_at).
    """
    return f"""
    series AS (
      SELECT s.id, s.start_at, s.timezone, s.recurrence_freq, s.recurrence_until FROM notes s
      WHERE s.deleted_at IS NULL AND s.recurrence_freq <> 'none' AND s.start_at < :b
        AND s.recurrence_until >= (:a AT TIME ZONE 'UTC')::date - 1 {filters_s}
    ),
    occ AS (
      SELECT s.id AS note_id, nt_occurrence(s.start_at, s.timezone, s.recurrence_freq, k) AS original_start
      FROM series s,
           LATERAL generate_series(nt_count_before(s.start_at, s.timezone, s.recurrence_freq, s.recurrence_until, :a),
                                   nt_count_before(s.start_at, s.timezone, s.recurrence_freq, s.recurrence_until, :b) - 1) k
      UNION ALL
      -- перенесённые в окно вхождения, исходный момент которых вне окна
      SELECT ov.note_id, ov.original_start FROM occurrence_overrides ov JOIN notes s ON s.id = ov.note_id
      WHERE NOT ov.is_cancelled AND ov.start_at >= :a AND ov.start_at < :b
        AND NOT (ov.original_start >= :a AND ov.original_start < :b)
        AND s.deleted_at IS NULL AND s.recurrence_freq <> 'none' {filters_s}
        AND nt_count_before(s.start_at, s.timezone, s.recurrence_freq, s.recurrence_until, ov.original_start + interval '1 microsecond')
          - nt_count_before(s.start_at, s.timezone, s.recurrence_freq, s.recurrence_until, ov.original_start) = 1
      UNION ALL
      (SELECT n.id, n.start_at FROM notes n
       WHERE n.deleted_at IS NULL AND n.recurrence_freq = 'none' AND n.start_at >= :a AND n.start_at < :b {filters_n}
       {singles_tail})
    )"""


def occurrences_between(
    db: Session,
    start: datetime,
    end: datetime,
    *,
    tag_ids: list[int] | None = None,
    active: bool | None = None,
    with_reminders: bool = False,
    limit: int | None = None,
    descending: bool = False,
) -> list[Occurrence]:
    """Вхождения с фактическим моментом в [start, end), отсортированные по времени."""
    order = "DESC" if descending else "ASC"
    # У обычной заметки фактический момент = start_at, поэтому порядок и лимит можно применить
    # прямо в её ветке (по индексу), не разворачивая всё окно. Фильтр активности тоже переносится.
    singles_tail = ""
    if limit is not None:
        act = "" if active is None else (" AND n.is_active" if active else " AND NOT n.is_active")
        singles_tail = f"{act} ORDER BY n.start_at {order}, n.id {order} LIMIT :limit"
    cte = _window_cte(_filters_sql("n", tag_ids, with_reminders), _filters_sql("s", tag_ids, with_reminders), singles_tail)
    active_sql = "" if active is None else (
        " AND (n.is_active AND coalesce(ov.is_active, true))" if active else " AND NOT (n.is_active AND coalesce(ov.is_active, true))"
    )
    sql = f"""
    WITH {cte}
    SELECT o.note_id, o.original_start, coalesce(ov.start_at, o.original_start) AS start_at,
           coalesce(ov.title, n.title) AS title, coalesce(ov.body, n.body) AS body,
           n.is_active AND coalesce(ov.is_active, true) AS is_active, n.timezone,
           n.recurrence_freq <> 'none' AS is_recurring, ov.id IS NOT NULL AS is_exception, n.version
    FROM occ o JOIN notes n ON n.id = o.note_id
    LEFT JOIN occurrence_overrides ov ON ov.note_id = o.note_id AND ov.original_start = o.original_start
    WHERE (ov.id IS NULL OR NOT ov.is_cancelled)
      AND coalesce(ov.start_at, o.original_start) >= :a AND coalesce(ov.start_at, o.original_start) < :b
      {active_sql}
    ORDER BY 3 {order}, 1 {order}
    {"LIMIT :limit" if limit is not None else ""}
    """
    params = {"a": start, "b": end, "tag_ids": tag_ids or [], "limit": limit}
    rows = db.execute(text(sql), params).all()
    tags = _tags_for(db, {r.note_id for r in rows})
    return [
        Occurrence(
            note_id=r.note_id, original_start=r.original_start, start_at=r.start_at, title=r.title, body=r.body,
            is_active=r.is_active, timezone=r.timezone, tags=tags.get(r.note_id, ()), is_recurring=r.is_recurring,
            is_exception=r.is_exception, note_version=r.version,
        )
        for r in rows
    ]


def _tags_for(db: Session, note_ids: set[int]) -> dict[int, tuple[Tag, ...]]:
    if not note_ids:
        return {}
    out: dict[int, list[Tag]] = {}
    for note_id, tag in db.execute(
        select(note_tags.c.note_id, Tag).join(Tag, Tag.id == note_tags.c.tag_id)
        .where(note_tags.c.note_id.in_(note_ids)).order_by(Tag.name)
    ):
        out.setdefault(note_id, []).append(tag)
    return {k: tuple(v) for k, v in out.items()}


def count_occurrences(db: Session, start: datetime, end: datetime, *, active_only: bool = False,
                      cap: int | None = None) -> int:
    """Число вхождений в [start, end) без развёртки: арифметика по сериям + поправки исключений.

    Для серии: nt_count_before(end) − nt_count_before(start). Каждое исключение меняет итог на
    «учитывается после» − «учитывалось до»: до — исходный момент в окне; после — не отменено,
    фактический момент в окне и (для active_only) вхождение активно.
    """
    active_n = " AND n.is_active" if active_only else ""
    active_ov = " AND coalesce(ov.is_active, true)" if active_only else ""
    params = {"a": start, "b": end}
    if cap is not None:
        # Сначала обычные заметки с потолком (по индексу): если их уже больше cap, итог «cap+»
        singles = db.execute(text(f"""
            SELECT count(*) FROM (SELECT 1 FROM notes n WHERE n.deleted_at IS NULL AND n.recurrence_freq = 'none'
              AND n.start_at >= :a AND n.start_at < :b {active_n} LIMIT :cap1) t"""), params | {"cap1": cap + 1}).scalar()
        if singles > cap:
            return cap + 1
    sql = f"""
    WITH series AS (
      SELECT n.id, n.start_at, n.timezone, n.recurrence_freq, n.recurrence_until FROM notes n
      WHERE n.deleted_at IS NULL AND n.recurrence_freq <> 'none' AND n.start_at < :b
        AND n.recurrence_until >= (:a AT TIME ZONE 'UTC')::date - 1 {active_n}
    ),
    base AS (
      SELECT coalesce(sum(nt_count_before(start_at, timezone, recurrence_freq, recurrence_until, :b)
                        - nt_count_before(start_at, timezone, recurrence_freq, recurrence_until, :a)), 0) AS c
      FROM series
    ),
    adj AS (
      SELECT coalesce(sum(
               (NOT ov.is_cancelled AND coalesce(ov.start_at, ov.original_start) >= :a
                AND coalesce(ov.start_at, ov.original_start) < :b {active_ov})::int
             - (ov.original_start >= :a AND ov.original_start < :b)::int), 0) AS c
      FROM occurrence_overrides ov JOIN notes n ON n.id = ov.note_id
      WHERE n.deleted_at IS NULL AND n.recurrence_freq <> 'none' {active_n}
        AND ((ov.original_start >= :a AND ov.original_start < :b) OR (ov.start_at >= :a AND ov.start_at < :b))
        AND nt_count_before(n.start_at, n.timezone, n.recurrence_freq, n.recurrence_until, ov.original_start + interval '1 microsecond')
          - nt_count_before(n.start_at, n.timezone, n.recurrence_freq, n.recurrence_until, ov.original_start) = 1
    ),
    singles AS (
      SELECT count(*) AS c FROM notes n
      WHERE n.deleted_at IS NULL AND n.recurrence_freq = 'none' AND n.start_at >= :a AND n.start_at < :b {active_n}
    )
    SELECT (SELECT c FROM base) + (SELECT c FROM adj) + (SELECT c FROM singles)
    """
    total = int(db.execute(text(sql), params).scalar() or 0)
    return total if cap is None else min(total, cap + 1)


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


def cancel_occurrence(db: Session, note_id: int, original_start: datetime, version: int) -> None:
    """Удаляет только одно вхождение серии."""
    note, orig = _resolve(db, note_id, original_start, version)
    ov = _find_override(note, orig)
    if ov is None:
        note.overrides.append(OccurrenceOverride(note_id=note.id, original_start=orig, is_cancelled=True))
    else:
        ov.is_cancelled = True
    note.version += 1
    db.commit()


def reset_occurrence(db: Session, note_id: int, original_start: datetime, version: int) -> Occurrence:
    """Убирает исключение: вхождение снова как в серии (в т.ч. возвращает удалённое)."""
    note, orig = _resolve(db, note_id, original_start, version)
    ov = _find_override(note, orig)
    if ov is not None:
        note.overrides.remove(ov)
        note.version += 1
        db.commit()
        db.refresh(note)
    return build_occurrence(note, orig, None)
