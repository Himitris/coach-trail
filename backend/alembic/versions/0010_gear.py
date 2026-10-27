"""Matériel : gear_item (chaussures, seuil d'usure) et gear_assignment (affectation manuelle).

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gear_item",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("seuil_km", sa.Integer, nullable=False, server_default="800"),
        sa.Column("km_initial", sa.Float, nullable=False, server_default="0"),
        sa.Column("retire", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.CheckConstraint("seuil_km >= 50 AND seuil_km <= 5000", name="ck_gear_seuil"),
        sa.CheckConstraint("km_initial >= 0 AND km_initial <= 20000", name="ck_gear_km_initial"),
    )
    op.create_table(
        "gear_assignment",
        sa.Column(
            "activity_id",
            sa.Integer,
            sa.ForeignKey("activity.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "gear_id",
            sa.Integer,
            sa.ForeignKey("gear_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index("ix_gear_assignment_gear", "gear_assignment", ["gear_id"])


def downgrade() -> None:
    op.drop_table("gear_assignment")
    op.drop_table("gear_item")
