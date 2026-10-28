"""Фоновый цикл напоминаний внутри процесса backend.

Каждый тик: scan() → уведомления в открытые вкладки по WebSocket → отправка email из outbox.
Первый тик выполняется сразу при старте, поэтому после перезапуска пропущенные за время
простоя напоминания обрабатываются по политике D7.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime

from sqlalchemy.orm import Session, sessionmaker

from app.email import EmailSender
from app.realtime import Hub
from app.schemas import NotificationOut
from app.services import reminders

log = logging.getLogger("notetaker.scheduler")


class ReminderScheduler:
    def __init__(self, factory: sessionmaker[Session], sender: EmailSender, hub: Hub,
                 clock: Callable[[], datetime], interval: float):
        self.factory, self.sender, self.hub, self.clock, self.interval = factory, sender, hub, clock, interval
        self._task: asyncio.Task | None = None

    def _scan(self) -> list[dict]:
        with self.factory() as db:
            result = reminders.scan(db, self.clock())
            return [NotificationOut.model_validate(d).model_dump(mode="json") for d in result.created]

    def _deliver(self) -> int:
        with self.factory() as db:
            return reminders.deliver_pending(db, self.sender, self.clock())

    async def tick(self) -> None:
        created = await asyncio.to_thread(self._scan)
        for n in created:
            await self.hub.broadcast({"type": "reminder", "notification": n})
        await asyncio.to_thread(self._deliver)

    async def _run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # планировщик не должен умирать из-за одной ошибки
                log.exception("scheduler tick failed")
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
