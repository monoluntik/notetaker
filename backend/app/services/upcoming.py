"""Экран «Предстоящие» (DECISIONS D10). Границы суток и недели — в часовом поясе пользователя."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.services.occurrences import Occurrence, occurrences_between
from app.services.settings import get_settings_row
from app.timeutil import get_zone

OVERDUE_LOOKBACK = timedelta(days=30)


@dataclass
class Upcoming:
    now: datetime
    timezone: str
    day_end: datetime
    week_end: datetime
    today: list[Occurrence]
    week: list[Occurrence]
    overdue: list[Occurrence]


def local_bounds(now: datetime, tz_name: str) -> tuple[datetime, datetime, datetime]:
    """(начало сегодняшних суток, конец суток, конец недели пн–вс) как aware-моменты."""
    tz = get_zone(tz_name)
    local = now.astimezone(tz)
    day_start_naive = local.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    day_start = day_start_naive.replace(tzinfo=tz)
    day_end = (day_start_naive + timedelta(days=1)).replace(tzinfo=tz)
    week_end = (day_start_naive + timedelta(days=7 - local.weekday())).replace(tzinfo=tz)
    return day_start, day_end, week_end


def get_upcoming(db: Session, now: datetime) -> Upcoming:
    tz_name = get_settings_row(db).timezone
    _, day_end, week_end = local_bounds(now, tz_name)
    occs = occurrences_between(db, now - OVERDUE_LOOKBACK, week_end)
    return Upcoming(
        now=now,
        timezone=tz_name,
        day_end=day_end,
        week_end=week_end,
        today=[o for o in occs if now <= o.start_at < day_end],
        week=[o for o in occs if day_end <= o.start_at < week_end],
        overdue=sorted((o for o in occs if o.start_at < now and o.is_active), key=lambda o: o.start_at, reverse=True),
    )
