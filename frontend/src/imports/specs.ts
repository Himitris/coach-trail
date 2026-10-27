import { ApiError } from "../api/client";
import { createGear, createGoal, fetchGear, fetchGoals, importPlan, putEntry } from "../api/endpoints";
import { formatDay } from "../app/format";
import { invalidateTraining } from "../widgets/queries";
import type { ImportContext, ImportPreview, ImportSpec } from "./types";
import { expandWeekTemplate, mondayOf, todayLocal } from "./week";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Liste d'éléments dans `doc[key]` (ou le document lui-même si c'est une liste). */
function listOf(doc: unknown, key: string, errors: string[]): unknown[] {
  const list = isObject(doc) ? doc[key] : doc;
  if (!Array.isArray(list)) {
    errors.push(`Le fichier doit contenir une liste « ${key} ».`);
    return [];
  }
  if (list.length === 0) errors.push(`La liste « ${key} » est vide.`);
  if (list.length > 400) errors.push("Import limité à 400 éléments.");
  return list;
}

function checkRoot(doc: unknown, allowed: string[], errors: string[]): void {
  if (!isObject(doc)) return;
  if (doc.version !== undefined && doc.version !== 1) errors.push(`Version non prise en charge : ${JSON.stringify(doc.version)} (attendu : 1).`);
  for (const key of Object.keys(doc)) {
    if (key !== "version" && !allowed.includes(key)) errors.push(`Champ inconnu « ${key} » à la racine.`);
  }
}

function checkDate(value: unknown, where: string, errors: string[]): value is string {
  const ok = typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!ok) errors.push(`${where} : « date » est obligatoire, au format AAAA-MM-JJ (reçu : ${JSON.stringify(value)}).`);
  return ok;
}

function checkUnknownKeys(item: Record<string, unknown>, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(item)) {
    if (!allowed.includes(key)) errors.push(`${where} : champ inconnu « ${key} » (autorisés : ${allowed.join(", ")}).`);
  }
}

function checkInt(value: unknown, field: string, lo: number, hi: number, where: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < lo || value > hi) {
    errors.push(`${where} : « ${field} » doit être un entier entre ${lo} et ${hi} (reçu : ${JSON.stringify(value)}).`);
  }
}

function checkNumber(value: unknown, field: string, lo: number, hi: number, where: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi) {
    errors.push(`${where} : « ${field} » doit être un nombre entre ${lo} et ${hi} (reçu : ${JSON.stringify(value)}).`);
  }
}

function checkText(value: unknown, field: string, max: number, where: string, errors: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.length > max) errors.push(`${where} : « ${field} » doit être un texte de ${max} caractères au plus.`);
}

function issuesOf(error: unknown): string[] | null {
  if (error instanceof ApiError && isObject(error.detail) && Array.isArray(error.detail.errors)) {
    return (error.detail.errors as { session: number | null; message: string }[]).map((i) =>
      i.session === null ? i.message : `Séance ${i.session} : ${i.message}`,
    );
  }
  return null;
}

// --- Programme de la semaine -------------------------------------------------------------------

export const PLAN_TYPES = "footing | cotes | seuil | longue | fractionne | course | renfo | repos | autre";

const PLAN_FORMAT = `Réponds uniquement avec un bloc de code JSON, sans commentaire autour.

Cas 1 — plan avec des dates (version 2) :
{
  "version": 2,
  "plan": { "nom": "nom court du plan", "course": "nom de la course visée (facultatif)" },
  "sessions": [
    {
      "date": "AAAA-MM-JJ",
      "type": "${PLAN_TYPES}",
      "titre": "titre court (facultatif)",
      "duree_min": 60,
      "zone_cible": "2",
      "dplus_cible": 200,
      "objectif": "but de la séance en une phrase (facultatif)",
      "consignes": "consignes d'exécution (facultatif)"
    }
  ]
}

Cas 2 — semaine type, sans dates, à rejouer chaque semaine :
{
  "version": 1,
  "semaine_type": [
    { "jour": "lundi | mardi | mercredi | jeudi | vendredi | samedi | dimanche", "type": "…", "duree_min": 60, "zone_cible": "2" }
  ]
}
(mêmes champs que dans le cas 1, avec « jour » à la place de « date »).

Règles :
- « type » est obligatoire (valeurs exactes ci-dessus, minuscules, sans accent) ; « date » (cas 1) ou « jour » (cas 2) aussi. Tout le reste est facultatif. Aucun autre champ.
- « date » au format AAAA-MM-JJ. Une ligne par séance ; plusieurs séances le même jour sont permises. Inclus les jours de repos ("type": "repos").
- « duree_min » : entier de minutes. « dplus_cible » : entier de mètres.
- « zone_cible » : texte avec une zone de 1 à 5 ("2") ou une fourchette croissante ("1-2"), zones de FC Garmin, FC max 195 bpm.
- « plan.nom » identifie le plan : le réimporter le met à jour. « plan.course » : nom de la course visée telle qu'elle figure dans l'appli (facultatif). Sans bloc « plan », écris "version": 1.
- Méthode 80/20 : environ 80 % du temps en zones 1-2.`;

