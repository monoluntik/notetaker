from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_now
from app.errors import Invalid
from app.schemas import OccurrenceOut, OccurrenceUpdate, UpcomingOut
from app.services import occurrences as occ_svc
from app.services.occurrences import occurrences_between
from app.services.upcoming import get_upcoming
from app.timeutil import ensure_aware

router = APIRouter(tags=["occurrences"])

MAX_WINDOW = timedelta(days=62)


@router.get("/occurrences", response_model=list[OccurrenceOut])
def list_occurrences(
    date_from: Annotated[datetime, Query(alias="from")],
    date_to: Annotated[datetime, Query(alias="to")],
    tag: Annotated[list[int] | None, Query()] = None,
    active: bool | None = None,
    db: Session = Depends(get_db),
):
    """Вхождения (с развёрнутыми повторениями) в окне [from, to) — для календаря."""
    start, end = ensure_aware(date_from, "from"), ensure_aware(date_to, "to")
    if end <= start:
        raise Invalid("to должно быть позже from")
    if end - start > MAX_WINDOW:
        raise Invalid("Окно не больше 62 дней")
    return occurrences_between(db, start, end, tag_ids=tag, active=active)


@router.get("/upcoming", response_model=UpcomingOut)
def upcoming(db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return get_upcoming(db, now)


@router.get("/notes/{note_id}/occurrences/{original_start}", response_model=OccurrenceOut)
def get_occurrence(note_id: int, original_start: datetime, db: Session = Depends(get_db)):
    return occ_svc.get_occurrence(db, note_id, original_start)


@router.patch("/notes/{note_id}/occurrences/{original_start}", response_model=OccurrenceOut)
def update_occurrence(note_id: int, original_start: datetime, data: OccurrenceUpdate, db: Session = Depends(get_db)):
    """Изменяет только одно вхождение серии (в т.ч. перенос при перетаскивании в календаре)."""
    return occ_svc.update_occurrence(db, note_id, original_start, data)


@router.delete("/notes/{note_id}/occurrences/{original_start}", status_code=204)
def cancel_occurrence(note_id: int, original_start: datetime, db: Session = Depends(get_db)):
    """Удаляет только одно вхождение серии."""
    occ_svc.cancel_occurrence(db, note_id, original_start)


@router.delete("/notes/{note_id}/occurrences/{original_start}/override", response_model=OccurrenceOut)
def reset_occurrence(note_id: int, original_start: datetime, db: Session = Depends(get_db)):
    """Сбрасывает изменения вхождения к значениям серии (возвращает и удалённое вхождение)."""
    return occ_svc.reset_occurrence(db, note_id, original_start)
