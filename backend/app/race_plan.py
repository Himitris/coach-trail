"""Plan du jour J d'une course : document structuré importé depuis Claude, validé strictement.

Contenu : objectif de temps, tranches de course (zone, FC, allure, glucides, gels, boisson, sodium),
ravitaillements, jours précédents (veille, avant-veille…), matin de course, matériel, après-course.
L'appli enregistre et affiche ce que l'athlète a décidé ; elle ne prescrit rien.
"""

import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _hhmm(value: str | None) -> str | None:
    if value is not None and not _HHMM.match(value):
        raise ValueError("heure attendue au format HH:MM")
    return value


class Objectif(_Strict):
    temps_cible_min: int | None = Field(default=None, ge=10, le=6000)
    allure_cible: ShortText | None = None  # ex. « 7:30/km »
    strategie: Text | None = None


class Repas(_Strict):
    heure: str | None = None
    description: Text
    glucides_g: int | None = Field(default=None, ge=0, le=1500)

    _check_heure = field_validator("heure")(_hhmm)


class JourAvant(_Strict):
    jour: int = Field(ge=-7, le=-1)  # -1 = veille, -2 = avant-veille…
    titre: ShortText | None = None
    activite: Text | None = None
    repas: list[Repas] = Field(default_factory=list, max_length=10)
    hydratation: Text | None = None
    sommeil: Text | None = None
    notes: list[Text] = Field(default_factory=list, max_length=20)


class Matin(_Strict):
    reveil: str | None = None
    depart: str | None = None
    repas: list[Repas] = Field(default_factory=list, max_length=10)
    echauffement: Text | None = None
    hydratation: Text | None = None
    notes: list[Text] = Field(default_factory=list, max_length=20)

    _check_heures = field_validator("reveil", "depart")(_hhmm)


class Tranche(_Strict):
    """Un segment de course, par temps écoulé (en général une heure)."""

    debut_min: int = Field(ge=0, le=6000)
    fin_min: int = Field(ge=1, le=6000)
    km_debut: float | None = Field(default=None, ge=0, le=1000)
    km_fin: float | None = Field(default=None, ge=0, le=1000)
    zone: ShortText | None = None  # ex. « Z2 », « Z2-Z3 »
    fc_min: int | None = Field(default=None, ge=30, le=230)
    fc_max: int | None = Field(default=None, ge=30, le=230)
    allure: ShortText | None = None
    glucides_g: int | None = Field(default=None, ge=0, le=500)
    gels: float | None = Field(default=None, ge=0, le=20)
    boisson_ml: int | None = Field(default=None, ge=0, le=3000)
    sodium_mg: int | None = Field(default=None, ge=0, le=5000)
    aliment: Text | None = None
    note: Text | None = None

    @model_validator(mode="after")
    def _coherent(self) -> "Tranche":
        if self.fin_min <= self.debut_min:
            raise ValueError("fin_min doit être supérieur à debut_min")
        if self.fc_min is not None and self.fc_max is not None and self.fc_min > self.fc_max:
            raise ValueError("fc_min ne peut pas dépasser fc_max")
        if self.km_debut is not None and self.km_fin is not None and self.km_fin < self.km_debut:
            raise ValueError("km_fin ne peut pas être inférieur à km_debut")
        return self


class Ravitaillement(_Strict):
    km: float = Field(ge=0, le=1000)
    nom: ShortText | None = None
    temps_estime_min: int | None = Field(default=None, ge=0, le=6000)
    action: Text | None = None


class ApresCourse(_Strict):
    repas: list[Repas] = Field(default_factory=list, max_length=10)
    notes: list[Text] = Field(default_factory=list, max_length=20)


class RacePlanDoc(_Strict):
    version: Literal[1] = 1
    course: ShortText | None = None  # nom de la course visée (informatif)
    objectif: Objectif | None = None
    jours_avant: list[JourAvant] = Field(default_factory=list, max_length=7)
    matin: Matin | None = None
    tranches: list[Tranche] = Field(default_factory=list, max_length=40)
    ravitaillements: list[Ravitaillement] = Field(default_factory=list, max_length=40)
    materiel: list[Text] = Field(default_factory=list, max_length=60)
    apres_course: ApresCourse | None = None
    notes: list[Text] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def _non_vide(self) -> "RacePlanDoc":
        if not (
            self.objectif
            or self.jours_avant
            or self.matin
            or self.tranches
            or self.ravitaillements
            or self.materiel
            or self.apres_course
            or self.notes
        ):
            raise ValueError("le plan de course est vide")
        days = [j.jour for j in self.jours_avant]
        if len(days) != len(set(days)):
            raise ValueError("jours_avant : un même jour apparaît deux fois")
        return self


def warnings_for(doc: RacePlanDoc) -> list[str]:
    """Remarques non bloquantes (trous ou chevauchements entre tranches)."""
    out: list[str] = []
    ordered = sorted(doc.tranches, key=lambda t: t.debut_min)
    for a, b in zip(ordered, ordered[1:], strict=False):
        if b.debut_min < a.fin_min:
            span = f"{a.debut_min}–{a.fin_min} min et {b.debut_min}–{b.fin_min} min"
            out.append(f"Les tranches {span} se chevauchent.")
        elif b.debut_min > a.fin_min:
            out.append(f"Aucune tranche entre {a.fin_min} et {b.debut_min} min.")
    return out