const PLAN_EXAMPLE = `{
  "version": 1,
  "semaine_type": [
    { "jour": "lundi", "type": "repos" },
    { "jour": "mardi", "type": "footing", "duree_min": 50, "zone_cible": "1-2" },
    { "jour": "mercredi", "type": "cotes", "titre": "Côtes courtes", "duree_min": 60, "zone_cible": "3-4", "dplus_cible": 300 },
    { "jour": "jeudi", "type": "footing", "duree_min": 45, "zone_cible": "2" },
    { "jour": "vendredi", "type": "renfo", "duree_min": 30 },
    { "jour": "samedi", "type": "footing", "duree_min": 60, "zone_cible": "2" },
    { "jour": "dimanche", "type": "longue", "duree_min": 150, "zone_cible": "2", "dplus_cible": 800, "consignes": "Manger 60 g de glucides par heure" }
  ]
}`;

/** Règles d'un format (texte après « Règles : »), pour le prompt d'import unique. */
const rulesOf = (format: string): string => format.split("\n\nRègles :\n")[1] ?? "";

/** Fichier de plan (dates ou semaine type) → document de séances prêt pour l'API. */
function toPlanDocument(doc: unknown, weekStart: string | undefined): { doc: unknown; errors: string[] } {
  if (!isObject(doc) || doc.semaine_type === undefined) return { doc, errors: [] };
  if (doc.sessions !== undefined) return { doc, errors: ["Le fichier ne peut pas contenir à la fois « sessions » et « semaine_type »."] };
  if (!weekStart) return { doc, errors: ["Choisissez la semaine à remplir pour appliquer la semaine type."] };
  const { sessions, errors } = expandWeekTemplate(doc.semaine_type, weekStart);
  const extra = Object.keys(doc).filter((k) => k !== "version" && k !== "semaine_type" && k !== "plan");
  extra.forEach((k) => errors.push(`Champ inconnu « ${k} » à la racine.`));
  return { doc: { version: doc.version ?? (doc.plan === undefined ? 1 : 2), ...(doc.plan === undefined ? {} : { plan: doc.plan }), sessions }, errors };
}

