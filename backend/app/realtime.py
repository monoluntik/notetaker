"""Рассылка событий всем открытым вкладкам по WebSocket (в пределах одного процесса, D11)."""

import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("notetaker.ws")


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._clients)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message, default=str)
        async with self._lock:
            clients = list(self._clients)
        for ws in clients:
            try:
                await ws.send_text(data)
            except Exception:  # вкладка закрылась — убираем
                log.info("drop websocket client")
                await self.disconnect(ws)
