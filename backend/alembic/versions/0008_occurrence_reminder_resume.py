"""occurrence_reminder_resume: reactivating one occurrence of a series does not send past reminders

Требование задания: «Активировали после срока — прошедшие напоминания не досылаются».
Для всей заметки это делает notes.reminders_resume_at (0007); здесь — то же для отдельного
вхождения серии. Таблица новая и пустая — существующие данные не меняются.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-29 06:45
"""
import sqlalchemy as sa
from alembic import op

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'occurrence_reminder_resume',
        sa.Column('note_id', sa.Integer(), nullable=False),
        sa.Column('original_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resume_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['note_id'], ['notes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('note_id', 'original_start'),
    )


def downgrade() -> None:
    op.drop_table('occurrence_reminder_resume')
