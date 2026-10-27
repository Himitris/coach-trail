"""source_status : état et message lisible.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("source_status") as batch:
        batch.add_column(sa.Column("state", sa.String))
        batch.add_column(sa.Column("message", sa.String))


def downgrade() -> None:
    with op.batch_alter_table("source_status") as batch:
        batch.drop_column("message")
        batch.drop_column("state")
