"""athlete_profile : lieu de la météo (nom, latitude, longitude).

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("athlete_profile") as batch:
        batch.add_column(sa.Column("meteo_lieu", sa.String, nullable=True))
        batch.add_column(sa.Column("meteo_lat", sa.Float, nullable=True))
        batch.add_column(sa.Column("meteo_lon", sa.Float, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("athlete_profile") as batch:
        batch.drop_column("meteo_lon")
        batch.drop_column("meteo_lat")
        batch.drop_column("meteo_lieu")
