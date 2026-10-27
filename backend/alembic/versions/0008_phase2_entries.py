"""Phase 2 : nutrition en sortie (fueling_entry), renforcement saisi (strength_session), objectif.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fueling_entry",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "activity_id",
            sa.Integer,
            sa.ForeignKey("activity.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("glucides_g_par_h", sa.Float, nullable=False),
        sa.Column("score_digestif", sa.Integer, nullable=False),
        sa.Column("note", sa.String),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint(
            "glucides_g_par_h >= 0 AND glucides_g_par_h <= 300", name="ck_fueling_carbs"
        ),
        sa.CheckConstraint("score_digestif >= 0 AND score_digestif <= 5", name="ck_fueling_gi"),
    )
    op.create_index("uq_fueling_activity", "fueling_entry", ["activity_id"], unique=True)
    op.create_table(
        "strength_session",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("duree_min", sa.Integer),
        sa.Column("note", sa.String),
    )
    op.create_index("ix_strength_date", "strength_session", ["date"])
    with op.batch_alter_table("athlete_profile") as batch:
        batch.add_column(sa.Column("renfo_objectif_hebdo", sa.Integer, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("athlete_profile") as batch:
        batch.drop_column("renfo_objectif_hebdo")
    op.drop_table("strength_session")
    op.drop_table("fueling_entry")
