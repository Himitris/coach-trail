"""Export d'une séance et d'un widget (blocs Markdown réutilisant les rendus de l'export global)."""

from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app import activities as activities_api
from app.export import builder, series
from app.export import markdown as md
from app.metrics import service
from app.metrics.intensity import zone_floors_from_profile
from app.metrics.models import monday
from app.models import DashboardLayoutRow
from app.plan.entries import read_entries
from app.sync.dedup import primary_activities

DEFAULT_RECENT = 7


def _weeks(period: Any, default: int) -> int:
    """« 8w » -> 8 (même convention que les réglages des widgets), borné à 1–104."""
    try:
        return min(max(int(str(period).rstrip("w")), 1), 104)
    except ValueError:
        return default


def render_activity_detail(a: activities_api.ActivityDetailOut) -> str:
    lines = [
        f"## Détail de séance — {md.sport_label(a.sport)} du {md.day(a.day)}"
        + (" (course)" if a.is_race else ""),
        "",
        f"Durée {md.duration(a.duration_min)} · distance {md.km(a.distance_km)} "
        f"· D+ {md.meters(a.dplus_m)} "
        f"· D− {md.meters(a.dminus_m)} · FC moy. {md.num(a.hr_avg)} · FC max {md.num(a.hr_max)} "
        f"· RPE {md.num(a.rpe)} · source {a.source}",
        f"Allure moyenne : {md.pace(a.pace_s_per_km)}",
    ]
    if a.zones and a.zones.hr_time_s > 0:
        total = a.zones.hr_time_s
        lines += [
            "",
            "Temps par zone de FC :",
            "",
            md.table(
                ["Zone", "Temps", "Part"],
                [
                    [md.ZONE_NAMES[i], md.duration_s(s), f"{md.num(s / total * 100)} %"]
                    for i, s in enumerate(a.zones.seconds)
                ],
            ),
        ]
    if a.climbs:
        lines += [
            "",
            "Côtes détectées (ordre de grandeur) :",
            "",
            md.table(
                ["#", "Km", "D+", "Longueur", "Pente moy.", "Durée", "FC moy."],
                [
                    [
                        i,
                        f"{md.num(c.start_km, 1)}–{md.num(c.end_km, 1)}",
                        md.meters(c.gain_m),
                        md.meters(c.length_m),
                        f"{md.num(c.avg_grade_pct, 1)} %",
                        md.duration_s(c.duration_s),
                        md.num(c.avg_hr),
                    ]
                    for i, c in enumerate(a.climbs, start=1)
                ],
            ),
        ]
    lines += ["", *[f"_{n}_" for n in a.notes], f"_{a.evidence.summary}_"]
    return "\n".join(lines) + "\n"


def widget_markdown(
    session: Session,
    widget_type: str,
    settings: dict[str, Any],
    *,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
) -> str | None:
    """Markdown d'un widget d'après son type et ses réglages ; `None` = rien à exporter."""
    rows = service.load_rows(session, priority, tz)
    if widget_type == "note":
        text = str(settings.get("text") or "").strip()
        return f"## Note libre\n\n{text}\n" if text else None
    if widget_type == "intensity":
        weeks = min(_weeks(settings.get("period"), 8), builder.MAX_INTENSITY_WEEKS)
        return md.render_intensity(service.intensity(session, rows, today, weeks))
    if widget_type == "fitness":
        weeks = _weeks(settings.get("period"), 26)
        report = service.fitness(session, rows, today, today - timedelta(weeks=weeks), today)
        summary = builder.fitness_summary(report)
        return (
            md.render_fitness(summary)
            if summary
            else "## Forme (CTL / ATL / TSB)\n\nAucune donnée de charge sur la période.\n"
        )
    if widget_type == "recovery":
        try:
            baseline = int(str(settings.get("baseline", 60)))
        except ValueError:
            baseline = 60
        baseline = min(max(baseline, 30), 60)
        return md.render_recovery(
            builder.recovery_section(session, priority, today, today - timedelta(days=6), baseline)
        )
    if widget_type == "recent-activities":
        try:
            count = min(max(int(str(settings.get("count", DEFAULT_RECENT))), 1), 20)
        except ValueError:
            count = DEFAULT_RECENT
        group = str(settings.get("sport", "all"))
        acts = [
            a
            for a in reversed(primary_activities(session, priority))
            if group == "all" or activities_api.sport_group(a.sport) == group
        ][:count]
        profile = service.get_profile(session)
        floors = zone_floors_from_profile(profile.zones, profile.fc_max)
        return md.render_activities(builder.export_activities(session, acts, tz, floors))
    if widget_type == "week-load":
        start = monday(today - timedelta(days=7 if settings.get("week") == "last" else 0))
        week_rows = [r for r in rows if start <= r.day <= start + timedelta(days=6)]
        return md.render_volume(
            builder.volume_section(week_rows, start, start + timedelta(days=6), today)
        )
    if widget_type == "week-plan":
        start = monday(today)
        return md.render_plan(
            builder.plan_items(session, priority, tz, today, start, start + timedelta(days=6))
        )
    if widget_type == "evening-entry":
        d = today - timedelta(days=1) if settings.get("day") == "yesterday" else today
        entries = read_entries(session, d, d)
        if not entries:
            return None
        return "## Saisie du soir\n\n" + md.entry_line(entries[0]) + "\n"
    return None


