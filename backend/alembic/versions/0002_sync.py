"""Sync : raw_payload, activity, activity_stream, wellness_daily, source_status.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "raw_payload",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("external_key", sa.String, nullable=False),
        sa.Column("fetched_at", sa.DateTime, nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("hash", sa.String(64), nullable=False),
        sa.UniqueConstraint("source", "type", "external_key", name="uq_raw_payload"),
    )
    op.create_table(
        "activity",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("external_id", sa.String, nullable=False),
        sa.Column("sport", sa.String, nullable=False),
        sa.Column("start_utc", sa.DateTime, nullable=False),
        sa.Column("duration_s", sa.Float, nullable=False),
        sa.Column("distance_m", sa.Float),
        sa.Column("elevation_gain_m", sa.Float),
        sa.Column("elevation_loss_m", sa.Float),
        sa.Column("hr_avg", sa.Integer),
        sa.Column("hr_max", sa.Integer),
        sa.Column("calories", sa.Integer),
        sa.Column("gear", sa.String),
        sa.Column("dedup_group_id", sa.Integer),
        sa.UniqueConstraint("source", "external_id", name="uq_activity_source_ext"),
    )
    op.create_index("ix_activity_start_utc", "activity", ["start_utc"])
    op.create_index("ix_activity_dedup_group_id", "activity", ["dedup_group_id"])
    op.create_table(
        "activity_stream",
        sa.Column(
            "activity_id",
            sa.Integer,
            sa.ForeignKey("activity.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("samples", sa.LargeBinary, nullable=False),
    )
    op.create_table(
        "wellness_daily",
        sa.Column("date", sa.Date, primary_key=True),
        sa.Column("source", sa.String, primary_key=True),
        sa.Column("hrv_nuit", sa.Float),
        sa.Column("hrv_base_min", sa.Float),
        sa.Column("hrv_base_max", sa.Float),
        sa.Column("fc_repos", sa.Integer),
        sa.Column("sommeil_duree_s", sa.Integer),
        sa.Column("sommeil_efficacite", sa.Float),
        sa.Column("stress", sa.Integer),
        sa.Column("spo2", sa.Float),
        sa.Column("training_readiness", sa.Integer),
        sa.Column("body_battery_max", sa.Integer),
        sa.Column("body_battery_min", sa.Integer),
        sa.Column("poids_kg", sa.Float),
    )
    op.create_table(
        "source_status",
        sa.Column("source", sa.String, primary_key=True),
        sa.Column("last_success_at", sa.DateTime),
        sa.Column("last_error_at", sa.DateTime),
        sa.Column("last_error_message", sa.String),
        sa.Column("unavailable_since", sa.DateTime),
    )


def downgrade() -> None:
    for table in ("source_status", "wellness_daily", "activity_stream", "activity", "raw_payload"):
        op.drop_table(table)
