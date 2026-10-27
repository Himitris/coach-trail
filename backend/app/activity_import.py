"""Import manuel d'une séance FIT ou GPX : lecture, résumé et flux, prêts à normaliser.

Sécurité : le fichier vient de l'extérieur. Taille bornée, GPX refusant les déclarations XML
dangereuses (voir `app.gpx`), FIT lu par `fitdecode` (erreurs converties en messages lisibles).
Rien n'est inventé : une donnée absente du fichier reste vide.
"""

import hashlib
import io
import math
import struct
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import fitdecode

from app.gpx import (
    GpxError,
    TrackPoint,
    cumulative_distance_m,
    elevation_gain_loss,
    parse_gpx,
)

MAX_BYTES = 20_000_000
MAX_SAMPLES = 20_000
PAUSE_GAP_S = 30.0  # un trou plus long entre deux points est une pause, pas du temps de course
SEMICIRCLE = 180.0 / 2**31
FIT_EPOCH_OFFSET = 631_065_600  # 1989-12-31 -> 1970-01-01 (secondes)

FIT_SPORTS = {
    "running": "running", "walking": "walking", "hiking": "hiking", "cycling": "cycling",
    "swimming": "lap_swimming", "training": "strength_training",
    "fitness_equipment": "fitness_equipment", "e_biking": "cycling", "mountaineering": "hiking",
}  # fmt: skip
FIT_SUB_SPORTS = {
    "trail": "trail_running", "treadmill": "treadmill_running", "track": "track_running",
    "virtual_activity": "virtual_run", "mountain": "mountain_biking",
    "gravel_cycling": "gravel_cycling", "strength_training": "strength_training",
}  # fmt: skip
GPX_SPORTS = {
    "running": "running", "run": "running", "trail running": "trail_running",
    "trail_running": "trail_running", "trailrun": "trail_running", "hiking": "hiking",
    "walking": "walking", "cycling": "cycling", "biking": "cycling", "9": "running",
}  # fmt: skip


class ImportFailure(ValueError):
    """Fichier inutilisable (message en français)."""


@dataclass
class ParsedActivity:
    format: str  # fit | gpx
    sport: str
    start_utc: datetime
    duration_s: float
    distance_m: float | None
    gain_m: float | None
    loss_m: float | None
    hr_avg: int | None
    hr_max: int | None
    calories: int | None
    name: str | None
    samples: dict[str, list[float | None]]
    warnings: list[str] = field(default_factory=list)


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def detect_format(filename: str | None, data: bytes) -> str:
    if len(data) >= 12 and data[8:12] == b".FIT":
        return "fit"
    name = (filename or "").lower()
    if name.endswith(".fit"):
        return "fit"
    if name.endswith(".gpx") or data.lstrip()[:1] == b"<":
        return "gpx"
    raise ImportFailure("Format non reconnu : fournir un fichier .fit ou .gpx.")


def _decimate(samples: dict[str, list[float | None]]) -> dict[str, list[float | None]]:
    n = len(samples.get("t", []))
    if n <= MAX_SAMPLES:
        return samples
    step = math.ceil(n / MAX_SAMPLES)
    return {k: v[::step] for k, v in samples.items()}


def _summary_hr(values: list[float | None]) -> tuple[int | None, int | None]:
    present = [v for v in values if v is not None and v > 0]
    if not present:
        return None, None
    return round(sum(present) / len(present)), round(max(present))


def _timer_seconds(times: list[float]) -> float:
    """Temps de course : somme des intervalles sans les pauses (trous de plus de 30 s)."""
    return sum(b - a for a, b in zip(times, times[1:], strict=False) if 0 < b - a <= PAUSE_GAP_S)


# --- GPX ------------------------------------------------------------------------------------------


