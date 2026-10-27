"""Type de séance déduit de la FC (hypothèse) et comparaison avec la séance prévue.

Repères scientifiques (population de coureurs d'endurance, n = 1 411) : le 1er seuil ventilatoire
(VT1) se situe vers 85 ± 5 % de la FC pic, le 2e (VT2) vers 93,5 ± 2,5 % (PMC12845794). Entre les
deux : travail « au seuil » ; au-dessus de VT2 : intensité haute. Le modèle à 3 zones de Seiler
repose sur ces deux seuils. Ces pourcentages varient d'un coureur à l'autre (et avec le niveau),
donc le résultat est une **hypothèse** (niveau « indicatif »), toujours corrigeable à la main.

Règles (séance de course à pied, hors course) sur la FC lissée sur 30 s :

- bloc d'effort = FC ≥ VT1 (85 % de la FC max), les trous < 60 s sont recollés, un bloc compte
  à partir de 3 min ;
- plusieurs blocs courts (≤ 10 min) séparés par de la récupération → fractionné (côtes si le D+
  horaire est élevé) ;
- un bloc continu ≥ 12 min (ou ≥ 15 min d'effort cumulé) → seuil ;
- sortie ≥ 90 min avec peu d'effort → sortie longue ;
- sinon → footing.

Sans flux FC, seule la FC moyenne donne une indication, avec une confiance faible.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from app.metrics.models import Evidence

Confidence = Literal["faible", "moyenne", "bonne"]
Conformity = Literal["atteint", "partiel", "ecart"]

VT1_PCT = 85.0
VT2_PCT = 93.5
SMOOTH_S = 30
MERGE_GAP_S = 60
MIN_BLOCK_S = 180
SHORT_BLOCK_MAX_S = 600
THRESHOLD_BLOCK_MIN = 12.0
THRESHOLD_TOTAL_MIN = 15.0
LONG_RUN_MIN = 90.0
LONG_RUN_MAX_HARD_SHARE = 0.35
HILL_GAIN_PER_H = 500.0
MAX_GAP_S = 15.0

LABELS: dict[str, str] = {
    "footing": "Footing",
    "cotes": "Côtes",
    "seuil": "Seuil",
    "longue": "Sortie longue",
    "fractionne": "Fractionné",
    "course": "Course",
}

EVIDENCE = Evidence(
    level="indicatif",
    summary=(
        "Type déduit de la FC : seuils à 85 % (VT1) et 93,5 % (VT2) de la FC max, moyennes d'une "
        "cohorte de coureurs (PMC12845794) ; variables d'un individu à l'autre. Hypothèse à "
        "corriger si besoin, pas un verdict."
    ),
)


class DetectedWorkout(BaseModel):
    type: str
    label: str
    confidence: Confidence
    source: Literal["calcul", "manuel"]
    reasons: list[str]
    hard_min: float | None = None  # effort cumulé ≥ VT1
    longest_block_min: float | None = None
    blocks: int | None = None
    evidence: Evidence = EVIDENCE


@dataclass(frozen=True)
class Block:
    start_s: float
    end_s: float

    @property
    def seconds(self) -> float:
        return self.end_s - self.start_s


@dataclass(frozen=True)
class WorkoutInput:
    duration_s: float
    is_race: bool = False
    hr_avg: int | None = None
    gain_m: float | None = None
    t: Sequence[float | None] = field(default_factory=list)
    hr: Sequence[float | None] = field(default_factory=list)


def _resample(t: Sequence[float | None], hr: Sequence[float | None]) -> list[float | None]:
    """FC à 1 Hz (maintenue entre deux échantillons rapprochés, absente dans les pauses)."""
    points = [
        (float(ti), float(h))
        for ti, h in zip(t, hr, strict=False)
        if ti is not None and h is not None and h > 0
    ]
    if len(points) < 2:
        return []
    start = int(points[0][0])
    out: list[float | None] = [None] * (int(points[-1][0]) - start + 1)
    for (t0, h0), (t1, _) in zip(points, points[1:], strict=False):
        if t1 - t0 > MAX_GAP_S:
            out[int(t0) - start] = h0
            continue
        for s in range(int(t0), int(t1)):
            out[s - start] = h0
    out[-1] = points[-1][1]
    return out


def _smooth(series: Sequence[float | None], window: int = SMOOTH_S) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(series)):
        chunk = [v for v in series[max(0, i - window + 1) : i + 1] if v is not None]
        out.append(sum(chunk) / len(chunk) if len(chunk) >= window // 3 else None)
    return out


def effort_blocks(smoothed: Sequence[float | None], floor_bpm: float) -> list[Block]:
    """Blocs où la FC lissée reste ≥ `floor_bpm` ; trous < 60 s recollés ; blocs < 3 min ignorés."""
    raw: list[Block] = []
    start: int | None = None
    for i, v in enumerate(smoothed):
        hard = v is not None and v >= floor_bpm
        if hard and start is None:
            start = i
        elif not hard and start is not None:
            raw.append(Block(start, i))
            start = None
    if start is not None:
        raw.append(Block(start, len(smoothed)))
    merged: list[Block] = []
    for b in raw:
        if merged and b.start_s - merged[-1].end_s < MERGE_GAP_S:
            merged[-1] = Block(merged[-1].start_s, b.end_s)
        else:
            merged.append(b)
    return [b for b in merged if b.seconds >= MIN_BLOCK_S]


def classify_workout(w: WorkoutInput, fc_max: int) -> DetectedWorkout | None:
    """Type probable de la séance, ou None si les données ne permettent rien de sérieux."""
    minutes = w.duration_s / 60
    if w.is_race:
        return DetectedWorkout(
            type="course",
            label=LABELS["course"],
            confidence="bonne",
            source="calcul",
            reasons=["Activité marquée comme course."],
        )
    vt1 = fc_max * VT1_PCT / 100
    smoothed = _smooth(_resample(w.t, w.hr))
    valid = sum(1 for v in smoothed if v is not None)
    if valid >= 300:
        return _from_stream(w, smoothed, vt1, minutes)
    return _from_average(w, fc_max, minutes)


def _from_stream(
    w: WorkoutInput, smoothed: Sequence[float | None], vt1: float, minutes: float
) -> DetectedWorkout:
    blocks = effort_blocks(smoothed, vt1)
    hard_s = sum(b.seconds for b in blocks)
    longest_s = max((b.seconds for b in blocks), default=0.0)
    hard_min, longest_min = hard_s / 60, longest_s / 60
    hard_share = hard_s / max(w.duration_s, 1.0)
    gain_per_h = (w.gain_m / (minutes / 60)) if w.gain_m is not None and minutes > 0 else None
    common = {
        "source": "calcul",
        "hard_min": round(hard_min, 1),
        "longest_block_min": round(longest_min, 1),
        "blocks": len(blocks),
    }

    short = [b for b in blocks if b.seconds <= SHORT_BLOCK_MAX_S]
    if len(blocks) >= 3 and len(short) == len(blocks) and hard_min >= 8:
        hilly = gain_per_h is not None and gain_per_h >= HILL_GAIN_PER_H
        kind = "cotes" if hilly else "fractionne"
        why = (
            f"{len(blocks)} efforts de 3 à 10 min à ≥ {VT1_PCT:.0f} % de la FC max, séparés "
            f"par de la récupération ({hard_min:.0f} min d'effort cumulé)."
        )
        if hilly and gain_per_h is not None:
            why += f" D+ élevé ({gain_per_h:.0f} m/h)."
        return DetectedWorkout(
            type=kind, label=LABELS[kind], confidence="bonne", reasons=[why], **common
        )

    if longest_min >= THRESHOLD_BLOCK_MIN or hard_min >= THRESHOLD_TOTAL_MIN:
        if minutes >= LONG_RUN_MIN and hard_share < LONG_RUN_MAX_HARD_SHARE:
            return DetectedWorkout(
                type="longue",
                label=LABELS["longue"],
                confidence="moyenne",
                reasons=[
                    f"Sortie de {minutes:.0f} min, effort ≥ seuil sur "
                    f"{hard_share * 100:.0f} % du temps seulement."
                ],
                **common,
            )
        why = (
            f"Effort continu de {longest_min:.0f} min à ≥ {VT1_PCT:.0f} % de la FC max "
            f"({hard_min:.0f} min cumulées)."
        )
        return DetectedWorkout(
            type="seuil",
            label=LABELS["seuil"],
            confidence="bonne" if longest_min >= THRESHOLD_BLOCK_MIN else "moyenne",
            reasons=[why],
            **common,
        )

    if minutes >= LONG_RUN_MIN:
        return DetectedWorkout(
            type="longue",
            label=LABELS["longue"],
            confidence="bonne",
            reasons=[
                f"Sortie de {minutes:.0f} min sous le seuil (FC < {VT1_PCT:.0f} % de la FC max)."
            ],
            **common,
        )
    return DetectedWorkout(
        type="footing",
        label=LABELS["footing"],
        confidence="bonne",
        reasons=[
            f"FC sous {VT1_PCT:.0f} % de la FC max presque tout le long "
            f"({hard_min:.0f} min au-dessus)."
        ],
        **common,
    )


def _from_average(w: WorkoutInput, fc_max: int, minutes: float) -> DetectedWorkout | None:
    if not w.hr_avg:
        return None
    pct = w.hr_avg / fc_max * 100
    reason = f"Pas de flux FC : estimation d'après la FC moyenne ({pct:.0f} % de la FC max)."
    if pct >= VT1_PCT:
        return DetectedWorkout(
            type="seuil",
            label=LABELS["seuil"],
            confidence="faible",
            source="calcul",
            reasons=[reason],
        )
    kind = "longue" if minutes >= LONG_RUN_MIN else "footing"
    return DetectedWorkout(
        type=kind, label=LABELS[kind], confidence="faible", source="calcul", reasons=[reason]
    )


def manual_workout(type_: str) -> DetectedWorkout:
    return DetectedWorkout(
        type=type_,
        label=LABELS.get(type_, type_),
        confidence="bonne",
        source="manuel",
        reasons=["Type choisi à la main."],
    )


# --- prévu / réalisé ------------------------------------------------------------------------

EASY = frozenset({"footing", "longue"})
HARD = frozenset({"seuil", "fractionne", "cotes"})
DURATION_OK = 0.8


def conformity(
    planned_type: str,
    planned_min: int | None,
    detected: DetectedWorkout,
    done_min: float,
) -> tuple[Conformity, str] | None:
    """Les séances « course », « renfo », « repos » et « autre » ne sont pas comparées."""
    if planned_type not in EASY | HARD:
        return None
    got = detected.type
    if got == "course":
        return None
    if (
        planned_type == "longue"
        and got in EASY
        and planned_min
        and done_min < planned_min * DURATION_OK
    ):
        return "partiel", f"Sortie longue écourtée ({done_min:.0f} min pour {planned_min} prévues)."
    if planned_type == got:
        if planned_type == "seuil" and detected.hard_min is not None:
            target = (planned_min or 0) * 0.5
            if target and detected.hard_min < target:
                return (
                    "partiel",
                    f"Seuil trop court : {detected.hard_min:.0f} min d'effort, "
                    f"{target:.0f} min attendues au moins.",
                )
        return "atteint", f"Séance de type « {detected.label} » comme prévu."
    if planned_type in EASY and got in EASY:
        return "atteint", f"Séance facile comme prévu ({detected.label.lower()})."
    if planned_type in EASY and got in HARD:
        return "ecart", f"Prévu facile, mais effort soutenu détecté ({detected.label.lower()})."
    if planned_type in HARD and got in EASY:
        return (
            "ecart",
            f"Prévu « {LABELS[planned_type].lower()} », mais la FC est restée sous le seuil : "
            "séance facile.",
        )
    return (
        "partiel",
        f"Prévu « {LABELS[planned_type].lower()} », détecté « {detected.label.lower()} ».",
    )
