"""race_plan.checks : étapes cochées de la feuille de route, partagées entre appareils.

Revision ID: 0015
Revises: 0014
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("race_plan") as batch:
        batch.add_column(sa.Column("checks", sa.JSON, nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("race_plan") as batch:
        batch.drop_column("checks")
