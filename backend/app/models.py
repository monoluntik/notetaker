from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

note_tags = Table(
    "note_tags",
    Base.metadata,
    Column("note_id", ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True),
)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UserSettings(TimestampMixin, Base):
    """Единственная строка (id=1): приложение однопользовательское (см. DECISIONS D3)."""

    __tablename__ = "user_settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320))
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC")


class Tag(TimestampMixin, Base):
    __tablename__ = "tags"
    __table_args__ = (Index("uq_tags_name_lower", func.lower(text("name")), unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#64748b")


class Note(TimestampMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_deleted_start", "deleted_at", "start_at"),
        Index("ix_notes_updated_at", "updated_at"),
        CheckConstraint("recurrence_freq IN ('none', 'daily', 'weekly', 'monthly')", name="recurrence_freq_valid"),
        CheckConstraint(
            "(recurrence_freq = 'none') = (recurrence_until IS NULL)", name="recurrence_until_required"
        ),
        # Trigram-индексы для поиска создаются миграцией 0001, если доступен pg_trgm (DECISIONS D13).
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Правило повторения (DECISIONS D5). until — локальная дата в поясе заметки, включительно.
    recurrence_freq: Mapped[str] = mapped_column(String(10), nullable=False, server_default="none")
    recurrence_until: Mapped[date | None] = mapped_column(Date)

    tags: Mapped[list[Tag]] = relationship(secondary=note_tags, lazy="selectin", order_by=Tag.name)
    reminder_rules: Mapped[list["NoteReminder"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )

    overrides: Mapped[list["OccurrenceOverride"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )

    @property
    def is_recurring(self) -> bool:
        return self.recurrence_freq != "none"

    @property
    def reminders(self) -> list[int]:
        return sorted(r.offset_minutes for r in self.reminder_rules)

    @property
    def recurrence(self) -> dict | None:
        if not self.is_recurring:
            return None
        return {"freq": self.recurrence_freq, "until": self.recurrence_until}


class OccurrenceOverride(TimestampMixin, Base):
    """Исключение для одного вхождения серии: изменённые поля или отмена (DECISIONS D5).

    Вхождение идентифицируется original_start — моментом, который даёт правило серии.
    Поля со значением NULL наследуются от серии.
    """

    __tablename__ = "occurrence_overrides"
    __table_args__ = (
        UniqueConstraint("note_id", "original_start", name="uq_override_note_original"),
        Index("ix_override_start_at", "start_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    original_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    title: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool | None] = mapped_column(Boolean)

    note: Mapped[Note] = relationship(back_populates="overrides")


REMINDER_OFFSETS = (10, 60, 1440)  # за 10 минут, за 1 час, за 1 день


class NoteReminder(Base):
    __tablename__ = "note_reminders"
    __table_args__ = (CheckConstraint("offset_minutes IN (10, 60, 1440)", name="offset_valid"),)

    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True)
    offset_minutes: Mapped[int] = mapped_column(Integer, primary_key=True)


class ReminderDelivery(Base):
    """Журнал напоминаний: одна строка = одно событие «напомнить о вхождении за N минут».

    Уникальный ключ события гарантирует, что повторный скан, второй процесс или перезапуск не
    создадут повторное напоминание (DECISIONS D6). Строка также служит outbox для email и
    источником уведомлений в приложении.
    status: pending — email ждёт отправки; sent — email отправлен; no_email — email не настроен,
    только уведомление в приложении; failed — email не удалось отправить за MAX_ATTEMPTS попыток;
    missed — пропущено во время простоя, вхождение уже началось (DECISIONS D7), не отправляется.
    """

    __tablename__ = "reminder_deliveries"
    __table_args__ = (
        UniqueConstraint("note_id", "original_start", "offset_minutes", "fire_at", name="uq_reminder_event"),
        Index("ix_delivery_pending", "status", "fire_at"),
        Index("ix_delivery_fire_at", "fire_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), nullable=False)
    original_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    fire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    occurrence_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    late: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    email_to: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SchedulerState(Base):
    """Водяной знак планировщика: момент последнего успешного скана (DECISIONS D7)."""

    __tablename__ = "scheduler_state"
    __table_args__ = (CheckConstraint("id = 1", name="scheduler_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
