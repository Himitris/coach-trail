import type {
  ActivityDetail,
  Activity,
  Entry,
  FitnessReport,
  IntensityReport,
  RecoveryMetrics,
  WeekMetrics,
  WeekPlan,
} from "../api/types";
import {
  formatDay,
  formatDuration,
  formatDurationS,
  formatKm,
  formatMeters,
  formatNumber,
  formatPace,
  formatSigned,
  formatSignedPct,
  formatWeekdayDay,
} from "../app/format";
import { sportLabel } from "./labels";

/** Formats Markdown des widgets (export vers Claude) : valeurs absentes = « — », jamais inventées. */

const cell = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === "" ? "—" : String(value).replace(/\|/g, "/");

const row = (...cells: (string | number | null | undefined)[]): string => `| ${cells.map(cell).join(" | ")} |`;

const table = (header: string[], rows: string[]): string =>
  [row(...header), row(...header.map(() => "---")), ...rows].join("\n");

const DIRECTION = { hausse: "en hausse", baisse: "en baisse", stable: "stable", indetermine: "indéterminée" } as const;

export function formatWeekPlan(week: WeekPlan): string {
  const lines = week.days.map((day) => {
    const planned = day.sessions
      .filter((s) => s.planned.type !== "repos" || day.sessions.length === 1)
      .map((s) => {
        const p = s.planned;
        const bits = [p.titre, p.duree_min ? formatDuration(p.duree_min) : null, p.zone_cible ? `Z${p.zone_cible}` : null]
          .filter(Boolean)
          .join(", ");
        return bits;
      })
      .join(" + ");
    const done = [
      ...day.sessions.flatMap((s) => (s.activity ? [s.activity] : [])),
      ...day.unplanned_activities,
    ]
      .map((a) => `${sportLabel(a.sport)} ${formatDuration(a.duration_min)}${a.distance_km ? `, ${formatKm(a.distance_km)}` : ""}${a.dplus_m ? `, D+ ${formatMeters(a.dplus_m)}` : ""}`)
      .join(" + ");
    return row(formatWeekdayDay(day.date), planned, done, day.status);
  });
  return [
    `## Programme de la semaine (${formatDay(week.week_start)} – ${formatDay(week.week_end)})`,
    "",
    `Prévu : ${formatDuration(week.planned_min)} · Réalisé : ${formatDuration(week.done_min)}`,
    "",
    table(["Jour", "Prévu", "Réalisé", "Statut"], lines),
    "",
  ].join("\n");
}

export function formatWeekLoad(m: WeekMetrics): string {
  const avg = m.avg_4w;
  const line = (label: string, get: (t: WeekMetrics["current"]) => string) =>
    row(label, get(m.current), get(m.previous), avg ? get(avg) : null);
  const lines = [
    `## Charge de la semaine (${formatDay(m.week_start)} – ${formatDay(m.week_end)}${m.complete ? "" : ", en cours"})`,
    "",
    table(
      ["", "Cette semaine", "Semaine précédente", "Moyenne 4 semaines"],
      [
        line("Temps", (t) => formatDurationS(t.time_s)),
        line("Distance", (t) => formatKm(t.distance_m / 1000)),
        line("D+", (t) => formatMeters(t.gain_m)),
        line("D−", (t) => formatMeters(t.loss_m)),
        line("Séances", (t) => formatNumber(t.sessions, 1)),
      ],
    ),
    "",
    `Variation du temps : ${formatSignedPct(m.time_change_vs_previous_pct)} vs semaine précédente, ${formatSignedPct(m.time_change_vs_avg4w_pct)} vs moyenne 4 semaines (repère de bon sens : +${m.reference_rise_pct} % par semaine, pas un prédicteur de blessure).`,
  ];
  if (m.srpe) lines.push(`Charge perçue (RPE × minutes) : ${formatNumber(m.srpe.total_load_au)} u.a.`);
  return [...lines, ""].join("\n");
}

