"""notes.idempotency_key: a repeated create request does not create a second note

Колонка добавляется пустой; уникальный частичный индекс — только по заданным ключам.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-29 07:05
"""
import sqlalchemy as sa
from alembic import op

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notes', sa.Column('idempotency_key', sa.String(length=64), nullable=True))
    op.create_index('uq_notes_idempotency_key', 'notes', ['idempotency_key'], unique=True,
                    postgresql_where=sa.text('idempotency_key IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('uq_notes_idempotency_key', table_name='notes')
    op.drop_column('notes', 'idempotency_key')