def parse_gpx_activity(data: bytes, sport_hint: str | None = None) -> ParsedActivity:
    try:
        points = parse_gpx(data)
    except GpxError as exc:
        raise ImportFailure(str(exc)) from exc
    timed = [p for p in points if p.time is not None]
    if len(timed) < 2:
        raise ImportFailure("La trace GPX n'a pas d'horodatage : séance impossible à dater.")
    start = min(p.time for p in timed if p.time is not None)
    ordered = sorted(timed, key=lambda p: p.time or start)
    t0 = ordered[0].time or start
    t = [(p.time - t0).total_seconds() for p in ordered if p.time is not None]
    dist = cumulative_distance_m(ordered)
    eles = [p.ele for p in ordered]
    speed: list[float | None] = [None]
    for i in range(1, len(ordered)):
        dt = t[i] - t[i - 1]
        speed.append((dist[i] - dist[i - 1]) / dt if 0 < dt <= PAUSE_GAP_S else None)
    samples: dict[str, list[float | None]] = {
        "t": [float(x) for x in t],
        "distance": list(dist),
        "speed": speed,
    }
    warnings: list[str] = []
    if any(e is not None for e in eles):
        samples["altitude"] = [None if e is None else float(e) for e in eles]
    else:
        warnings.append("Pas d'altitude dans la trace : D+ et D− indisponibles.")
    hrs = [p.hr for p in ordered]
    if any(h is not None for h in hrs):
        samples["fc"] = hrs
    if any(p.cad is not None for p in ordered):
        samples["cadence"] = [p.cad for p in ordered]
    gain = loss = None
    alts = [float(e) for e in eles if e is not None]
    if len(alts) >= 2:
        gain, loss = elevation_gain_loss(alts)
    hr_avg, hr_max = _summary_hr(hrs)
    sport = sport_hint or _gpx_sport(data) or "unknown"
    if sport == "unknown":
        warnings.append("Sport non précisé dans le fichier : à corriger si besoin.")
    return ParsedActivity(
        format="gpx",
        sport=sport,
        start_utc=t0.astimezone(UTC).replace(tzinfo=None),
        duration_s=_timer_seconds(t) or t[-1],
        distance_m=dist[-1],
        gain_m=gain,
        loss_m=loss,
        hr_avg=hr_avg,
        hr_max=hr_max,
        calories=None,
        name=_gpx_name(data),
        samples=_decimate(samples),
        warnings=warnings,
    )


def _first_text(data: bytes, tag: str) -> str | None:
    import xml.etree.ElementTree as ET  # noqa: S405  (déjà validé par parse_gpx)

    try:
        root = ET.fromstring(data)  # noqa: S314
    except ET.ParseError:
        return None
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] == tag and el.text and el.text.strip():
            return el.text.strip()
    return None


def _gpx_sport(data: bytes) -> str | None:
    kind = _first_text(data, "type")
    return GPX_SPORTS.get(kind.lower()) if kind else None


def _gpx_name(data: bytes) -> str | None:
    name = _first_text(data, "name")
    return name[:120] if name else None


# --- FIT ------------------------------------------------------------------------------------------


