"""Saisies du soir (evening_entry) et programme (planned_session).

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evening_entry",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column(
            "activity_id",
            sa.Integer,
            sa.ForeignKey("activity.id", ondelete="SET NULL"),
        ),
        sa.Column("activity_start_utc", sa.DateTime),
        sa.Column("rpe", sa.Integer),
        sa.Column("courbatures", sa.Integer),
        sa.Column("malade", sa.Boolean),
        sa.Column("note", sa.String),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("kind IN ('day', 'session')", name="ck_entry_kind"),
        sa.CheckConstraint(
            "(kind = 'day' AND activity_id IS NULL AND rpe IS NULL)"
            " OR (kind = 'session' AND rpe IS NOT NULL AND courbatures IS NULL"
            " AND malade IS NULL AND note IS NULL)",
            name="ck_entry_shape",
        ),
        sa.CheckConstraint("rpe IS NULL OR (rpe >= 0 AND rpe <= 10)", name="ck_entry_rpe"),
        sa.CheckConstraint(
            "courbatures IS NULL OR (courbatures >= 0 AND courbatures <= 10)",
            name="ck_entry_courbatures",
        ),
    )
    op.create_index(
        "uq_entry_day",
        "evening_entry",
        ["date"],
        unique=True,
        sqlite_where=sa.text("kind = 'day'"),
    )
    op.create_index("uq_entry_activity", "evening_entry", ["activity_id"], unique=True)
    op.create_index("ix_entry_date", "evening_entry", ["date"])
    op.create_table(
        "planned_session",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("titre", sa.String, nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("objectif", sa.String),
        sa.Column("duree_min", sa.Integer),
        sa.Column("zone_cible", sa.String),
        sa.Column("dplus_cible", sa.Integer),
        sa.Column("consignes", sa.String),
    )
    op.create_index("ix_planned_session_date", "planned_session", ["date"])


def downgrade() -> None:
    op.drop_table("planned_session")
    op.drop_table("evening_entry")
