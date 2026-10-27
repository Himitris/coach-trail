"""Plans d'entraînement : table plan, planned_session.plan_id (les séances existantes sont regroupées).

Revision ID: 0012
Revises: 0011
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

LEGACY_NAME = "Plan importé"


def upgrade() -> None:
    op.create_table(
        "plan",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("date_debut", sa.Date, nullable=False),
        sa.Column("date_fin", sa.Date, nullable=False),
        sa.Column("goal_id", sa.Integer, sa.ForeignKey("goal.id", ondelete="SET NULL")),
        sa.Column("cree_le", sa.DateTime, nullable=False),
    )
    op.create_index("ix_plan_goal_id", "plan", ["goal_id"])
    with op.batch_alter_table("planned_session") as batch:
        batch.add_column(sa.Column("plan_id", sa.Integer, nullable=True))
        batch.create_foreign_key(
            "fk_planned_session_plan", "plan", ["plan_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_index("ix_planned_session_plan_id", ["plan_id"])

    bind = op.get_bind()
    first, last = bind.execute(
        sa.text("SELECT MIN(date), MAX(date) FROM planned_session")
    ).one()
    if first is not None:
        bind.execute(
            sa.text(
                "INSERT INTO plan (nom, date_debut, date_fin, cree_le) "
                "VALUES (:nom, :debut, :fin, CURRENT_TIMESTAMP)"
            ),
            {"nom": LEGACY_NAME, "debut": first, "fin": last},
        )
        plan_id = bind.execute(
            sa.text("SELECT id FROM plan WHERE nom = :nom"), {"nom": LEGACY_NAME}
        ).scalar_one()
        bind.execute(sa.text("UPDATE planned_session SET plan_id = :id"), {"id": plan_id})


def downgrade() -> None:
    with op.batch_alter_table("planned_session") as batch:
        batch.drop_index("ix_planned_session_plan_id")
        batch.drop_constraint("fk_planned_session_plan", type_="foreignkey")
        batch.drop_column("plan_id")
    op.drop_index("ix_plan_goal_id", table_name="plan")
    op.drop_table("plan")
