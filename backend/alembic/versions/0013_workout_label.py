"""Type de séance choisi à la main pour une activité.

Revision ID: 0013
Revises: 0012
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_workout_label",
        sa.Column(
            "activity_id",
            sa.Integer,
            sa.ForeignKey("activity.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("activity_workout_label")
