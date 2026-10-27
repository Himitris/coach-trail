"""goal.profil_points : profil altimétrique de la course [[km, altitude], ...].

Revision ID: 0009
Revises: 0008
"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("goal") as batch:
        batch.add_column(sa.Column("profil_points", sa.JSON, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("goal") as batch:
        batch.drop_column("profil_points")