const planSpec: ImportSpec = {
  widgetId: "week-plan",
  label: "Séances prévues",
  format: "Plan de séances avec dates, ou semaine type (jours de la semaine) appliquée à la semaine de ton choix.",
  prompt: `Tu es mon entraîneur de trail. Transforme le document ci-joint (ma semaine type ou mon plan) au format exact attendu par mon application Coach Trail.\n\n${PLAN_FORMAT}`,
  coachSentence: `Voici ma semaine type : peux-tu me la renvoyer sous forme d'un fichier JSON au format ci-dessous (une ligne par séance, avec le jour de la semaine) pour que je l'importe dans mon appli ?\n\n${PLAN_EXAMPLE}`,
  example: PLAN_EXAMPLE,
  sectionKeys: ["plan", "sessions", "semaine_type"],
  rules: rulesOf(PLAN_FORMAT),
  weekTemplate: true,
  async preview(doc, ctx) {
    const { doc: planDoc, errors } = toPlanDocument(doc, ctx.weekStart);
    if (errors.length) return { errors, lines: [] };
    try {
      const report = await importPlan(planDoc, { dryRun: true });
      const label = { create: "Création", replace: "Remplacement", unchanged: "Inchangé", blocked: "Bloqué (jour déjà réalisé)", overlap: "Autre plan (confirmation)" } as const;
      const lines = report.days.map(
        (d) => `${formatDay(d.date)} — ${label[d.action]} : ${d.incoming.map((l) => l.titre).join(" + ")}`,
      );
      const { created_days, replaced_days, blocked_days, overlap_days } = report.summary;
      const held = blocked_days + overlap_days; // jours qui demandent une confirmation explicite
      const { plan } = report;
      const notes = [
        ...(plan
          ? [
              `${plan.action === "update" ? "Plan existant mis à jour" : "Nouveau plan"} : « ${plan.nom} » (${formatDay(plan.date_debut)} → ${formatDay(plan.date_fin)}), ${plan.course_nom ? `course : ${plan.course_nom}` : "aucune course liée"}.`,
            ]
          : []),
        ...report.warnings,
      ];
      return { errors: [], lines, notes, blocked: held, changes: created_days + replaced_days, nothingToDo: created_days + replaced_days === 0 && held === 0 };
    } catch (error) {
      const issues = issuesOf(error);
      if (issues) return { errors: issues, lines: [] };
      throw error;
    }
  },
  async apply(doc, ctx) {
    const { doc: planDoc } = toPlanDocument(doc, ctx.weekStart);
    const report = await importPlan(planDoc, {
      dryRun: false,
      confirmPastDone: ctx.confirmPast ?? false,
      confirmOverlap: ctx.confirmPast ?? false,
    });
    await invalidateTraining(ctx.queryClient);
    return `Plan importé : ${report.summary.sessions_added} séance(s) ajoutée(s).`;
  },
};

// --- Saisie du soir ----------------------------------------------------------------------------

const ENTRY_FORMAT = `Réponds uniquement avec un bloc de code JSON, sans commentaire autour, au format exact (version 1) :
{
  "version": 1,
  "saisies": [
    { "date": "AAAA-MM-JJ", "courbatures": 3, "malade": false, "note": "jambes lourdes après la sortie longue" }
  ]
}

Règles :
- « date » est obligatoire (AAAA-MM-JJ) ; une seule ligne par jour. Tout le reste est facultatif. Aucun autre champ.
- « courbatures » : entier de 0 (aucune) à 10 (maximales). « malade » : true ou false. « note » : texte de 2000 caractères au plus.
- N'invente aucune valeur : omets le champ si l'information n'est pas dans le document.`;

const ENTRY_EXAMPLE = `{
  "version": 1,
  "saisies": [
    { "date": "2026-10-24", "courbatures": 2, "malade": false },
    { "date": "2026-10-25", "courbatures": 6, "note": "Descente technique, quadriceps douloureux" }
  ]
}`;

const ENTRY_FIELDS = ["date", "courbatures", "malade", "note"];

function checkEntries(doc: unknown): { errors: string[]; items: Record<string, unknown>[] } {
  const errors: string[] = [];
  checkRoot(doc, ["saisies"], errors);
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  listOf(doc, "saisies", errors).forEach((raw, i) => {
    const where = `Saisie ${i + 1}`;
    if (!isObject(raw)) {
      errors.push(`${where} : doit être un objet JSON.`);
      return;
    }
    checkUnknownKeys(raw, ENTRY_FIELDS, where, errors);
    if (checkDate(raw.date, where, errors)) {
      if (seen.has(raw.date)) errors.push(`${where} : deux saisies pour le ${raw.date}.`);
      seen.add(raw.date);
    }
    checkInt(raw.courbatures, "courbatures", 0, 10, where, errors);
    if (raw.malade !== undefined && raw.malade !== null && typeof raw.malade !== "boolean") errors.push(`${where} : « malade » doit être true ou false.`);
    checkText(raw.note, "note", 2000, where, errors);
    items.push(raw);
  });
  return { errors, items };
}

