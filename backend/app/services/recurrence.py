"""Генерация вхождений повторяющейся серии (DECISIONS D5).

Серия разворачивается в часовом поясе заметки по «настенному» времени: «каждый день в 09:00»
остаётся 09:00 местного времени и после перехода на летнее/зимнее время.
- daily/weekly: +1/+7 календарных дней;
- monthly: тот же день месяца; если его нет (31-е, 29–30 февраля) — последний день месяца,
  при этом якорем остаётся исходный день (31 янв → 28/29 фев → 31 мар);
- until — локальная дата окончания, включительно;
- несуществующее локальное время (переход вперёд) сдвигается вперёд на величину перехода,
  неоднозначное (переход назад) — берётся первое (fold=0).
"""

import calendar
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from app.timeutil import get_zone

Freq = Literal["none", "daily", "weekly", "monthly"]
FREQS: tuple[str, ...] = ("none", "daily", "weekly", "monthly")


def _add_months(d: datetime, months: int, anchor_day: int) -> datetime:
    m = d.month - 1 + months
    year, month = d.year + m // 12, m % 12 + 1
    day = min(anchor_day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


def _nth_local(base: datetime, freq: str, k: int) -> datetime:
    if freq == "daily":
        return base + timedelta(days=k)
    if freq == "weekly":
        return base + timedelta(weeks=k)
    if freq == "monthly":
        return _add_months(base, k, base.day)
    raise ValueError(freq)


def _to_utc(naive_local: datetime, tz) -> datetime:
    # replace(tzinfo=…) с fold=0: несуществующее время получает смещение «до перехода»,
    # что после перевода в UTC эквивалентно сдвигу вперёд.
    return naive_local.replace(tzinfo=tz).astimezone(UTC)


def _first_index_hint(base_local: datetime, freq: str, window_start_local: datetime) -> int:
    """Номер вхождения, с которого имеет смысл начинать перебор (с запасом 1)."""
    if window_start_local <= base_local:
        return 0
    if freq == "daily":
        return max(0, (window_start_local - base_local).days - 1)
    if freq == "weekly":
        return max(0, (window_start_local - base_local).days // 7 - 1)
    months = (window_start_local.year - base_local.year) * 12 + window_start_local.month - base_local.month
    return max(0, months - 1)


def iter_occurrence_starts(
    start_at: datetime,
    tz_name: str,
    freq: str,
    until: date | None,
    window_start: datetime,
    window_end: datetime,
) -> Iterator[datetime]:
    """Исходные моменты вхождений (UTC) в окне [window_start, window_end)."""
    if freq == "none" or until is None:
        if window_start <= start_at < window_end:
            yield start_at.astimezone(UTC)
        return

    tz = get_zone(tz_name)
    base_local = start_at.astimezone(tz).replace(tzinfo=None)
    k = _first_index_hint(base_local, freq, window_start.astimezone(tz).replace(tzinfo=None))
    while True:
        local = _nth_local(base_local, freq, k)
        if local.date() > until:
            return
        instant = _to_utc(local, tz)
        if instant >= window_end:
            return
        if instant >= window_start:
            yield instant
        k += 1


def is_occurrence(start_at: datetime, tz_name: str, freq: str, until: date | None, instant: datetime) -> bool:
    """Является ли момент исходным моментом одного из вхождений серии."""
    return any(
        True for _ in iter_occurrence_starts(start_at, tz_name, freq, until, instant, instant + timedelta(microseconds=1))
    )


def local_date(instant: datetime, tz_name: str) -> date:
    return instant.astimezone(get_zone(tz_name)).date()
