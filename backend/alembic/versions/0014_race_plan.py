"""race_plan : plan du jour J d'une course (nutrition, zones, veille, matin…), un par objectif.

Revision ID: 0014
Revises: 0013
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "race_plan",
        sa.Column(
            "goal_id",
            sa.Integer,
            sa.ForeignKey("goal.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("race_plan")
