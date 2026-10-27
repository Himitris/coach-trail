"""activity.is_race : course (exclue des comparaisons de FC entre séances).

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("activity") as batch:
        batch.add_column(
            sa.Column("is_race", sa.Boolean, nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("activity") as batch:
        batch.drop_column("is_race")
