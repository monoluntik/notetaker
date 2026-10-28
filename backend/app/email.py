"""Отправка email. Адаптер выбирается настройкой NOTETAKER_EMAIL_BACKEND."""

import logging
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol

from app.config import Settings

log = logging.getLogger("notetaker.email")


@dataclass
class Email:
    to: str
    subject: str
    body: str
    message_id: str  # детерминирован по событию: дубль можно отбросить на стороне почты


class EmailSender(Protocol):
    def send(self, email: Email) -> None: ...


class ConsoleEmailSender:
    """Пишет письмо в лог — для разработки без почтового сервера."""

    def send(self, email: Email) -> None:
        log.warning("EMAIL to=%s subject=%r message_id=%s\n%s", email.to, email.subject, email.message_id, email.body)


class SmtpEmailSender:
    """SMTP без авторизации (например, Mailpit из docker-compose)."""

    def __init__(self, host: str, port: int, sender: str):
        self.host, self.port, self.sender = host, port, sender

    def send(self, email: Email) -> None:
        msg = EmailMessage()
        msg["From"] = self.sender
        msg["To"] = email.to
        msg["Subject"] = email.subject
        msg["Message-ID"] = email.message_id
        msg.set_content(email.body)
        with smtplib.SMTP(self.host, self.port, timeout=10) as smtp:
            smtp.send_message(msg)


@dataclass
class MemoryEmailSender:
    """Тестовый адаптер: складывает письма в список; может имитировать сбой."""

    sent: list[Email] = field(default_factory=list)
    fail_times: int = 0

    def send(self, email: Email) -> None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError("SMTP недоступен (имитация)")
        self.sent.append(email)


def make_sender(settings: Settings) -> EmailSender:
    if settings.email_backend == "smtp":
        return SmtpEmailSender(settings.smtp_host, settings.smtp_port, settings.smtp_from)
    if settings.email_backend == "memory":
        return MemoryEmailSender()
    return ConsoleEmailSender()
