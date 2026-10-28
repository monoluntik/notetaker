from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_now
from app.errors import Invalid
from app.schemas import NoteOut, NoteSplit, OccurrenceOut, OccurrenceUpdate, UpcomingOut
from app.services import notes as notes_svc
from app.services import occurrences as occ_svc
from app.services.occurrences import count_occurrences, occurrences_between
from app.services.upcoming import get_upcoming
from app.timeutil import ensure_aware

router = APIRouter(tags=["occurrences"])

MAX_WINDOW = timedelta(days=62)


CALENDAR_LIMIT = 5000


@router.get("/occurrences", response_model=list[OccurrenceOut])
def list_occurrences(
    response: Response,
    date_from: Annotated[datetime, Query(alias="from")],
    date_to: Annotated[datetime, Query(alias="to")],
    tag: Annotated[list[int] | None, Query()] = None,
    active: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=CALENDAR_LIMIT)] = CALENDAR_LIMIT,
    db: Session = Depends(get_db),
):
    """Вхождения (с развёрнутыми повторениями) в окне [from, to) — для календаря.

    Не больше `limit` (по умолчанию 5000) самых ранних; если вхождений больше, заголовки
    X-Truncated: true и X-Total-Count сообщают клиенту реальное число.
    """
    start, end = ensure_aware(date_from, "from"), ensure_aware(date_to, "to")
    if end <= start:
        raise Invalid("to должно быть позже from")
    if end - start > MAX_WINDOW:
        raise Invalid("Окно не больше 62 дней")
    items = occurrences_between(db, start, end, tag_ids=tag, active=active, limit=limit + 1)
    if len(items) > limit:
        response.headers["X-Truncated"] = "true"
        if not tag and active is None:
            response.headers["X-Total-Count"] = str(count_occurrences(db, start, end))
        items = items[:limit]
    return items


@router.get("/upcoming", response_model=UpcomingOut)
def upcoming(
    db: Session = Depends(get_db),
    now: datetime = Depends(get_now),
    overdue_limit: Annotated[int, Query(ge=1, le=1000)] = 50,
):
    return get_upcoming(db, now, overdue_limit)


@router.get("/notes/{note_id}/occurrences/{original_start}", response_model=OccurrenceOut)
def get_occurrence(note_id: int, original_start: datetime, db: Session = Depends(get_db)):
    return occ_svc.get_occurrence(db, note_id, original_start)


@router.patch("/notes/{note_id}/occurrences/{original_start}", response_model=OccurrenceOut)
def update_occurrence(note_id: int, original_start: datetime, data: OccurrenceUpdate, db: Session = Depends(get_db)):
    """Изменяет только одно вхождение серии (в т.ч. перенос при перетаскивании в календаре)."""
    return occ_svc.update_occurrence(db, note_id, original_start, data)


@router.delete("/notes/{note_id}/occurrences/{original_start}", status_code=204)
def cancel_occurrence(note_id: int, original_start: datetime, version: Annotated[int, Query()],
                      db: Session = Depends(get_db)):
    """Удаляет только одно вхождение серии."""
    occ_svc.cancel_occurrence(db, note_id, original_start, version)


@router.delete("/notes/{note_id}/occurrences/{original_start}/override", response_model=OccurrenceOut)
def reset_occurrence(note_id: int, original_start: datetime, version: Annotated[int, Query()],
                     db: Session = Depends(get_db)):
    """Сбрасывает изменения вхождения к значениям серии (возвращает и удалённое вхождение)."""
    return occ_svc.reset_occurrence(db, note_id, original_start, version)


@router.post("/notes/{note_id}/occurrences/{original_start}/split", response_model=NoteOut, status_code=201)
def split_series(note_id: int, original_start: datetime, data: NoteSplit, db: Session = Depends(get_db)):
    """Изменяет серию начиная с этого вхождения; прошлые вхождения остаются как были (D17)."""
    return notes_svc.split_series(db, note_id, original_start, data)
