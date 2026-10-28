from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_now
from app.schemas import NoteCreate, NoteOut, NoteUpdate, Page, SortField, SortOrder
from app.services import notes as svc
from app.timeutil import ensure_aware

router = APIRouter(tags=["notes"])


@router.get("/notes", response_model=Page[NoteOut])
def list_notes(
    db: Session = Depends(get_db),
    q: str | None = None,
    tag: Annotated[list[int] | None, Query(description="id тегов (любой из)")] = None,
    active: bool | None = None,
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    sort: SortField = "start_at",
    order: SortOrder = "asc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 20,
):
    items, total, capped = svc.list_notes(
        db,
        q=q,
        tag_ids=tag,
        active=active,
        date_from=ensure_aware(date_from, "from") if date_from else None,
        date_to=ensure_aware(date_to, "to") if date_to else None,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
    return Page(items=items, total=total, total_capped=capped, page=page, page_size=page_size)


@router.post("/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(data: NoteCreate, db: Session = Depends(get_db)):
    return svc.create_note(db, data)


@router.get("/notes/{note_id}", response_model=NoteOut)
def get_note(note_id: int, db: Session = Depends(get_db)):
    return svc.get_note(db, note_id)


@router.patch("/notes/{note_id}", response_model=NoteOut)
def update_note(note_id: int, data: NoteUpdate, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return svc.update_note(db, note_id, data, now)


Version = Annotated[int, Query(description="Версия заметки, известная клиенту; устаревшая → 409")]


@router.delete("/notes/{note_id}", response_model=NoteOut)
def trash_note(note_id: int, version: Version, db: Session = Depends(get_db)):
    """Перемещает заметку (или всю серию) в корзину."""
    return svc.trash_note(db, note_id, version)


@router.post("/notes/{note_id}/restore", response_model=NoteOut)
def restore_note(note_id: int, version: Version, db: Session = Depends(get_db), now: datetime = Depends(get_now)):
    return svc.restore_note(db, note_id, version, now)


@router.delete("/notes/{note_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge_note(note_id: int, version: Version, db: Session = Depends(get_db)):
    svc.purge_note(db, note_id, version)


@router.get("/trash", response_model=Page[NoteOut])
def list_trash(
    db: Session = Depends(get_db),
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
):
    items, total, capped = svc.list_notes(db, deleted=True, page=page, page_size=page_size)
    return Page(items=items, total=total, total_capped=capped, page=page, page_size=page_size)


@router.delete("/trash")
def empty_trash(db: Session = Depends(get_db)) -> dict:
    return {"deleted": svc.empty_trash(db)}
