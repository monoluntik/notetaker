"""notes.reminders_resume_at: do not send reminders that fell due while a note was inactive or in trash

Требование задания: «Активировали после срока — прошедшие напоминания не досылаются»,
«восстановление из корзины возвращает те, чей срок ещё не наступил». Колонка добавляется
пустой (NULL) — существующие данные и поведение для них не меняются.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-28 18:23
"""
import sqlalchemy as sa
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notes', sa.Column('reminders_resume_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('notes', 'reminders_resume_at')
