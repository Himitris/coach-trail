"""Disposition du tableau de bord : pages, widgets, positions par point de rupture, réglages.

Le serveur ne connaît pas les types de widgets (le catalogue vit dans le frontend) : il valide la
structure et les limites, et stocke le document tel quel. Un seul document pour toute l'appli
(1 utilisateur), identique sur téléphone et ordinateur, avec un numéro de révision pour éviter
qu'un appareil n'écrase silencieusement les modifications d'un autre.
"""

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DashboardLayoutRow
from app.routes.deps import get_db

MAX_PAGES = 50
MAX_WIDGETS_PER_PAGE = 60
MAX_SETTINGS_BYTES = 20_000
MAX_DOCUMENT_BYTES = 512_000

Breakpoint = Literal["lg", "md", "sm"]  # ordinateur / tablette / téléphone
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[\w.-]+$")]


class GridItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    i: Identifier  # id du widget
    x: Annotated[int, Field(ge=0, le=99)]
    y: Annotated[int, Field(ge=0, le=100_000)]
    w: Annotated[int, Field(ge=1, le=99)]
    h: Annotated[int, Field(ge=1, le=99)]


class WidgetInstance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Identifier
    type: Identifier
    settings: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _settings_size(self) -> "WidgetInstance":
        if len(json.dumps(self.settings, ensure_ascii=False)) > MAX_SETTINGS_BYTES:
            raise ValueError("réglages du widget trop volumineux")
        return self


class Page(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Identifier
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    widgets: list[WidgetInstance] = Field(default_factory=list, max_length=MAX_WIDGETS_PER_PAGE)
    layouts: dict[Breakpoint, list[GridItem]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistent(self) -> "Page":
        ids = [w.id for w in self.widgets]
        if len(set(ids)) != len(ids):
            raise ValueError(f"page « {self.title} » : identifiants de widgets en double")
        known = set(ids)
        for bp, items in self.layouts.items():
            placed = [item.i for item in items]
            if len(set(placed)) != len(placed):
                raise ValueError(f"disposition {bp} : widget placé deux fois")
            unknown = set(placed) - known
            if unknown:
                raise ValueError(f"disposition {bp} : widgets inconnus {sorted(unknown)}")
        return self


class DashboardLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pages: list[Page] = Field(default_factory=list, max_length=MAX_PAGES)
    home_page_id: Identifier | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "DashboardLayout":
        ids = [p.id for p in self.pages]
        if len(set(ids)) != len(ids):
            raise ValueError("identifiants de pages en double")
        if self.home_page_id is not None and self.home_page_id not in ids:
            raise ValueError("la page d'accueil n'existe pas")
        if len(self.model_dump_json()) > MAX_DOCUMENT_BYTES:
            raise ValueError("disposition trop volumineuse")
        return self


class LayoutOut(BaseModel):
    revision: int
    layout: DashboardLayout | None
    updated_at: datetime | None


class LayoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: Annotated[int, Field(ge=0)]
    layout: DashboardLayout


router = APIRouter(prefix="/layout")


def read_layout(session: Session) -> LayoutOut:
    row = session.scalars(select(DashboardLayoutRow)).first()
    if row is None:
        return LayoutOut(revision=0, layout=None, updated_at=None)
    return LayoutOut(
        revision=row.revision,
        layout=DashboardLayout.model_validate(row.data),
        updated_at=row.updated_at,
    )


@router.get("", response_model=LayoutOut)
def get_layout(db: Annotated[Session, Depends(get_db)]) -> LayoutOut:
    return read_layout(db)


def _conflict(db: Session) -> HTTPException:
    db.rollback()
    return HTTPException(
        409,
        detail={
            "message": "La disposition a été modifiée depuis un autre appareil.",
            "current": read_layout(db).model_dump(mode="json"),
        },
    )


@router.put("", response_model=LayoutOut)
def put_layout(body: LayoutIn, db: Annotated[Session, Depends(get_db)]) -> LayoutOut:
    """Remplace toute la disposition si `base_revision` est la révision courante (sinon 409)."""
    data = body.layout.model_dump(mode="json")
    now = datetime.now(UTC).replace(tzinfo=None)
    new_revision = body.base_revision + 1
    if body.base_revision == 0:
        try:
            db.execute(
                insert(DashboardLayoutRow).values(
                    id=1, revision=new_revision, data=data, updated_at=now
                )
            )
            db.commit()
        except IntegrityError:
            raise _conflict(db) from None
    else:
        result = db.execute(
            update(DashboardLayoutRow)
            .where(DashboardLayoutRow.id == 1, DashboardLayoutRow.revision == body.base_revision)
            .values(revision=new_revision, data=data, updated_at=now)
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            raise _conflict(db)
        db.commit()
    return LayoutOut(revision=new_revision, layout=body.layout, updated_at=now)