def _ts(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def parse_fit_activity(data: bytes, sport_hint: str | None = None) -> ParsedActivity:
    records: list[dict[str, Any]] = []
    session: dict[str, Any] = {}
    try:
        with fitdecode.FitReader(io.BytesIO(data)) as fit:
            for frame in fit:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue
                fields = {f.name: f.value for f in frame.fields}
                if frame.name == "record":
                    records.append(fields)
                elif frame.name == "session" and not session:
                    session = fields
    except fitdecode.FitError as exc:
        raise ImportFailure(f"Fichier FIT illisible ({type(exc).__name__}).") from None
    except (ValueError, OSError, struct.error) as exc:
        raise ImportFailure(f"Fichier FIT illisible ({type(exc).__name__}).") from None
    timed = [r for r in records if _ts(r.get("timestamp")) is not None]
    start = _ts(session.get("start_time")) or (_ts(timed[0]["timestamp"]) if timed else None)
    if start is None:
        raise ImportFailure("Le fichier FIT ne contient ni séance ni points horodatés.")
    t0 = _ts(timed[0]["timestamp"]) if timed else start
    assert t0 is not None  # noqa: S101
    t = [(_ts(r["timestamp"]) - t0).total_seconds() for r in timed]  # type: ignore[operator]

    def col(*names: str) -> list[float | None]:
        out: list[float | None] = []
        for r in timed:
            value = next((r[n] for n in names if isinstance(r.get(n), int | float)), None)
            out.append(None if value is None else float(value))
        return out

    samples: dict[str, list[float | None]] = {"t": [float(x) for x in t]}
    for key, names in (
        ("fc", ("heart_rate",)), ("altitude", ("enhanced_altitude", "altitude")),
        ("speed", ("enhanced_speed", "speed")), ("distance", ("distance",)),
    ):  # fmt: skip
        values = col(*names)
        if any(v is not None for v in values):
            samples[key] = values
    sport_name = str(session.get("sport") or "")
    sub_name = str(session.get("sub_sport") or "")
    sport = sport_hint or FIT_SUB_SPORTS.get(sub_name) or FIT_SPORTS.get(sport_name) or "unknown"
    cadence = col("cadence")
    if any(c is not None for c in cadence):
        factor = 2.0 if sport.endswith("running") or sport == "running" else 1.0  # pas par minute
        samples["cadence"] = [None if c is None else c * factor for c in cadence]
    warnings: list[str] = []
    if sport == "unknown":
        warnings.append("Sport non précisé dans le fichier : à corriger si besoin.")
    distance = session.get("total_distance")
    if not isinstance(distance, int | float) and "distance" in samples:
        present = [d for d in samples["distance"] if d is not None]
        distance = present[-1] if present else None
    duration = (
        session.get("total_timer_time") or session.get("total_elapsed_time") or _timer_seconds(t)
    )
    if not duration:
        raise ImportFailure("Durée de la séance introuvable dans le fichier FIT.")
    gain, loss = session.get("total_ascent"), session.get("total_descent")
    if gain is None and "altitude" in samples:
        alts = [a for a in samples["altitude"] if a is not None]
        if len(alts) >= 2:
            gain, loss = elevation_gain_loss(alts)
    hr_avg = session.get("avg_heart_rate")
    hr_max = session.get("max_heart_rate")
    if hr_avg is None and "fc" in samples:
        hr_avg, hr_max = _summary_hr(samples["fc"])
    return ParsedActivity(
        format="fit",
        sport=sport,
        start_utc=start.astimezone(UTC).replace(tzinfo=None),
        duration_s=float(duration),
        distance_m=float(distance) if isinstance(distance, int | float) else None,
        gain_m=float(gain) if isinstance(gain, int | float) else None,
        loss_m=float(loss) if isinstance(loss, int | float) else None,
        hr_avg=int(hr_avg) if isinstance(hr_avg, int | float) else None,
        hr_max=int(hr_max) if isinstance(hr_max, int | float) else None,
        calories=int(session["total_calories"])
        if isinstance(session.get("total_calories"), int | float)
        else None,
        name=None,
        samples=_decimate(samples) if len(samples["t"]) > 1 else {},
        warnings=warnings,
    )


def parse_activity(
    data: bytes, filename: str | None, sport_hint: str | None = None
) -> ParsedActivity:
    if not data:
        raise ImportFailure("Fichier vide.")
    if len(data) > MAX_BYTES:
        raise ImportFailure("Fichier trop volumineux (20 Mo maximum).")
    fmt = detect_format(filename, data)
    return (
        parse_fit_activity(data, sport_hint)
        if fmt == "fit"
        else parse_gpx_activity(data, sport_hint)
    )


__all__ = ["ImportFailure", "ParsedActivity", "TrackPoint", "file_hash", "parse_activity"]