def find_widget(session: Session, widget_id: str) -> tuple[str, dict[str, Any]] | None:
    row = session.get(DashboardLayoutRow, 1)
    if row is None:
        return None
    for page in row.data.get("pages", []):
        for w in page.get("widgets", []):
            if w.get("id") == widget_id:
                return str(w.get("type")), dict(w.get("settings") or {})
    return None


def widget_table(
    session: Session,
    widget_type: str,
    settings: dict[str, Any],
    *,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
) -> series.Table | None:
    """Série tabulaire (CSV / JSON) d'un widget ; None si ce type de widget n'en a pas."""

    def ctx(start: date, end: date, **extra: Any) -> series.Ctx:
        return series.Ctx(session, priority, tz, today, start, end, **extra)

    if widget_type == "fitness":
        weeks = _weeks(settings.get("period"), 26)
        return series.load_table(ctx(today - timedelta(weeks=weeks), today))
    if widget_type == "intensity":
        weeks = min(_weeks(settings.get("period"), 8), builder.MAX_INTENSITY_WEEKS)
        return series.intensity_table(ctx(monday(today) - timedelta(weeks=weeks - 1), today))
    if widget_type == "recovery":
        window = _days(settings.get("window"), 28)
        return series.wellness_table(ctx(today - timedelta(days=window - 1), today))
    if widget_type in ("monotony", "fatigue", "strength"):
        weeks = _weeks(settings.get("weeks"), 12 if widget_type == "monotony" else 8)
        c = ctx(monday(today) - timedelta(weeks=weeks - 1), today)
        return {
            "monotony": series.monotony_table,
            "fatigue": series.fatigue_table,
            "strength": series.strength_table,
        }[widget_type](c)
    if widget_type == "fueling":
        try:
            hours = float(str(settings.get("minHours", 2.5)))
        except ValueError:
            hours = 2.5
        return series.fueling_table(
            ctx(today - timedelta(days=365), today, min_hours=min(max(hours, 0.5), 24))
        )
    if widget_type == "week-plan":
        start = monday(today)
        return series.plan_table(ctx(start, start + timedelta(days=6)))
    if widget_type == "week-load":
        start = monday(today - timedelta(days=7 if settings.get("week") == "last" else 0))
        return series.activities_table(ctx(start, start + timedelta(days=6)))
    if widget_type == "evening-entry":
        d = today - timedelta(days=1) if settings.get("day") == "yesterday" else today
        return series.entries_table(ctx(d, d))
    if widget_type == "recent-activities":
        try:
            count = min(max(int(str(settings.get("count", DEFAULT_RECENT))), 1), 20)
        except ValueError:
            count = DEFAULT_RECENT
        group = str(settings.get("sport", "all"))
        acts = [
            a
            for a in builder.reversed_activities(session, priority)
            if group == "all" or activities_api.sport_group(a.sport) == group
        ][:count]
        return series.activities_table(ctx(today - timedelta(days=365), today), acts)
    if widget_type == "activity-detail":
        wanted = settings.get("activityId")
        acts = builder.reversed_activities(session, priority)
        chosen = [a for a in acts if a.id == wanted] if isinstance(wanted, int) else acts[:1]
        return series.activities_table(ctx(today - timedelta(days=365), today), chosen)
    return None


def _days(value: Any, default: int) -> int:
    try:
        return min(max(int(str(value)), 1), 365)
    except ValueError:
        return default
