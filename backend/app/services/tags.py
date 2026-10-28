from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import Conflict, NotFound
from app.models import Note, Tag, note_tags
from app.schemas import TagCreate, TagUpdate


def list_tags(db: Session, with_counts: bool = True) -> list[tuple[Tag, int | None]]:
    tags = db.scalars(select(Tag).order_by(func.lower(Tag.name))).all()
    if not with_counts:
        return [(t, None) for t in tags]
    # Число заметок вне корзины = все связи тега − связи заметок в корзине. Соединение 21 млн
    # связей с заметками стоило ~1.7 с на 10M (docs/LOADTEST.md), вычитание — ~0.3 с.
    total = dict(db.execute(select(note_tags.c.tag_id, func.count()).group_by(note_tags.c.tag_id)).tuples().all())
    trashed = dict(db.execute(
        select(note_tags.c.tag_id, func.count()).join(Note, Note.id == note_tags.c.note_id)
        .where(Note.deleted_at.is_not(None)).group_by(note_tags.c.tag_id)
    ).tuples().all())
    return [(t, total.get(t.id, 0) - trashed.get(t.id, 0)) for t in tags]


def get_tag(db: Session, tag_id: int) -> Tag:
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise NotFound(f"Тег {tag_id} не найден")
    return tag


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> None:
    q = select(Tag.id).where(func.lower(Tag.name) == name.lower())
    if exclude_id is not None:
        q = q.where(Tag.id != exclude_id)
    if db.scalar(q) is not None:
        raise Conflict(f"Тег с именем «{name}» уже существует")


def create_tag(db: Session, data: TagCreate) -> Tag:
    _ensure_unique_name(db, data.name)
    tag = Tag(name=data.name, color=data.color)
    db.add(tag)
    db.commit()
    return tag


def update_tag(db: Session, tag_id: int, data: TagUpdate) -> Tag:
    tag = get_tag(db, tag_id)
    if data.name is not None and data.name != tag.name:
        _ensure_unique_name(db, data.name, exclude_id=tag.id)
        tag.name = data.name
    if data.color is not None:
        tag.color = data.color
    db.commit()
    return tag


def delete_tag(db: Session, tag_id: int) -> None:
    tag = get_tag(db, tag_id)
    # Заметки (включая корзину), у которых этот тег — единственный: удаление нарушило бы «≥1 тег».
    only_tag_notes = (
        select(note_tags.c.note_id)
        .group_by(note_tags.c.note_id)
        .having(func.count() == 1)
        .having(func.bool_and(note_tags.c.tag_id == tag_id))
    )
    titles = db.scalars(select(Note.title).where(Note.id.in_(only_tag_notes)).limit(5)).all()
    if titles:
        sample = ", ".join(f"«{t}»" for t in titles)
        raise Conflict(
            f"Тег «{tag.name}» — единственный у заметок: {sample}. "
            "Сначала добавьте этим заметкам другой тег."
        )
    db.delete(tag)
    db.commit()
