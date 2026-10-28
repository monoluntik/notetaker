"""Напоминания: поиск наступивших событий и доставка (DECISIONS D6, D7).

scan() — находит напоминания с fire_at <= now и записывает их в reminder_deliveries.
         Повторный вызов, второй процесс или перезапуск не создают дублей:
         один сканер за раз (advisory lock) + уникальный ключ события + ON CONFLICT DO NOTHING.
deliver_pending() — отправляет email из outbox; строка блокируется на время отправки
         (FOR UPDATE SKIP LOCKED), поэтому два обработчика не отправят одно письмо дважды.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.email import Email, EmailSender
from app.models import Note, ReminderDelivery, SchedulerState
from app.services.occurrences import current_occurrence, occurrences_between
from app.services.settings import get_settings_row
from app.timeutil import get_zone

log = logging.getLogger("notetaker.reminders")

SCAN_LOCK_KEY = 0x4E6F7465  # произвольная константа для pg_advisory_xact_lock
MAX_OFFSET = timedelta(minutes=1440)
MAX_ATTEMPTS = 5
LATE_THRESHOLD = timedelta(minutes=1)  # позже — считаем отправленным с опозданием (простой)
OFFSET_TEXT = {10: "через 10 минут", 60: "через 1 час", 1440: "через 1 день"}


@dataclass
class ScanResult:
    created: list[ReminderDelivery]  # новые напоминания для уведомления в приложении
    missed: int
    skipped_lock: bool = False


def scan(db: Session, now: datetime) -> ScanResult:
    # Транзакционный advisory lock: одновременно сканирует только один процесс/поток.
    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": SCAN_LOCK_KEY}):
        db.rollback()
        return ScanResult(created=[], missed=0, skipped_lock=True)

    state = db.get(SchedulerState, 1, with_for_update=True)
    if state is None:
        state = SchedulerState(id=1)
        db.add(state)
    # Первый запуск: историю не досылаем, отсчёт от текущего момента (D7)
    watermark = state.last_scan_at or now
    if watermark > now:  # часы сдвинулись назад — не теряем события
        watermark = now

    email = get_settings_row(db).email
    notes_with_reminders = {
        n.id: (n.reminders, n.updated_at)
        for n in db.scalars(select(Note).where(Note.reminder_rules.any(), Note.deleted_at.is_(None)))
    }
    created: list[ReminderDelivery] = []
    missed = 0
    candidates: list[tuple] = []  # (occ, offset, fire_at)
    if notes_with_reminders:
        # Вхождения, которые ещё не начались к прошлому скану и начнутся не позже чем через сутки
        for occ in occurrences_between(db, watermark, now + MAX_OFFSET + timedelta(seconds=1)):
            if occ.note_id not in notes_with_reminders or not occ.is_active:
                continue
            for offset in notes_with_reminders[occ.note_id][0]:
                fire_at = occ.start_at - timedelta(minutes=offset)
                if fire_at <= now:
                    candidates.append((occ, offset, fire_at))

    # Уже обработанные события отбрасываем заранее одним запросом: INSERT … ON CONFLICT DO NOTHING
    # расходует значение sequence даже при конфликте, а событие остаётся в окне скана до начала
    # вхождения (до суток × 4 тика в минуту). ON CONFLICT остаётся защитой от гонок.
    if candidates:
        keys = {(o.note_id, o.original_start, off, f) for o, off, f in candidates}
        existing = set(
            db.execute(
                select(
                    ReminderDelivery.note_id, ReminderDelivery.original_start,
                    ReminderDelivery.offset_minutes, ReminderDelivery.fire_at,
                ).where(
                    tuple_(
                        ReminderDelivery.note_id, ReminderDelivery.original_start,
                        ReminderDelivery.offset_minutes, ReminderDelivery.fire_at,
                    ).in_(list(keys))
                )
            ).tuples()
        )
        candidates = [c for c in candidates if (c[0].note_id, c[0].original_start, c[1], c[2]) not in existing]

    for occ, offset, fire_at in candidates:
        note_updated_at = notes_with_reminders[occ.note_id][1]
        started = occ.start_at <= now
        status = "missed" if started else ("pending" if email else "no_email")
        row_id = db.scalar(
            insert(ReminderDelivery)
            .values(
                note_id=occ.note_id,
                original_start=occ.original_start,
                offset_minutes=offset,
                fire_at=fire_at,
                occurrence_start=occ.start_at,
                title=occ.title,
                status=status,
                # «С опозданием» — только если задержка вызвана простоем, а не тем, что
                # заметку создали/изменили уже после момента напоминания.
                late=now - fire_at > LATE_THRESHOLD and fire_at > note_updated_at,
                email_to=email if status == "pending" else None,
            )
            .on_conflict_do_nothing(constraint="uq_reminder_event")
            .returning(ReminderDelivery.id)
        )
        if row_id is None:
            continue  # параллельный процесс успел первым
        if started:
            missed += 1
        else:
            created.append(db.get(ReminderDelivery, row_id))
    state.last_scan_at = now
    db.commit()
    if missed:
        log.warning(
            "%s reminder(s) marked missed: event already started when the scheduler ran "
            "(downtime %s → %s, policy D7: not sent)", missed, watermark.isoformat(), now.isoformat(),
        )
    return ScanResult(created=created, missed=missed)


def mask_email(addr: str | None) -> str:
    """m***@example.com — адрес в логах без полного раскрытия."""
    if not addr or "@" not in addr:
        return "-"
    local, domain = addr.split("@", 1)
    return f"{local[:1]}***@{domain}"


def _render_email(d: ReminderDelivery, tz_name: str) -> Email:
    local = d.occurrence_start.astimezone(get_zone(tz_name))
    when = local.strftime("%d.%m.%Y %H:%M")
    prefix = "[с опозданием] " if d.late else ""
    return Email(
        to=d.email_to or "",
        subject=f"{prefix}Напоминание: {d.title} — {when}",
        body=(
            f"Заметка «{d.title}» начнётся {OFFSET_TEXT.get(d.offset_minutes, '')}: {when} ({tz_name}).\n"
            + ("\nНапоминание отправлено с опозданием: сервер был недоступен в момент срабатывания.\n" if d.late else "")
        ),
        message_id=f"<reminder-{d.note_id}-{int(d.original_start.timestamp())}-{d.offset_minutes}"
        f"-{int(d.fire_at.timestamp())}@notetaker>",
    )


def _obsolete_reason(db: Session, d: ReminderDelivery) -> str | None:
    """Почему напоминание из очереди больше не нужно отправлять (None — отправлять)."""
    note = db.get(Note, d.note_id)
    if note is None or note.deleted_at is not None:
        return "заметка удалена"
    if d.offset_minutes not in note.reminders:
        return "напоминание отключено"
    occ = current_occurrence(note, d.original_start)
    if occ is None:
        return "вхождение удалено или серия изменена"
    if not occ.is_active:
        return "заметка неактивна"
    if occ.start_at != d.occurrence_start:
        return "время заметки изменено"  # для нового времени scan() создаст новое событие
    return None


def deliver_pending(db: Session, sender: EmailSender, now: datetime, limit: int = 50) -> int:
    """Отправляет ожидающие email. Возвращает число успешно отправленных писем."""
    sent = 0
    tz_name = get_settings_row(db).timezone
    db.commit()
    for _ in range(limit):
        d = db.scalar(
            select(ReminderDelivery)
            .where(ReminderDelivery.status == "pending")
            .order_by(ReminderDelivery.fire_at, ReminderDelivery.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if d is None:
            break
        # Между сканом и отправкой (например, пока почта была недоступна) заметку могли удалить,
        # деактивировать или перенести — такое письмо уже вводило бы в заблуждение.
        reason = _obsolete_reason(db, d)
        if reason:
            d.status = "cancelled"
            d.last_error = reason
            db.commit()
            log.info("reminder email cancelled: delivery=%s note=%s reason=%s", d.id, d.note_id, reason)
            continue
        try:
            sender.send(_render_email(d, tz_name))
        except Exception as exc:  # noqa: BLE001 — любая ошибка адаптера = неудачная попытка
            d.attempts += 1
            d.last_error = f"{type(exc).__name__}: {exc}"[:500]
            if d.attempts >= MAX_ATTEMPTS:
                d.status = "failed"
            db.commit()
            if d.status == "failed":
                log.error(
                    "email delivery gave up after %s attempts: delivery=%s note=%s to=%s last_error=%s "
                    "(in-app notification was shown; email will not be retried)",
                    d.attempts, d.id, d.note_id, mask_email(d.email_to), d.last_error,
                )
                continue
            log.warning(
                "email delivery failed: delivery=%s note=%s to=%s attempt=%s/%s error=%s; "
                "will retry on the next scheduler tick",
                d.id, d.note_id, mask_email(d.email_to), d.attempts, MAX_ATTEMPTS, d.last_error,
            )
            break  # почта недоступна — остальные письма тоже подождут следующего тика
        d.status = "sent"
        d.attempts += 1
        d.sent_at = now
        db.commit()  # строка оставалась заблокированной до фиксации статуса
        log.info("reminder email sent: delivery=%s note=%s to=%s attempt=%s",
                 d.id, d.note_id, mask_email(d.email_to), d.attempts)
        sent += 1
    return sent


def list_notifications(db: Session, now: datetime, unread_only: bool = True, limit: int = 50) -> list[ReminderDelivery]:
    stmt = (
        select(ReminderDelivery)
        .where(ReminderDelivery.status != "missed", ReminderDelivery.fire_at >= now - timedelta(days=7))
        .order_by(ReminderDelivery.fire_at.desc(), ReminderDelivery.id.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(ReminderDelivery.read_at.is_(None))
    return list(db.scalars(stmt))


def mark_read(db: Session, ids: list[int]) -> list[int]:
    rows = db.scalars(
        select(ReminderDelivery).where(ReminderDelivery.id.in_(ids), ReminderDelivery.read_at.is_(None))
    ).all()
    for r in rows:
        r.read_at = func.now()
    db.commit()
    return [r.id for r in rows]
