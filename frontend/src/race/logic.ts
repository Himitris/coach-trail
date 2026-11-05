import { formatDuration } from "../app/format";
import type { JourAvant, RacePlanDoc, Tranche } from "./types";

export interface Totals {
  minutes: number;
  carbs: number;
  gels: number;
  drinkMl: number;
  sodiumMg: number;
}

const sum = (values: (number | undefined)[]): number => values.reduce<number>((a, v) => a + (v ?? 0), 0);

/** Cumuls de nutrition sur toutes les tranches (ce que le plan prévoit d'emporter / consommer). */
export function totalsOf(tranches: Tranche[]): Totals {
  return {
    minutes: tranches.reduce((m, t) => Math.max(m, t.fin_min), 0),
    carbs: sum(tranches.map((t) => t.glucides_g)),
    gels: sum(tranches.map((t) => t.gels)),
    drinkMl: sum(tranches.map((t) => t.boisson_ml)),
    sodiumMg: sum(tranches.map((t) => t.sodium_mg)),
  };
}

/** Glucides par heure d'une tranche (g/h), null si la quantité est inconnue. */
export function carbsPerHour(t: Tranche): number | null {
  if (t.glucides_g === undefined) return null;
  return Math.round((t.glucides_g / (t.fin_min - t.debut_min)) * 60);
}

export const clock = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h} h ${String(m).padStart(2, "0")}`;
};

export const rangeLabel = (t: Tranche): string => `${clock(t.debut_min)} → ${clock(t.fin_min)}`;

export function fcLabel(t: Tranche): string | null {
  if (t.fc_min !== undefined && t.fc_max !== undefined) return `${t.fc_min}–${t.fc_max}`;
  if (t.fc_max !== undefined) return `≤ ${t.fc_max}`;
  if (t.fc_min !== undefined) return `≥ ${t.fc_min}`;
  return null;
}

export function dayLabel(d: JourAvant): string {
  const base = d.jour === -1 ? "Veille" : d.jour === -2 ? "Avant-veille" : `J${d.jour}`;
  return d.titre ? `${base} · ${d.titre}` : base;
}

/** Plan trié : veille la plus proche en dernier (ordre chronologique). */
export const daysBefore = (doc: RacePlanDoc): JourAvant[] => [...(doc.jours_avant ?? [])].sort((a, b) => a.jour - b.jour);

/** Export Markdown du plan, à coller dans Claude. */
export function raceMarkdown(name: string, date: string, doc: RacePlanDoc): string {
  const out: string[] = [`# Plan de course — ${name} (${date})`, ""];
  const o = doc.objectif;
  if (o) {
    out.push("## Objectif");
    if (o.temps_cible_min) out.push(`- Temps cible : ${formatDuration(o.temps_cible_min)}`);
    if (o.allure_cible) out.push(`- Allure cible : ${o.allure_cible}`);
    if (o.strategie) out.push(`- Stratégie : ${o.strategie}`);
    out.push("");
  }
  for (const d of daysBefore(doc)) {
    out.push(`## ${dayLabel(d)}`);
    if (d.activite) out.push(`- Activité : ${d.activite}`);
    for (const r of d.repas ?? []) out.push(`- Repas${r.heure ? ` ${r.heure}` : ""} : ${r.description}${r.glucides_g ? ` (${r.glucides_g} g glucides)` : ""}`);
    if (d.hydratation) out.push(`- Hydratation : ${d.hydratation}`);
    if (d.sommeil) out.push(`- Sommeil : ${d.sommeil}`);
    for (const n of d.notes ?? []) out.push(`- ${n}`);
    out.push("");
  }
  const m = doc.matin;
  if (m) {
    out.push("## Matin de course");
    if (m.reveil) out.push(`- Réveil : ${m.reveil}`);
    if (m.depart) out.push(`- Départ de la course : ${m.depart}`);
    for (const r of m.repas ?? []) out.push(`- Repas${r.heure ? ` ${r.heure}` : ""} : ${r.description}${r.glucides_g ? ` (${r.glucides_g} g glucides)` : ""}`);
    if (m.echauffement) out.push(`- Échauffement : ${m.echauffement}`);
    if (m.hydratation) out.push(`- Hydratation : ${m.hydratation}`);
    for (const n of m.notes ?? []) out.push(`- ${n}`);
    out.push("");
  }
  const tr = doc.tranches ?? [];
  if (tr.length) {
    out.push("## Plan de course par tranche", "", "| Temps | Km | Zone | FC | Allure | Glucides | Gels | Boisson | Sodium | Note |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const t of tr) {
      const km = t.km_debut !== undefined || t.km_fin !== undefined ? `${t.km_debut ?? "?"}–${t.km_fin ?? "?"}` : "";
      out.push(
        `| ${rangeLabel(t)} | ${km} | ${t.zone ?? ""} | ${fcLabel(t) ?? ""} | ${t.allure ?? ""} | ${t.glucides_g === undefined ? "" : `${t.glucides_g} g`} | ${t.gels ?? ""} | ${t.boisson_ml === undefined ? "" : `${t.boisson_ml} ml`} | ${t.sodium_mg === undefined ? "" : `${t.sodium_mg} mg`} | ${[t.aliment, t.note].filter(Boolean).join(" — ")} |`,
      );
    }
    const tot = totalsOf(tr);
    out.push("", `Total : ${tot.carbs} g de glucides, ${tot.gels} gel(s), ${tot.drinkMl} ml de boisson, ${tot.sodiumMg} mg de sodium.`, "");
  }
  if (doc.ravitaillements?.length) {
    out.push("## Ravitaillements");
    for (const r of doc.ravitaillements) {
      out.push(`- km ${r.km}${r.nom ? ` · ${r.nom}` : ""}${r.temps_estime_min === undefined ? "" : ` · vers ${clock(r.temps_estime_min)}`}${r.action ? ` : ${r.action}` : ""}`);
    }
    out.push("");
  }
  if (doc.materiel?.length) out.push("## Matériel", ...doc.materiel.map((x) => `- ${x}`), "");
  const a = doc.apres_course;
  if (a) {
    out.push("## Après la course");
    for (const r of a.repas ?? []) out.push(`- Repas${r.heure ? ` ${r.heure}` : ""} : ${r.description}`);
    for (const n of a.notes ?? []) out.push(`- ${n}`);
    out.push("");
  }
  if (doc.notes?.length) out.push("## Notes", ...doc.notes.map((x) => `- ${x}`), "");
  return out.join("\n").trimEnd() + "\n";
}