const entrySpec: ImportSpec = {
  widgetId: "evening-entry",
  label: "Saisies du soir",
  format: "Courbatures, état de santé et note pour une ou plusieurs dates passées. Les champs absents ne sont pas modifiés.",
  prompt: `Transforme le document ci-joint (mon journal d'entraînement) en saisies du soir pour mon application Coach Trail.\n\n${ENTRY_FORMAT}`,
  coachSentence: `Peux-tu me renvoyer mes retours de ces jours-ci (courbatures de 0 à 10, malade ou non, une note) sous forme d'un JSON au format ci-dessous ?\n\n${ENTRY_EXAMPLE}`,
  example: ENTRY_EXAMPLE,
  sectionKeys: ["saisies"],
  rules: rulesOf(ENTRY_FORMAT),
  preview(doc) {
    const { errors, items } = checkEntries(doc);
    if (errors.length) return Promise.resolve({ errors, lines: [] });
    const lines = items.map((e) => {
      const bits = [
        typeof e.courbatures === "number" ? `courbatures ${e.courbatures}/10` : null,
        e.malade === true ? "malade" : e.malade === false ? "pas malade" : null,
        typeof e.note === "string" && e.note ? `note « ${e.note.slice(0, 40)}${e.note.length > 40 ? "…" : ""} »` : null,
      ].filter(Boolean);
      return `${formatDay(String(e.date))} — ${bits.join(", ") || "aucun champ"}`;
    });
    return Promise.resolve({ errors: [], lines });
  },
  async apply(doc, ctx) {
    const { items } = checkEntries(doc);
    for (const e of items) {
      const body: Record<string, unknown> = {};
      for (const key of ["courbatures", "malade", "note"] as const) if (e[key] !== undefined) body[key] = e[key];
      await putEntry(String(e.date), body);
    }
    await invalidateTraining(ctx.queryClient);
    return `${items.length} saisie(s) importée(s).`;
  },
};

// --- Objectif de course ------------------------------------------------------------------------

const GOAL_FORMAT = `Réponds uniquement avec un bloc de code JSON, sans commentaire autour, au format exact (version 1) :
{
  "version": 1,
  "objectifs": [
    { "nom": "Trail de Bruniquel", "date": "AAAA-MM-JJ", "distance_km": 39, "dplus_m": 1800, "priorite": 1 }
  ]
}

Règles :
- « nom » et « date » sont obligatoires. « distance_km » : nombre > 0. « dplus_m » : entier en mètres. « priorite » : 1 (course principale), 2 ou 3.
- Aucun autre champ. N'invente pas de distance ni de dénivelé : omets le champ si tu ne le connais pas.
- Les courses déjà présentes (même nom, même date) sont ignorées à l'import.`;

const GOAL_EXAMPLE = `{
  "version": 1,
  "objectifs": [
    { "nom": "Trail des 3 Rocs", "date": "2026-11-08", "distance_km": 31, "dplus_m": 1600, "priorite": 2 },
    { "nom": "Trail de Bruniquel", "date": "2027-02-14", "distance_km": 39, "priorite": 1 }
  ]
}`;

const GOAL_FIELDS = ["nom", "date", "distance_km", "dplus_m", "priorite"];

function checkGoals(doc: unknown): { errors: string[]; items: Record<string, unknown>[] } {
  const errors: string[] = [];
  checkRoot(doc, ["objectifs"], errors);
  const items: Record<string, unknown>[] = [];
  listOf(doc, "objectifs", errors).forEach((raw, i) => {
    const where = `Objectif ${i + 1}`;
    if (!isObject(raw)) {
      errors.push(`${where} : doit être un objet JSON.`);
      return;
    }
    checkUnknownKeys(raw, GOAL_FIELDS, where, errors);
    if (typeof raw.nom !== "string" || !raw.nom.trim() || raw.nom.length > 200) errors.push(`${where} : « nom » est obligatoire (200 caractères au plus).`);
    checkDate(raw.date, where, errors);
    checkNumber(raw.distance_km, "distance_km", 0.1, 1000, where, errors);
    checkInt(raw.dplus_m, "dplus_m", 0, 20000, where, errors);
    checkInt(raw.priorite, "priorite", 1, 3, where, errors);
    items.push(raw);
  });
  return { errors, items };
}

async function newGoals(items: Record<string, unknown>[]) {
  const existing = await fetchGoals();
  const key = (nom: unknown, date: unknown) => `${String(nom).trim().toLowerCase()}|${String(date)}`;
  const known = new Set(existing.map((g) => key(g.nom, g.date)));
  return items.map((g) => ({ goal: g, known: known.has(key(g.nom, g.date)) }));
}

