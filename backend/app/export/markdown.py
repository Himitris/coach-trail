"""Rendu Markdown (français) de l'export. Valeur absente = « — », jamais une valeur inventée."""

from collections.abc import Iterable, Sequence
from datetime import date

from app.export.builder import (
    ExportActivity,
    ExportData,
    FitnessSummary,
    PlanItem,
    ProfileSection,
    RecoverySection,
    VolumeSection,
)
from app.export.glossary import GLOSSARY
from app.metrics.intensity import IntensityReport
from app.metrics.models import Direction
from app.metrics.recovery import BaselineComparison, ProprietaryMetric
from app.metrics.volume import VolumeTotals
from app.plan.schemas import EntryOut

DASH = "—"
ZONE_NAMES = ("Sous Z1", "Z1", "Z2", "Z3", "Z4", "Z5")
DIRECTIONS: dict[Direction, str] = {
    "hausse": "en hausse",
    "baisse": "en baisse",
    "stable": "stable",
    "indetermine": "indéterminée",
}
SPORTS = {
    "trail_running": "Trail",
    "ultra_run": "Ultra",
    "running": "Course à pied",
    "treadmill_running": "Tapis",
    "track_running": "Piste",
    "virtual_run": "Course virtuelle",
    "hiking": "Randonnée",
    "walking": "Marche",
    "cycling": "Vélo",
    "strength_training": "Renforcement",
}
MONTHS = (
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
)


def num(value: float | None, digits: int = 0) -> str:
    if value is None:
        return DASH
    return f"{value:.{digits}f}".replace(".", ",").replace("-", "−")


def signed(value: float | None, digits: int = 0, unit: str = "") -> str:
    if value is None:
        return DASH
    text = num(abs(value), digits)
    sign = "+" if value > 0 else ("−" if value < 0 and text.strip("0,") else "")
    return f"{sign}{text}{unit}"


def day(d: date | None) -> str:
    return DASH if d is None else f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def short_day(d: date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]}"


def duration(minutes: float | None) -> str:
    if minutes is None:
        return DASH
    total = round(minutes)
    hours, mins = divmod(total, 60)
    return f"{hours} h {mins:02d}" if hours else f"{mins} min"


def duration_s(seconds: float | None) -> str:
    return DASH if seconds is None else duration(seconds / 60)


def km(value: float | None) -> str:
    return DASH if value is None else f"{num(value, 1)} km"


def meters(value: float | None) -> str:
    return DASH if value is None else f"{num(value)} m"


def pace(seconds_per_km: float | None) -> str:
    if seconds_per_km is None:
        return DASH
    m, s = divmod(round(seconds_per_km), 60)
    return f"{m}:{s:02d}/km"


def cell(value: object) -> str:
    return DASH if value is None or value == "" else str(value).replace("|", "/").replace("\n", " ")


