from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_now
from app.errors import Invalid
from app.schemas import OccurrenceOut, UpcomingOut
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
