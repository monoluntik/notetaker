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
from app.services.occurrences import Occurrence, count_occurrences, occurrences_between
from app.services.settings import get_settings_row
from app.timeutil import get_zone

DEFAULT_OVERDUE_LIMIT = 50
SECTION_LIMIT = 200  # «сегодня» и «неделя»: больше в одном разделе не показываем, итог — всегда точный


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
    today_total: int
    week_total: int


def local_bounds(now: datetime, tz_name: str) -> tuple[datetime, datetime, datetime]:
    """(начало сегодняшних суток, конец суток, конец недели пн–вс) как aware-моменты."""
    tz = get_zone(tz_name)
    local = now.astimezone(tz)
    day_start_naive = local.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    day_start = day_start_naive.replace(tzinfo=tz)
    day_end = (day_start_naive + timedelta(days=1)).replace(tzinfo=tz)
    week_end = (day_start_naive + timedelta(days=7 - local.weekday())).replace(tzinfo=tz)
    return day_start, day_end, week_end


def _latest_overdue(db: Session, now: datetime, earliest: datetime, limit: int) -> list[Occurrence]:
    """Последние `limit` прошедших активных вхождений. Окно назад расширяется в 4 раза,
    пока не наберётся нужное число, — без развёртки всей истории."""
    span = timedelta(days=7)
    while True:
        a = max(now - span, earliest)
        found = occurrences_between(db, a, now, active=True, limit=limit, descending=True)
        if len(found) >= limit or a <= earliest:
            return found
        span *= 4


def get_upcoming(db: Session, now: datetime, overdue_limit: int = DEFAULT_OVERDUE_LIMIT) -> Upcoming:
    """Работа ограничена размером окна и лимитами, а не числом заметок (docs/LOADTEST.md)."""
    tz_name = get_settings_row(db).timezone
    _, day_end, week_end = local_bounds(now, tz_name)
    earliest = db.scalar(select(func.min(Note.start_at)).where(Note.deleted_at.is_(None), Note.is_active.is_(True)))
    earliest = min(earliest, now) if earliest else now
    return Upcoming(
        now=now,
        timezone=tz_name,
        day_end=day_end,
        week_end=week_end,
        today=occurrences_between(db, now, day_end, limit=SECTION_LIMIT),
        week=occurrences_between(db, day_end, week_end, limit=SECTION_LIMIT),
        overdue=_latest_overdue(db, now, earliest, overdue_limit),
        overdue_total=count_occurrences(db, earliest, now, active_only=True),
        today_total=count_occurrences(db, now, day_end),
        week_total=count_occurrences(db, day_end, week_end),
    )