// --- import : prompt et exemple ----------------------------------------------------------------

export const RACE_FORMAT = `Réponds uniquement avec un bloc de code JSON, sans commentaire autour, au format exact (version 1). Tous les champs sont facultatifs, sauf qu'il faut au moins une section :
{
  "version": 1,
  "course": "nom de la course",
  "objectif": { "temps_cible_min": 270, "allure_cible": "8:40/km", "strategie": "Partir prudent, relancer après le km 20" },
  "jours_avant": [
    { "jour": -2, "titre": "Avant-veille", "activite": "Footing 30 min", "repas": [{ "heure": "12:30", "description": "...", "glucides_g": 90 }], "hydratation": "...", "sommeil": "...", "notes": ["..."] },
    { "jour": -1, "titre": "Veille", "repas": [{ "heure": "19:30", "description": "Pâtes, poulet", "glucides_g": 120 }] }
  ],
  "matin": {
    "reveil": "05:30", "depart": "08:00",
    "repas": [{ "heure": "05:45", "description": "Riz au lait, pain, miel", "glucides_g": 100 }],
    "echauffement": "10 min de marche + 3 accélérations", "hydratation": "500 ml avant le départ", "notes": ["..."]
  },
  "tranches": [
    { "debut_min": 0, "fin_min": 60, "km_debut": 0, "km_fin": 7, "zone": "Z2", "fc_min": 135, "fc_max": 152, "allure": "8:30/km",
      "glucides_g": 60, "gels": 1, "boisson_ml": 500, "sodium_mg": 500, "aliment": "1 gel + barre", "note": "Partir doucement" }
  ],
  "ravitaillements": [{ "km": 12, "nom": "Ravito 1", "temps_estime_min": 105, "action": "Recharger les flasques" }],
  "materiel": ["Gilet 10 L", "Frontale"],
  "apres_course": { "repas": [{ "description": "Repas riche en protéines et glucides" }], "notes": ["..."] },
  "notes": ["..."]
}

Règles :
- « tranches » : une par heure de course (ou par segment), temps écoulé en minutes depuis le départ (debut_min < fin_min). « zone » : zone cible (ex. « Z2 », « Z2-Z3 ») ; « fc_min » / « fc_max » : fourchette de FC en bpm ; « gels » peut être décimal (0,5).
- « glucides_g », « boisson_ml », « sodium_mg » : quantités pour la tranche entière (pas par heure).
- « jours_avant » : « jour » est négatif (-1 = veille, -2 = avant-veille…), au plus 7 jours, un seul bloc par jour.
- Heures au format HH:MM. Pas de champ inconnu. N'invente pas de chiffres que tu ne connais pas : omets le champ.
- Ne remplace pas un plan existant sans le dire : l'import remplace entièrement le plan de cette course.`;

export const RACE_EXAMPLE = `{
  "version": 1,
  "course": "Trail des 3 Rocs",
  "objectif": { "temps_cible_min": 300, "allure_cible": "9:40/km" },
  "jours_avant": [
    { "jour": -1, "titre": "Veille", "repas": [{ "heure": "19:30", "description": "Pâtes, poulet, pain", "glucides_g": 120 }], "sommeil": "Coucher avant 22:30" }
  ],
  "matin": {
    "reveil": "05:30",
    "depart": "08:00",
    "repas": [{ "heure": "05:45", "description": "Riz au lait, pain, miel", "glucides_g": 100 }]
  },
  "tranches": [
    { "debut_min": 0, "fin_min": 60, "zone": "Z2", "fc_min": 135, "fc_max": 152, "glucides_g": 60, "gels": 1, "boisson_ml": 500 },
    { "debut_min": 60, "fin_min": 120, "zone": "Z2", "fc_min": 140, "fc_max": 155, "glucides_g": 70, "gels": 1.5, "boisson_ml": 500, "note": "Montée longue : marcher" }
  ],
  "ravitaillements": [{ "km": 12, "nom": "Ravito 1", "action": "Recharger les flasques" }],
  "materiel": ["Gilet 10 L", "Frontale"]
}`;

/** Prompt à coller dans Claude, avec le contexte de la course. */
export function racePrompt(name: string, date: string, km: number | null, dplus: number | null): string {
  const facts = [km === null ? null : `${km} km`, dplus === null ? null : `${dplus} m D+`].filter(Boolean).join(", ");
  return `Prépare le plan du jour J pour ma course « ${name} » (${date}${facts ? `, ${facts}` : ""}) pour mon application Coach Trail : nutrition de la veille et du matin, plan de course heure par heure (zones, FC, allure, glucides, gels, boisson, sodium), ravitaillements, matériel.\n\n${RACE_FORMAT}`;
}
