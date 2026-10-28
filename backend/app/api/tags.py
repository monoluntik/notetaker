from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import TagCreate, TagOut, TagUpdate, TagWithCount
from app.services import tags as svc

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagWithCount])
def list_tags(db: Session = Depends(get_db)):
    return [TagWithCount(id=t.id, name=t.name, color=t.color, note_count=n) for t, n in svc.list_tags(db)]


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(data: TagCreate, db: Session = Depends(get_db)):
    return svc.create_tag(db, data)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(tag_id: int, data: TagUpdate, db: Session = Depends(get_db)):
    return svc.update_tag(db, tag_id, data)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    svc.delete_tag(db, tag_id)