def table(header: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    lines = [f"| {' | '.join(header)} |", f"| {' | '.join('---' for _ in header)} |"]
    lines += [f"| {' | '.join(cell(c) for c in r)} |" for r in rows]
    return "\n".join(lines)


def sport_label(sport: str) -> str:
    return SPORTS.get(sport, sport.replace("_", " ").capitalize())


# --- sections -------------------------------------------------------------------------------


def render_profile(p: ProfileSection) -> str:
    zones = ", ".join(f"Z{i} ≥ {f} bpm" for i, f in enumerate(p.zone_floors_bpm, start=1))
    lines = [
        "## Profil athlète",
        "",
        f"- FC max : {p.fc_max} bpm",
        f"- FC de repos (profil) : {num(p.fc_repos)} bpm",
        f"- Seuil lactique : {num(p.seuil_lactique_fc)} bpm",
        f"- Zones de FC : {zones}",
        f"- Profil mis à jour le {day(p.updated_on)}",
    ]
    if p.goals:
        lines += ["", "**Objectifs à venir**", ""]
        lines.append(
            table(
                ["Objectif", "Date", "Dans", "Distance", "D+", "Priorité"],
                [
                    [
                        g.nom,
                        day(g.date),
                        f"{g.days_left} j",
                        km(g.distance_km),
                        meters(g.dplus_m),
                        g.priorite,
                    ]
                    for g in p.goals
                ],
            )
        )
    else:
        lines += ["", "Aucun objectif à venir enregistré."]
    return "\n".join(lines) + "\n"


def _totals_row(label: str, t: VolumeTotals) -> list[object]:
    return [
        label,
        duration_s(t.time_s),
        km(t.distance_m / 1000),
        meters(t.gain_m),
        meters(t.loss_m),
        num(t.sessions),
    ]


def render_volume(v: VolumeSection) -> str:
    rows = [
        _totals_row(
            f"Sem. du {short_day(w.week_start)}{'' if w.complete else ' (en cours)'}", w.totals
        )
        for w in v.weeks
    ]
    rows.append(_totals_row("**Total**", v.total))
    return (
        "\n".join(
            [
                "### Volume",
                "",
                table(["Semaine", "Temps", "Distance", "D+", "D−", "Séances"], rows),
                "",
                f"_{v.evidence.summary}_",
            ]
        )
        + "\n"
    )


def render_intensity(r: IntensityReport) -> str:
    rows = []
    for w in r.weeks:
        hr = w.hr_time_s

        def share(s: float, hr: float = hr) -> str:
            return f"{num(s / hr * 100)} %" if hr > 0 else DASH

        z = w.zone_seconds
        rows.append(
            [
                short_day(w.week_start),
                share(z[0] + z[1] + z[2]),
                share(z[3]),
                share(z[4]),
                share(z[5]),
                w.activities_counted,
                f"{w.races_excluded} course(s) exclue(s)" if w.races_excluded else "",
            ]
        )
    avg = f"{num(r.average_low_share_pct)} %" if r.average_low_share_pct is not None else DASH
    return (
        "\n".join(
            [
                "### Intensités (réalisé vs cible)",
                "",
                table(
                    ["Semaine du", "Bas d'intensité (Z1–Z2)", "Z3", "Z4", "Z5", "Séances", "Note"],
                    rows,
                ),
                "",
                f"Cible : {num(r.target_min_pct)}–{num(r.target_max_pct)} % du temps en bas "
                "d'intensité. "
                f"Moyenne sur la période : {avg}. Tendance : {DIRECTIONS[r.trend.direction]}.",
                f"_{r.evidence.summary}_",
            ]
        )
        + "\n"
    )


def render_fitness(f: FitnessSummary) -> str:
    lines = [
        "### Forme (CTL / ATL / TSB)",
        "",
        f"Au {day(f.date)} : CTL {num(f.ctl, 1)} · ATL {num(f.atl, 1)} · TSB {signed(f.tsb, 1)}. "
        f"Rampe de CTL sur 4 semaines : {signed(f.ctl_ramp_4w, 1)} "
        f"({DIRECTIONS[f.trend.direction]}).",
        f"_{f.evidence.summary}_",
    ]
    lines += [f"- {w}" for w in f.warnings]
    return "\n".join(lines) + "\n"


def _zone_cells(a: ExportActivity) -> list[object]:
    if a.zone_seconds is None or not a.hr_time_s:
        return [DASH, DASH]
    z = a.zone_seconds
    top = max(range(6), key=lambda i: z[i])
    return [f"{num(a.low_share_pct)} %" if a.low_share_pct is not None else DASH, ZONE_NAMES[top]]


def render_activities(acts: Sequence[ExportActivity], truncated: int = 0) -> str:
    if not acts:
        return "### Séances\n\nAucune séance sur la période.\n"
    rows = [
        [
            f"{a.id}",
            short_day(a.day),
            f"{sport_label(a.sport)}{' (course)' if a.is_race else ''}",
            duration(a.duration_min),
            km(a.distance_km),
            meters(a.dplus_m),
            meters(a.dminus_m),
            num(a.hr_avg),
            num(a.hr_max),
            *_zone_cells(a),
            a.rpe,
            a.source,
        ]
        for a in acts
    ]
    header = ["Id", "Date", "Sortie", "Durée", "Dist.", "D+", "D−", "FC moy.", "FC max",
              "Bas d'int.", "Zone dominante", "RPE", "Source"]  # fmt: skip
    notes = [
        "Bas d'int. = part du temps en Z1–Z2 (hors courses : FC de compétition non comparée "
        "aux séances)."
    ]
    if truncated:
        notes.append(f"{truncated} séance(s) plus anciennes non listées.")
    return (
        "\n".join(["### Séances", "", table(header, rows), "", *[f"_{n}_" for n in notes]]) + "\n"
    )


def render_plan(plan: Sequence[PlanItem]) -> str:
    if not plan:
        return "## Plan prévu vs réalisé\n\nAucune séance prévue sur la période.\n"
    rows = [
        [
            short_day(p.date),
            p.titre,
            p.type_label,
            duration(p.duree_min),
            f"Z{p.zone_cible}" if p.zone_cible else None,
            meters(p.dplus_cible),
            duration(p.done_min) if p.done_min is not None else DASH,
            meters(p.done_dplus_m),
            p.status,
        ]
        for p in plan
    ]
    return (
        "\n".join(
            [
                "## Plan prévu vs réalisé",
                "",
                table(
                    [
                        "Jour",
                        "Séance",
                        "Type",
                        "Durée prévue",
                        "Zone",
                        "D+ prévu",
                        "Durée faite",
                        "D+ fait",
                        "Statut",
                    ],
                    rows,
                ),
            ]
        )
        + "\n"
    )


def _baseline_row(label: str, c: BaselineComparison, unit: str, digits: int = 0) -> list[object]:
    def val(v: float | None) -> str:
        return DASH if v is None else f"{num(v, digits)} {unit}"

    return [
        label,
        val(c.recent_mean),
        val(c.baseline_mean),
        signed(c.delta_pct, 1, " %"),
        signed(c.delta_sd, 1, " écart-type"),
        DIRECTIONS[c.trend.direction] if c.sufficient else "indéterminée (données insuffisantes)",
    ]


def _proprietary(label: str, m: ProprietaryMetric) -> str:
    when = f", {day(m.date)}" if m.date else ""
    return f"- {label} : {num(m.value)} ({m.label}{when})"


def entry_line(e: EntryOut) -> str:
    bits = []
    for s in e.sessions:
        bits.append(f"RPE {s.rpe}/10" + (f" ({sport_label(s.sport)})" if s.sport else ""))
    if e.courbatures is not None:
        bits.append(f"courbatures {e.courbatures}/10")
    if e.malade is not None:
        bits.append("malade" if e.malade else "pas malade")
    if e.note:
        bits.append(f"note : « {e.note.replace(chr(10), ' ')} »")
    return f"- {short_day(e.date)} : {' · '.join(bits)}"


def render_recovery(r: RecoverySection) -> str:
    lines = [
        "## Récupération",
        "",
        f"Au {day(r.as_of)}. Moyenne 7 j comparée à la base individuelle de "
        f"{r.baseline_days} j, en tendance.",
        "",
        table(
            ["", "Moyenne 7 j", f"Base {r.baseline_days} j", "Écart", "Écart (σ)", "Tendance"],
            [
                _baseline_row("HRV nocturne", r.hrv, "ms"),
                _baseline_row("FC de repos", r.resting_hr, "bpm"),
                _baseline_row("Sommeil (durée)", r.sleep_duration_h, "h", 1),
                _baseline_row("Sommeil (efficacité estimée)", r.sleep_efficiency_pct, "%"),
            ],
        ),
        "",
        "**Avis de la montre (propriétaires, non validés)**",
        "",
        _proprietary("Training Readiness", r.training_readiness),
        _proprietary("Body Battery max", r.body_battery_max),
        _proprietary("Body Battery min", r.body_battery_min),
    ]
    if r.garmin_hrv_reference:
        d, lo, hi = r.garmin_hrv_reference
        lines.append(
            f"- Plage HRV de référence Garmin : {num(lo)}–{num(hi)} ms "
            f"({day(d)}, avis de la montre)"
        )
    if r.acwr:
        lines.append(
            f"- ACWR Garmin : {num(r.acwr.value, 2)} ({r.acwr.label}, {day(r.acwr.date)} ; "
            "aucune alerte n'en est tirée)"
        )
    lines += ["", "**Maladie**", ""]
    lines.append(
        "Jours déclarés malade : " + ", ".join(short_day(d) for d in r.sick_days)
        if r.sick_days
        else "Aucun jour déclaré malade sur la période."
    )
    lines += ["", "**Saisies du soir**", ""]
    lines += [entry_line(e) for e in r.entries] or ["Aucune saisie sur la période."]
    return "\n".join(lines) + "\n"


def render_glossary() -> str:
    lines = ["## Glossaire des métriques et niveau de preuve", ""]
    lines += [f"- **{g.name}** — preuve : {g.evidence}. {g.text}" for g in GLOSSARY]
    return "\n".join(lines) + "\n"


def render_limits(data: ExportData, streams_ref: str | None) -> str:
    lines = ["## Limites et sources", ""]
    if data.sources:
        lines.append(
            "Sources : "
            + " ; ".join(
                f"{s.source} ({s.activities} séance(s), état : {s.state})" for s in data.sources
            )
            + "."
        )
    else:
        lines.append("Aucune source enregistrée.")
    lines += [f"- {limit}" for limit in data.limits]
    if streams_ref:
        lines += [
            "",
            f"Flux de séance sous-échantillonnés (1 point toutes les 45 s) : fichier JSON séparé, "
            f"`{streams_ref}`.",
        ]
    return "\n".join(lines) + "\n"


def render_markdown(data: ExportData, streams_ref: str | None = None) -> str:
    parts = [
        f"# Coach Trail — export du {day(data.generated_on)}",
        "",
        f"Période : {day(data.start)} → {day(data.end)} ({data.days} jours). "
        "Données lues dans la base locale ; une donnée absente est notée « — ».",
        "",
    ]
    if data.profile:
        parts += [render_profile(data.profile)]
    if "activities" in data.sections:
        parts += ["## Période", ""]
        for block in (
            render_volume(data.volume) if data.volume else "",
            render_intensity(data.intensity) if data.intensity else "",
            render_fitness(data.fitness) if data.fitness else "",
            render_activities(data.activities, data.activities_truncated),
        ):
            if block:
                parts += [block]
    if "plan" in data.sections:
        parts += [render_plan(data.plan)]
    if data.recovery:
        parts += [render_recovery(data.recovery)]
    if "glossary" in data.sections:
        parts += [render_glossary()]
    parts += [render_limits(data, streams_ref if "activities" in data.sections else None)]
    return "\n".join(parts).rstrip() + "\n"
