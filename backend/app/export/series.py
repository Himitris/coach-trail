"""Séries tabulaires de l'export (CSV et JSON de séries) : colonnes explicites, dates ISO.

CSV : séparateur « , », UTF-8, point décimal, dates AAAA-MM-JJ, cellule vide = donnée absente
(jamais un zéro inventé). Les cellules de texte qui commencent par `= + - @` sont préfixées d'une
apostrophe (injection de formules dans un tableur).
"""

import csv
import io
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app import gear
from app.export import builder
from app.metrics import phase2, service
from app.metrics.fueling import fueling_series
from app.metrics.intensity import zone_floors_from_profile
from app.models import Activity
from app.plan.entries import read_entries

SCHEMA_VERSION = 1
SeriesName = Literal[
    "activities",
    "wellness",
    "hrv",
    "load",
    "intensity",
    "monotony",
    "fatigue",
    "strength",
    "fueling",
    "plan",
    "entries",
    "gear",
]
SERIES_NAMES: tuple[SeriesName, ...] = (
    "activities",
    "wellness",
    "hrv",
    "load",
    "intensity",
    "monotony",
    "fatigue",
    "strength",
    "fueling",
    "plan",
    "entries",
    "gear",
)


class SeriesError(ValueError):
    pass


@dataclass(frozen=True)
class Table:
    name: str
    columns: list[str]
    rows: list[list[Any]]
    description: str


@dataclass(frozen=True)
class Ctx:
    session: Session
    priority: Sequence[str]
    tz: ZoneInfo
    today: date
    start: date
    end: date
    min_hours: float = 2.5

    @property
    def weeks(self) -> int:
        return min(52, max(2, math.ceil(((self.end - self.start).days + 1) / 7)))

    @property
    def reference_day(self) -> date:
        return min(self.end, self.today)