const goalSpec: ImportSpec = {
  widgetId: "race-goal",
  label: "Courses",
  format: "Une ou plusieurs courses cibles (nom, date, distance, dénivelé, priorité). Les doublons sont ignorés.",
  prompt: `Extrais du document ci-joint mes courses à venir pour mon application Coach Trail.\n\n${GOAL_FORMAT}`,
  coachSentence: `Peux-tu me renvoyer mes courses de la saison (nom, date, distance, dénivelé) sous forme d'un JSON au format ci-dessous ?\n\n${GOAL_EXAMPLE}`,
  example: GOAL_EXAMPLE,
  sectionKeys: ["objectifs", "courses"],
  rules: rulesOf(GOAL_FORMAT),
  async preview(doc) {
    const { errors, items } = checkGoals(doc);
    if (errors.length) return { errors, lines: [] };
    const rows = await newGoals(items);
    const lines = rows.map(
      ({ goal, known }) => `${String(goal.nom)} — ${formatDay(String(goal.date))} : ${known ? "déjà présente, ignorée" : "sera créée"}`,
    );
    return { errors: [], lines, nothingToDo: rows.every((r) => r.known) };
  },
  async apply(doc, ctx) {
    const { items } = checkGoals(doc);
    const rows = (await newGoals(items)).filter((r) => !r.known);
    for (const { goal } of rows) {
      await createGoal({
        nom: String(goal.nom).trim(),
        date: String(goal.date),
        distance_km: (goal.distance_km as number | undefined) ?? null,
        dplus_m: (goal.dplus_m as number | undefined) ?? null,
        priorite: (goal.priorite as number | undefined) ?? 1,
      });
    }
    await Promise.all([ctx.queryClient.invalidateQueries({ queryKey: ["goals"] }), ctx.queryClient.invalidateQueries({ queryKey: ["race-goal"] })]);
    return `${rows.length} course(s) créée(s).`;
  },
};

// --- Matériel ----------------------------------------------------------------------------------

const GEAR_FORMAT = `Réponds uniquement avec un bloc de code JSON, sans commentaire autour, au format exact (version 1) :
{
  "version": 1,
  "materiel": [
    { "nom": "Hoka Speedgoat 6", "seuil_km": 800, "km_initial": 120 }
  ]
}

Règles :
- « nom » est obligatoire (80 caractères au plus). « seuil_km » : entier de 50 à 5000 (usure, 800 par défaut). « km_initial » : kilomètres déjà parcourus avant l'appli (0 par défaut).
- Aucun autre champ. Les paires déjà enregistrées (même nom) sont ignorées.`;

const GEAR_EXAMPLE = `{
  "version": 1,
  "materiel": [
    { "nom": "Hoka Speedgoat 6", "seuil_km": 800, "km_initial": 120 },
    { "nom": "Salomon Sense Ride", "km_initial": 340 }
  ]
}`;

const GEAR_FIELDS = ["nom", "seuil_km", "km_initial"];

function checkGear(doc: unknown): { errors: string[]; items: Record<string, unknown>[] } {
  const errors: string[] = [];
  checkRoot(doc, ["materiel"], errors);
  const items: Record<string, unknown>[] = [];
  listOf(doc, "materiel", errors).forEach((raw, i) => {
    const where = `Paire ${i + 1}`;
    if (!isObject(raw)) {
      errors.push(`${where} : doit être un objet JSON.`);
      return;
    }
    checkUnknownKeys(raw, GEAR_FIELDS, where, errors);
    if (typeof raw.nom !== "string" || !raw.nom.trim() || raw.nom.length > 80) errors.push(`${where} : « nom » est obligatoire (80 caractères au plus).`);
    checkInt(raw.seuil_km, "seuil_km", 50, 5000, where, errors);
    checkNumber(raw.km_initial, "km_initial", 0, 20000, where, errors);
    items.push(raw);
  });
  return { errors, items };
}

async function newGear(items: Record<string, unknown>[]) {
  const report = await fetchGear();
  const known = new Set(report.items.filter((g) => g.registered).map((g) => g.nom.trim().toLowerCase()));
  return items.map((g) => ({ gear: g, known: known.has(String(g.nom).trim().toLowerCase()) }));
}

