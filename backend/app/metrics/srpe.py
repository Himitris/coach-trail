"""sRPE : charge de séance = RPE (0–10) × durée (min).

Les saisies viennent de la table `evening_entry` (prompt 06). Ici, uniquement l'interface de
lecture (`EntryReader`) et le calcul ; sans lecteur branché, aucune charge n'est inventée.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from pydantic import BaseModel

from app.metrics.models import Evidence


@dataclass(frozen=True)
class SRPEEntry:
    day: date
    rpe: float  # 0–10
    duration_min: float
    activity_id: int | None = None


class EntryReader(Protocol):
    def read_srpe(self, start: date, end: date) -> list[SRPEEntry]: ...


class NullEntryReader:
    """Lecteur par défaut tant que les saisies du soir n'existent pas."""

    def read_srpe(self, start: date, end: date) -> list[SRPEEntry]:
        return []


def session_load(entry: SRPEEntry) -> float:
    return entry.rpe * entry.duration_min


class SRPESummary(BaseModel):
    total_load_au: float
    entries: int
    evidence: Evidence


def srpe_summary(entries: Sequence[SRPEEntry]) -> SRPESummary | None:
    if not entries:
        return None
    return SRPESummary(
        total_load_au=sum(session_load(e) for e in entries),
        entries=len(entries),
        evidence=Evidence(
            level="etabli",
            summary="Charge perçue (RPE × minutes) saisie par l'athlète, unités arbitraires.",
        ),
    )
