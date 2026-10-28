"""partial indexes for list sorting (non-deleted notes)

Нагрузочный тест 10M (docs/LOADTEST.md): первая страница списка с сортировкой (start_at, id)
занимала 228 мс, фильтр по «тяжёлому» тегу — 871 мс: индекс (deleted_at, start_at) не даёт
порядок по (start_at, id). Частичные индексы по неудалённым заметкам дают готовый порядок.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-28 17:30
"""
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX ix_notes_live_start ON notes (start_at, id) WHERE deleted_at IS NULL")
    op.execute("CREATE INDEX ix_notes_live_updated ON notes (updated_at, id) WHERE deleted_at IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_live_updated")
    op.execute("DROP INDEX IF EXISTS ix_notes_live_start")