def _r(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def activities_table(ctx: Ctx, acts: Sequence[Activity] | None = None) -> Table:
    if acts is None:
        acts = [
            a
            for a in builder.reversed_activities(ctx.session, ctx.priority)
            if ctx.start <= service.local_day(a.start_utc, ctx.tz) <= ctx.end
        ]
    profile = service.get_profile(ctx.session)
    floors = zone_floors_from_profile(profile.zones, profile.fc_max)
    exported = builder.export_activities(ctx.session, acts, ctx.tz, floors)
    rows = []
    for a in sorted(exported, key=lambda x: (x.day, x.id)):
        pace = service.pace_summary_for(ctx.session, a.id)
        rows.append(
            [
                a.id,
                a.day.isoformat(),
                a.sport,
                a.source,
                int(a.is_race),
                _r(a.duration_min, 1),
                _r(a.distance_km, 3),
                _r(a.dplus_m, 0),
                _r(a.dminus_m, 0),
                a.hr_avg,
                a.hr_max,
                a.rpe,
                _r(a.low_share_pct, 1),
                _r(pace.gap_s_per_km, 0) if pace else None,
            ]
        )
    return Table(
        "activities",
        [
            "id",
            "date",
            "sport",
            "source",
            "course",
            "duree_min",
            "distance_km",
            "dplus_m",
            "dminus_m",
            "fc_moyenne_bpm",
            "fc_max_bpm",
            "rpe_0_10",
            "bas_intensite_pct",
            "allure_ajustee_pente_s_par_km",
        ],  # fmt: skip
        rows,
        "Séances dédupliquées. course = 1 pour une course (bas_intensite_pct vide : FC de "
        "compétition non comparée). bas_intensite_pct = part du temps en zones 1–2.",
    )


def _num(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _day(value: object) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)


def wellness_table(ctx: Ctx) -> Table:
    points = service.wellness_points(ctx.session, ctx.priority, ctx.start, ctx.end)
    rows = [
        [
            _day(p["date"]),
            _r(_num(p["hrv_nuit"])),
            _r(_num(p["fc_repos"]), 0),
            _r(_num(p["sommeil_duree_h"])),
            _r(_num(p["sommeil_efficacite"]), 1),
            _r(_num(p["training_readiness"]), 0),
            _r(_num(p["body_battery_max"]), 0),
            _r(_num(p["body_battery_min"]), 0),
        ]
        for p in points
    ]
    return Table(
        "wellness",
        [
            "date",
            "hrv_nuit_ms",
            "fc_repos_bpm",
            "sommeil_duree_h",
            "sommeil_efficacite_pct",
            "training_readiness_avis_montre",
            "body_battery_max_avis_montre",
            "body_battery_min_avis_montre",
        ],  # fmt: skip
        rows,
        "Jours reçus uniquement. Training Readiness et Body Battery : avis propriétaires Garmin, "
        "non validés.",
    )


def hrv_table(ctx: Ctx) -> Table:
    points = service.wellness_points(ctx.session, ctx.priority, ctx.start, ctx.end)
    rows = [
        [
            _day(p["date"]),
            _r(_num(p["hrv_nuit"])),
            _r(_num(p["hrv_base_min"])),
            _r(_num(p["hrv_base_max"])),
        ]
        for p in points
        if p["hrv_nuit"] is not None
    ]
    return Table(
        "hrv",
        ["date", "hrv_nuit_ms", "plage_reference_garmin_min_ms", "plage_reference_garmin_max_ms"],
        rows,
        "HRV nocturne quotidienne. La plage de référence est un avis de la montre. Lire en "
        "tendance (moyenne 7 j vs base 30–60 j), jamais une valeur isolée.",
    )


def load_table(ctx: Ctx) -> Table:
    all_rows = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    report = service.fitness(ctx.session, all_rows, ctx.today, ctx.start, ctx.end)
    rows = [
        [p.date.isoformat(), _r(p.load, 1), _r(p.ctl, 2), _r(p.atl, 2), _r(p.tsb, 2)]
        for p in report.points
    ]
    return Table(
        "load",
        ["date", "charge_points_fc", "ctl", "atl", "tsb"],
        rows,
        "Charge quotidienne estimée depuis la FC et CTL/ATL/TSB (constantes 42 j / 7 j) : courbes "
        "de tendance simplifiées, pas un verdict.",
    )


def intensity_table(ctx: Ctx) -> Table:
    rows_all = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    report = service.intensity(ctx.session, rows_all, ctx.reference_day, min(ctx.weeks, 52))
    rows = []
    for w in report.weeks:
        z = w.zone_seconds
        rows.append(
            [
                w.week_start.isoformat(),
                *[_r(x / 60, 1) for x in z],
                _r(w.low_share_pct, 1),
                w.activities_counted,
                w.races_excluded,
            ]  # fmt: skip
        )
    return Table(
        "intensity",
        [
            "semaine_du",
            "min_sous_z1",
            "min_z1",
            "min_z2",
            "min_z3",
            "min_z4",
            "min_z5",
            "bas_intensite_pct",
            "seances",
            "courses_exclues",
        ],  # fmt: skip
        rows,
        "Temps par zone de FC par semaine (courses exclues). Cible 75–80 % en bas d'intensité.",
    )


def monotony_table(ctx: Ctx) -> Table:
    rows_all = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    report = phase2.monotony(ctx.session, rows_all, ctx.reference_day, ctx.weeks)
    return Table(
        "monotony",
        ["semaine_du", "charge", "monotonie", "tension", "charge_elevee", "alerte_douce"],
        [
            [
                w.week_start.isoformat(),
                _r(w.load, 1),
                _r(w.monotony),
                _r(w.strain, 1),
                None if w.high_load is None else int(w.high_load),
                int(w.soft_alert),
            ]
            for w in report.weeks
        ],
        "Monotonie = moyenne ÷ écart-type des charges quotidiennes (repère 2) ; tension = charge × "
        "monotonie. Information, jamais un prédicteur de blessure.",
    )


def fatigue_table(ctx: Ctx) -> Table:
    rows_all = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    report = phase2.fatigue(ctx.session, rows_all, ctx.reference_day, ctx.weeks)
    return Table(
        "fatigue",
        ["semaine_du", "dminus_m", "seances", "seances_fort_dminus"],
        [
            [w.week_start.isoformat(), _r(w.loss_m, 0), w.sessions, w.strong_sessions]
            for w in report.weeks
        ],
        "D− hebdomadaire. Fort D− : ≥ 800 m, ou ≥ 400 m avec ≥ 80 m/km.",
    )


def strength_table(ctx: Ctx) -> Table:
    rows_all = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    target = service.get_profile(ctx.session).renfo_objectif_hebdo
    report = phase2.strength(ctx.session, rows_all, target, ctx.reference_day, ctx.weeks)
    return Table(
        "strength",
        ["semaine_du", "seances", "detectees", "saisies", "objectif", "objectif_atteint"],
        [
            [
                w.week_start.isoformat(),
                w.count,
                w.detected,
                w.manual,
                w.target,
                None if w.target_met is None else int(w.target_met),
            ]
            for w in report.weeks
        ],
        "Séances de renforcement par semaine (détectées + saisies, comptées une fois par jour).",
    )


def fueling_table(ctx: Ctx) -> Table:
    rows_all = service.load_rows(ctx.session, ctx.priority, ctx.tz)
    outings = phase2.fueling_outings(ctx.session, ctx.priority, rows_all)
    series = fueling_series(outings, ctx.min_hours)
    return Table(
        "fueling",
        [
            "activite_id",
            "date",
            "duree_h",
            "distance_km",
            "glucides_g_par_h",
            "glucides_total_g",
            "variation_g_par_h",
            "score_digestif_0_5",
            "note",
        ],  # fmt: skip
        [
            [
                p.activity_id,
                p.day.isoformat(),
                _r(p.duration_h),
                _r(p.distance_km, 1),
                _r(p.carbs_g_per_h, 1),
                _r(p.carbs_total_g, 0),
                _r(p.carbs_change_g_per_h, 1),
                p.gi_score,
                p.note,
            ]
            for p in series.points
            if ctx.start <= p.day <= ctx.end
        ],
        "Sorties longues avec la nutrition saisie (cellules vides : non saisi). Aucune cible n'est "
        "prescrite.",
    )


def plan_table(ctx: Ctx) -> Table:
    items = builder.plan_items(ctx.session, ctx.priority, ctx.tz, ctx.today, ctx.start, ctx.end)
    return Table(
        "plan",
        [
            "date",
            "titre",
            "type",
            "duree_prevue_min",
            "zone_cible",
            "dplus_prevu_m",
            "statut",
            "duree_faite_min",
            "dplus_fait_m",
        ],  # fmt: skip
        [
            [
                p.date.isoformat(),
                p.titre,
                p.type_label,
                p.duree_min,
                p.zone_cible,
                p.dplus_cible,
                p.status,
                _r(p.done_min, 1),
                _r(p.done_dplus_m, 0),
            ]
            for p in items
        ],
        "Plan prévu vs réalisé (rapprochement par jour et sport compatible).",
    )


def entries_table(ctx: Ctx) -> Table:
    rows: list[list[Any]] = []
    for e in read_entries(ctx.session, ctx.start, ctx.end):
        rpe = ";".join(str(s.rpe) for s in e.sessions) or None
        rows.append(
            [
                e.date.isoformat(),
                rpe,
                e.courbatures,
                None if e.malade is None else int(e.malade),
                e.note,
            ]
        )
    return Table(
        "entries",
        ["date", "rpe_seances_0_10", "courbatures_0_10", "malade", "note"],
        rows,
        "Saisies du soir (RPE de chaque séance du jour séparés par « ; »).",
    )


def gear_table(ctx: Ctx) -> Table:
    report = gear.build_report(ctx.session, ctx.priority, ctx.tz.key)
    return Table(
        "gear",
        [
            "paire",
            "km_total",
            "seuil_km",
            "usage_pct",
            "seances_affectees",
            "derniere_utilisation",
            "statut",
        ],  # fmt: skip
        [
            [
                g.nom,
                _r(g.km_total, 1),
                g.seuil_km,
                _r(g.usage_pct, 1),
                g.activities,
                g.last_used.isoformat() if g.last_used else None,
                g.status,
            ]
            for g in report.items
        ],
        "Kilométrage par paire (km déjà parcourus + sorties affectées). Le seuil d'usure est un "
        "repère personnel, l'alerte est informative.",
    )


BUILDERS: dict[SeriesName, Callable[[Ctx], Table]] = {
    "activities": activities_table,
    "wellness": wellness_table,
    "hrv": hrv_table,
    "load": load_table,
    "intensity": intensity_table,
    "monotony": monotony_table,
    "fatigue": fatigue_table,
    "strength": strength_table,
    "fueling": fueling_table,
    "plan": plan_table,
    "entries": entries_table,
    "gear": gear_table,
}


def build_table(name: str, ctx: Ctx) -> Table:
    if name not in BUILDERS:
        raise SeriesError(f"Série inconnue « {name} » (séries : {', '.join(SERIES_NAMES)}).")
    if ctx.start > ctx.end:
        raise SeriesError("« from » doit précéder « to ».")
    if (ctx.end - ctx.start).days + 1 > builder.MAX_SPAN_DAYS:
        raise SeriesError(f"Période limitée à {builder.MAX_SPAN_DAYS} jours.")
    return BUILDERS[name](ctx)


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return format(value, ".10g") if math.isfinite(value) else ""
    text = str(value)
    if text and text[0] in "=+-@\t\r":
        return "'" + text
    return text


def to_csv(table: Table) -> str:
    out = io.StringIO()
    writer = csv.writer(out, delimiter=",", lineterminator="\n")
    writer.writerow(table.columns)
    for row in table.rows:
        writer.writerow([_cell(v) for v in row])
    return out.getvalue()


def to_json(table: Table, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "series": table.name,
        "description": table.description,
        "columns": table.columns,
        "rows": [dict(zip(table.columns, row, strict=True)) for row in table.rows],
        **(extra or {}),
    }


def default_window(today: date, days: int = 28) -> tuple[date, date]:
    return today - timedelta(days=days - 1), today