export function formatRecentActivities(items: Activity[]): string {
  const showGap = items.some((a) => a.gap_s_per_km !== null);
  const header = ["Date", "Sortie", "Durée", "Distance", "D+", "FC moy.", ...(showGap ? ["GAP"] : []), "RPE"];
  const rows = items.map((a) =>
    row(
      formatDay(a.day),
      `${sportLabel(a.sport)}${a.is_race ? " (course)" : ""}`,
      formatDuration(a.duration_min),
      a.distance_km === null ? null : formatKm(a.distance_km),
      a.dplus_m === null ? null : formatMeters(a.dplus_m),
      a.hr_avg,
      ...(showGap ? [a.gap_s_per_km === null ? null : formatPace(a.gap_s_per_km)] : []),
      a.rpe,
    ),
  );
  return ["## Dernières sorties", "", table(header, rows), ""].join("\n");
}

export function formatActivityDetail(a: ActivityDetail): string {
  const lines = [
    `## Détail de séance — ${sportLabel(a.sport)} du ${formatDay(a.day)}${a.is_race ? " (course)" : ""}`,
    "",
    `Durée ${formatDuration(a.duration_min)} · distance ${a.distance_km === null ? "—" : formatKm(a.distance_km)} · D+ ${a.dplus_m === null ? "—" : formatMeters(a.dplus_m)} · D− ${a.dminus_m === null ? "—" : formatMeters(a.dminus_m)} · FC moy. ${cell(a.hr_avg)} · FC max ${cell(a.hr_max)} · RPE ${cell(a.rpe)}`,
    `Allure moyenne : ${formatPace(a.pace_s_per_km)} (allure ajustée à la pente : ${a.gap_s_per_km === null ? "non disponible" : formatPace(a.gap_s_per_km)})`,
  ];
  if (a.zones && a.zones.hr_time_s > 0) {
    const total = a.zones.hr_time_s;
    const names = ["Sous Z1", "Z1", "Z2", "Z3", "Z4", "Z5"];
    lines.push(
      "",
      "Temps par zone de FC :",
      "",
      table(
        ["Zone", "Temps", "Part"],
        a.zones.seconds.map((s, i) => row(names[i], formatDurationS(s), `${formatNumber((s / total) * 100)} %`)),
      ),
    );
  }
  if (a.climbs.length) {
    lines.push(
      "",
      "Côtes détectées (profil lissé, ordre de grandeur) :",
      "",
      table(
        ["#", "Km", "D+", "Longueur", "Pente moy.", "Durée", "FC moy."],
        a.climbs.map((c, i) =>
          row(
            i + 1,
            `${formatNumber(c.start_km, 1)}–${formatNumber(c.end_km, 1)}`,
            formatMeters(c.gain_m),
            formatMeters(c.length_m),
            `${formatNumber(c.avg_grade_pct, 1)} %`,
            c.duration_s === null ? null : formatDurationS(c.duration_s),
            c.avg_hr === null ? null : formatNumber(c.avg_hr),
          ),
        ),
      ),
    );
  }
  for (const note of a.notes) lines.push("", `_${note}_`);
  return [...lines, ""].join("\n");
}

export function formatIntensity(r: IntensityReport): string {
  const rows = r.weeks.map((w) => {
    const hr = w.hr_time_s;
    const part = (s: number) => (hr > 0 ? `${formatNumber((s / hr) * 100)} %` : null);
    const z1 = (w.zone_seconds[0] ?? 0) + (w.zone_seconds[1] ?? 0);
    return row(
      formatDay(w.week_start),
      part(z1),
      part(w.zone_seconds[2] ?? 0),
      part(w.zone_seconds[3] ?? 0),
      part(w.zone_seconds[4] ?? 0),
      part(w.zone_seconds[5] ?? 0),
      w.low_share_pct === null ? null : `${formatNumber(w.low_share_pct)} %`,
    );
  });
  return [
    "## Répartition des intensités (par semaine)",
    "",
    table(["Semaine du", "Z1", "Z2", "Z3", "Z4", "Z5", "Bas d'intensité (Z1–Z2)"], rows),
    "",
    `Cible : ${r.target_min_pct}–${r.target_max_pct} % du temps en bas d'intensité (zones 1–2). Moyenne sur la période : ${r.average_low_share_pct === null ? "—" : `${formatNumber(r.average_low_share_pct)} %`}. Courses exclues.`,
    "",
  ].join("\n");
}

