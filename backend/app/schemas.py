import re
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer, field_validator

from app.timeutil import is_valid_timezone

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _strip_nonempty(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("не может быть пустым")
    return v


def _tz(v: str) -> str:
    if not is_valid_timezone(v):
        raise ValueError(f"неизвестный часовой пояс {v!r}")
    return v


def _aware(v: datetime) -> datetime:
    if v.tzinfo is None or v.utcoffset() is None:
        raise ValueError("нужна дата-время со смещением/зоной, например 2026-01-01T09:00:00Z")
    return v


def _color(v: str) -> str:
    if not HEX_COLOR.match(v):
        raise ValueError("цвет в формате #RRGGBB")
    return v.lower()


def _to_utc_iso(v: datetime) -> str:
    return v.astimezone(UTC).isoformat().replace("+00:00", "Z")


# Все моменты в ответах API — UTC в формате ISO 8601 с суффиксом Z.
UtcDatetime = Annotated[datetime, PlainSerializer(_to_utc_iso, return_type=str)]

NonEmpty = Annotated[str, AfterValidator(_strip_nonempty)]
TimeZoneName = Annotated[str, AfterValidator(_tz)]
AwareDatetime = Annotated[datetime, AfterValidator(_aware)]
Color = Annotated[str, AfterValidator(_color)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Tags ----------
class TagCreate(BaseModel):
    name: Annotated[NonEmpty, Field(max_length=50)]
    color: Color = "#64748b"


class TagUpdate(BaseModel):
    name: Annotated[NonEmpty, Field(max_length=50)] | None = None
    color: Color | None = None


class TagOut(ORM):
    id: int
    name: str
    color: str


class TagWithCount(TagOut):
    note_count: int


# ---------- Notes ----------
class Recurrence(BaseModel):
    freq: Literal["daily", "weekly", "monthly"]
    until: date  # локальная дата окончания (в поясе заметки), включительно


ReminderOffset = Literal[10, 60, 1440]


def _unique_sorted(v: list[int]) -> list[int]:
    return sorted(set(v))


Reminders = Annotated[list[ReminderOffset], AfterValidator(_unique_sorted)]


class NoteBase(BaseModel):
    title: Annotated[NonEmpty, Field(max_length=200)]
    body: Annotated[str, Field(max_length=20000)] = ""
    start_at: AwareDatetime
    timezone: TimeZoneName | None = None  # по умолчанию — часовой пояс пользователя
    tag_ids: Annotated[list[int], Field(min_length=1)]
    is_active: bool = True
    recurrence: Recurrence | None = None
    reminders: Reminders = []  # минуты до события: 10, 60, 1440


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    title: Annotated[NonEmpty, Field(max_length=200)] | None = None
    body: Annotated[str, Field(max_length=20000)] | None = None
    start_at: AwareDatetime | None = None
    timezone: TimeZoneName | None = None
    tag_ids: Annotated[list[int], Field(min_length=1)] | None = None
    is_active: bool | None = None
    recurrence: Recurrence | None = None  # явный null — отменить повторение
    reminders: Reminders | None = None


class NoteOut(ORM):
    id: int
    title: str
    body: str
    start_at: UtcDatetime
    timezone: str
    is_active: bool
    deleted_at: UtcDatetime | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    tags: list[TagOut]
    recurrence: Recurrence | None
    reminders: list[int]


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


SortField = Literal["start_at", "updated_at"]
SortOrder = Literal["asc", "desc"]


# ---------- Settings ----------
class SettingsOut(ORM):
    email: str | None
    timezone: str


class SettingsUpdate(BaseModel):
    email: str | None = None
    timezone: TimeZoneName | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if not EMAIL.match(v) or len(v) > 320:
            raise ValueError("некорректный email")
        return v


# ---------- Occurrences / Upcoming ----------
class OccurrenceOut(ORM):
    note_id: int
    original_start: UtcDatetime
    start_at: UtcDatetime
    title: str
    body: str
    is_active: bool
    timezone: str
    tags: list[TagOut]
    is_recurring: bool
    is_exception: bool


class UpcomingOut(ORM):
    now: UtcDatetime
    timezone: str
    day_end: UtcDatetime
    week_end: UtcDatetime
    today: list[OccurrenceOut]
    week: list[OccurrenceOut]
    overdue: list[OccurrenceOut]
    overdue_total: int  # всего прошедших активных; в overdue — первые overdue_limit


class OccurrenceUpdate(BaseModel):
    """Изменение одного вхождения серии. Не переданные поля не меняются."""

    title: Annotated[NonEmpty, Field(max_length=200)] | None = None
    body: Annotated[str, Field(max_length=20000)] | None = None
    start_at: AwareDatetime | None = None
    is_active: bool | None = None


class NotificationOut(ORM):
    """Уведомление о напоминании в приложении."""

    id: int
    note_id: int
    original_start: UtcDatetime
    occurrence_start: UtcDatetime
    fire_at: UtcDatetime
    offset_minutes: int
    title: str
    status: str
    late: bool
    created_at: UtcDatetime
    read_at: UtcDatetime | None
