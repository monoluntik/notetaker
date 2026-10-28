"""note version for edit conflicts

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-28 13:53
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notes', sa.Column('version', sa.Integer(), server_default='1', nullable=False))


def downgrade() -> None:
    op.drop_column('notes', 'version')