const gearSpec: ImportSpec = {
  widgetId: "gear",
  label: "Paires de chaussures",
  format: "Des paires avec leur seuil d'usure et leur kilométrage de départ. Les paires déjà enregistrées sont ignorées.",
  prompt: `Extrais du document ci-joint mes paires de chaussures de course pour mon application Coach Trail.\n\n${GEAR_FORMAT}`,
  coachSentence: `Peux-tu me renvoyer mes paires de chaussures (nom, kilomètres déjà parcourus, seuil d'usure) sous forme d'un JSON au format ci-dessous ?\n\n${GEAR_EXAMPLE}`,
  example: GEAR_EXAMPLE,
  sectionKeys: ["materiel"],
  rules: rulesOf(GEAR_FORMAT),
  async preview(doc) {
    const { errors, items } = checkGear(doc);
    if (errors.length) return { errors, lines: [] };
    const rows = await newGear(items);
    return {
      errors: [],
      lines: rows.map(({ gear, known }) => `${String(gear.nom)} : ${known ? "déjà enregistrée, ignorée" : "sera créée"}`),
      nothingToDo: rows.every((r) => r.known),
    };
  },
  async apply(doc, ctx) {
    const { items } = checkGear(doc);
    const rows = (await newGear(items)).filter((r) => !r.known);
    for (const { gear } of rows) {
      await createGear({
        nom: String(gear.nom).trim(),
        seuil_km: (gear.seuil_km as number | undefined) ?? 800,
        km_initial: (gear.km_initial as number | undefined) ?? 0,
      });
    }
    await ctx.queryClient.invalidateQueries({ queryKey: ["gear"] });
    return `${rows.length} paire(s) créée(s).`;
  },
};

// --- Note libre --------------------------------------------------------------------------------

const NOTE_FORMAT = `Réponds uniquement avec le texte de la note, en markdown simple (titres #, listes -, liens), sans bloc de code ni commentaire autour.
Alternative acceptée : un JSON { "version": 1, "texte": "…" }. La note importée remplace la note actuelle du widget (8000 caractères au plus).`;

const NOTE_EXAMPLE = `# Consignes de la semaine
- 80 % du temps en zones 1-2
- Dimanche : sortie longue, 60 g de glucides par heure
- Pas de fractionné si les courbatures dépassent 6/10`;

function noteText(doc: unknown): string | null {
  if (typeof doc === "string") return doc;
  if (isObject(doc) && typeof doc.texte === "string") return doc.texte;
  return null;
}

const noteSpec: ImportSpec = {
  widgetId: "note",
  label: "Texte de la note",
  format: "Du texte markdown, ou un JSON { \"texte\": \"…\" }. Remplace la note actuelle.",
  prompt: `Rédige pour mon application Coach Trail une note à partir du document ci-joint.\n\n${NOTE_FORMAT}`,
  coachSentence: `Peux-tu me renvoyer tes consignes en texte simple (titres, listes) que je colle dans mon appli ?\n\n${NOTE_EXAMPLE}`,
  example: NOTE_EXAMPLE,
  sectionKeys: ["note", "texte"],
  rules: "",
  plainText: true,
  preview(doc): Promise<ImportPreview> {
    const text = noteText(doc);
    if (text === null) return Promise.resolve({ errors: ["Le fichier doit être un texte, ou un JSON avec un champ « texte »."], lines: [] });
    if (text.length > 8000) return Promise.resolve({ errors: ["La note dépasse 8000 caractères."], lines: [] });
    if (!text.trim()) return Promise.resolve({ errors: ["La note est vide."], lines: [] });
    return Promise.resolve({ errors: [], lines: [`${text.length} caractères — la note actuelle sera remplacée.`] });
  },
  apply(doc, ctx: ImportContext) {
    ctx.updateSettings?.({ text: noteText(doc) ?? "" });
    return Promise.resolve("Note importée.");
  },
};

const SPECS: ImportSpec[] = [planSpec, entrySpec, goalSpec, gearSpec, noteSpec];

export function getImportSpec(widgetId: string): ImportSpec | undefined {
  return SPECS.find((s) => s.widgetId === widgetId);
}

export function listImportSpecs(): ImportSpec[] {
  return SPECS;
}

/** Lundi proposé par défaut pour une semaine type : la semaine en cours. */
export const defaultWeekStart = (): string => mondayOf(todayLocal());
