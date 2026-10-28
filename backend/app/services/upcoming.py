"""Экран «Предстоящие» (DECISIONS D10). Границы суток и недели — в часовом поясе пользователя.

«Прошедшие активные» — все активные вхождения, время которых прошло, без ограничения давности.
Чтобы ответ оставался небольшим, отдаются первые overdue_limit (самые свежие) и общее число —
интерфейс явно показывает «показано N из M».
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Note
from app.services.occurrences import Occurrence, occurrences_between
from app.services.settings import get_settings_row
from app.timeutil import get_zone

DEFAULT_OVERDUE_LIMIT = 50


@dataclass
class Upcoming:
    now: datetime
    timezone: str
    day_end: datetime
    week_end: datetime
    today: list[Occurrence]
    week: list[Occurrence]
    overdue: list[Occurrence]
    overdue_total: int


def local_bounds(now: datetime, tz_name: str) -> tuple[datetime, datetime, datetime]:
    """(начало сегодняшних суток, конец суток, конец недели пн–вс) как aware-моменты."""
    tz = get_zone(tz_name)
    local = now.astimezone(tz)
    day_start_naive = local.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    day_start = day_start_naive.replace(tzinfo=tz)
    day_end = (day_start_naive + timedelta(days=1)).replace(tzinfo=tz)
    week_end = (day_start_naive + timedelta(days=7 - local.weekday())).replace(tzinfo=tz)
    return day_start, day_end, week_end


def get_upcoming(db: Session, now: datetime, overdue_limit: int = DEFAULT_OVERDUE_LIMIT) -> Upcoming:
    tz_name = get_settings_row(db).timezone
    _, day_end, week_end = local_bounds(now, tz_name)
    # Самое раннее начало среди активных заметок: раньше прошедших активных вхождений нет
    # (перенос вхождения допускается только в пределах серии).
    earliest = db.scalar(select(func.min(Note.start_at)).where(Note.deleted_at.is_(None), Note.is_active.is_(True)))
    window_start = min(earliest, now) if earliest else now
    occs = occurrences_between(db, window_start, week_end)
    overdue = sorted((o for o in occs if o.start_at < now and o.is_active), key=lambda o: o.start_at, reverse=True)
    return Upcoming(
        now=now,
        timezone=tz_name,
        day_end=day_end,
        week_end=week_end,
        today=[o for o in occs if now <= o.start_at < day_end],
        week=[o for o in occs if day_end <= o.start_at < week_end],
        overdue=overdue[:overdue_limit],
        overdue_total=len(overdue),
    )
