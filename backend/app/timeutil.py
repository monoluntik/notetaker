from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from app.errors import Invalid


def utcnow() -> datetime:
    return datetime.now(UTC)


def get_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise Invalid(f"Неизвестный часовой пояс: {name!r}") from exc


def is_valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def all_timezones() -> list[str]:
    return sorted(available_timezones())


def ensure_aware(dt: datetime, field: str = "datetime") -> datetime:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise Invalid(f"{field}: требуется дата-время со смещением (например, 2026-01-01T09:00:00Z)")
    return dt.astimezone(UTC)