export function formatFitness(r: FitnessReport): string {
  const last = r.points.at(-1);
  if (!last) return "## Forme (CTL / ATL / TSB)\n\nAucune donnée de charge sur la période.\n";
  const lines = [
    "## Forme (CTL / ATL / TSB)",
    "",
    `Au ${formatDay(last.date)} : CTL ${formatNumber(last.ctl, 1)} · ATL ${formatNumber(last.atl, 1)} · TSB ${formatSigned(last.tsb, 1)}.`,
    `Rampe de CTL sur 4 semaines : ${formatSigned(r.ctl_ramp_4w, 1)} point(s) (${DIRECTION[r.trend.direction]}).`,
    "Courbes de tendance (constantes 42 j / 7 j), pas un verdict.",
  ];
  for (const w of r.warnings) lines.push(`- ${w}`);
  return [...lines, ""].join("\n");
}

export function formatRecovery(r: RecoveryMetrics): string {
  const base = (label: string, c: RecoveryMetrics["hrv"], unit: string, digits: 0 | 1 = 0) =>
    row(
      label,
      c.recent_mean === null ? null : `${formatNumber(c.recent_mean, digits)} ${unit}`,
      c.baseline_mean === null ? null : `${formatNumber(c.baseline_mean, digits)} ${unit}`,
      formatSignedPct(c.delta_pct, 1),
      c.delta_sd === null ? null : formatSigned(c.delta_sd, 1, "écart-type"),
      DIRECTION[c.trend.direction],
    );
  const prop = (label: string, m: RecoveryMetrics["training_readiness"]) =>
    `- ${label} : ${m.value === null ? "—" : formatNumber(m.value)} (${m.label})`;
  const fallback = r.fallback
    ? [`Garmin indisponible depuis le ${formatDay(r.fallback.since)} : valeurs de repli Intervals.icu. ${r.fallback.message}`, ""]
    : [];
  return [
    `## Récupération (au ${formatDay(r.date)})`,
    "",
    ...fallback,
    table(
      ["", "Moyenne 7 j", `Base ${r.baseline_days} j`, "Écart", "Écart-type", "Tendance"],
      [
        base("HRV nocturne", r.hrv, "ms"),
        base("FC repos", r.resting_hr, "bpm"),
        base("Sommeil (durée)", r.sleep_duration_h, "h", 1),
        base("Sommeil (efficacité estimée)", r.sleep_efficiency_pct, "%"),
      ],
    ),
    "",
    prop("Training Readiness", r.training_readiness),
    prop("Body Battery (max)", r.body_battery_max),
    prop("Body Battery (min)", r.body_battery_min),
    "",
    "Tendances par rapport à la base individuelle, sans seuil quotidien feu vert/rouge.",
    "",
  ].join("\n");
}

export function formatEntry(day: string, entry: Entry | null): string | null {
  if (!entry || (entry.courbatures === null && entry.malade === null && !entry.note && !entry.sessions.length)) {
    return null;
  }
  const lines = [`## Saisie du soir (${formatWeekdayDay(day)})`, ""];
  for (const s of entry.sessions) {
    lines.push(`- RPE ${s.rpe}/10${s.sport ? ` (${sportLabel(s.sport)}${s.duration_min ? `, ${formatDuration(s.duration_min)}` : ""})` : ""}`);
  }
  if (entry.courbatures !== null) lines.push(`- Courbatures : ${entry.courbatures}/10`);
  if (entry.malade !== null) lines.push(`- Malade : ${entry.malade ? "oui" : "non"}`);
  if (entry.note) lines.push(`- Note : ${entry.note}`);
  return [...lines, ""].join("\n");
}
