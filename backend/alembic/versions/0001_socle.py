"""Tables socle : athlete_profile, goal.

Revision ID: 0001
Revises:
"""
from datetime import UTC, date, datetime

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# Zones 1-5 en % de la FC max (195), repère Garmin ; modifiables via PUT /api/profile.
DEFAULT_ZONES = [
    {"zone": 1, "min_pct": 50, "max_pct": 60, "min_bpm": 98, "max_bpm": 117},
    {"zone": 2, "min_pct": 60, "max_pct": 70, "min_bpm": 117, "max_bpm": 137},
    {"zone": 3, "min_pct": 70, "max_pct": 80, "min_bpm": 137, "max_bpm": 156},
    {"zone": 4, "min_pct": 80, "max_pct": 90, "min_bpm": 156, "max_bpm": 176},
    {"zone": 5, "min_pct": 90, "max_pct": 100, "min_bpm": 176, "max_bpm": 195},
]


def upgrade() -> None:
    profile = op.create_table(
        "athlete_profile",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("fc_max", sa.Integer, nullable=False),
        sa.Column("fc_repos", sa.Integer),
        sa.Column("seuil_lactique_fc", sa.Integer),
        sa.Column("zones", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("id = 1", name="ck_athlete_profile_single_row"),
    )
    goal = op.create_table(
        "goal",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("distance_km", sa.Float),
        sa.Column("dplus_m", sa.Integer),
        sa.Column("priorite", sa.Integer, nullable=False, server_default="1"),
    )
    op.bulk_insert(
        profile,
        [
            {
                "id": 1,
                "fc_max": 195,
                "fc_repos": None,
                "seuil_lactique_fc": None,
                "zones": DEFAULT_ZONES,
                "updated_at": datetime.now(UTC).replace(tzinfo=None),
            }
        ],
    )
    op.bulk_insert(
        goal,
        [
            {
                "nom": "Trail des 3 Rocs",
                "date": date(2026, 11, 8),
                "distance_km": 31.0,
                "dplus_m": 1600,
                "priorite": 1,
            },
            {
                # Date provisoire (mi-février 2027).
                "nom": "Trail de Bruniquel",
                "date": date(2027, 2, 15),
                "distance_km": 39.0,
                "dplus_m": None,
                "priorite": 2,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("goal")
    op.drop_table("athlete_profile")
