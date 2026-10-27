"""wellness_daily : CTL/ATL fournis par la source (Intervals.icu), pour comparaison seulement.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("wellness_daily") as batch:
        batch.add_column(sa.Column("source_ctl", sa.Float, nullable=True))
        batch.add_column(sa.Column("source_atl", sa.Float, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("wellness_daily") as batch:
        batch.drop_column("source_atl")
        batch.drop_column("source_ctl")
