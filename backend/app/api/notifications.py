from datetime import datetime

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_now
from app.schemas import NotificationOut
from app.services import reminders

router = APIRouter(tags=["notifications"])
ws_router = APIRouter()


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(unread: bool = True, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    """Уведомления о напоминаниях за 7 дней (по умолчанию — непрочитанные).

    Вкладка, открытая после срабатывания напоминания, получает его отсюда.
    """
    return reminders.list_notifications(db, now, unread_only=unread)


class ReadRequest(BaseModel):
    ids: list[int]


@router.post("/notifications/read")
async def mark_read(data: ReadRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    ids = reminders.mark_read(db, data.ids)
    if ids:
        # Скрыть уведомление во всех вкладках
        await request.app.state.hub.broadcast({"type": "notifications_read", "ids": ids})
    return {"read": ids}


@ws_router.websocket("/ws")
async def websocket(ws: WebSocket):
    hub = ws.app.state.hub
    await hub.connect(ws)
    try:
        await ws.send_json({"type": "hello"})
        while True:
            await ws.receive_text()  # клиент ничего не шлёт; ждём отключения
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(ws)
