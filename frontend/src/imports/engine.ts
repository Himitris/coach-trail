import { getImportSpec, listImportSpecs, PLAN_TYPES } from "./specs";
import type { ImportSpec } from "./types";

/** Un jeu de données à importer : son format, et la partie du document qui le décrit. */
export interface Section {
  spec: ImportSpec;
  doc: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Sections reconnues dans un document, hors note (qui se saisit depuis le widget Note). */
const GLOBAL_SPECS = (): ImportSpec[] => listImportSpecs().filter((s) => s.widgetId !== "note");
const KNOWN_KEYS = (): string[] => GLOBAL_SPECS().flatMap((s) => [...s.sectionKeys]);

/**
 * Découpe un document en sections : un plan (`plan` + `sessions`, `semaine_type` ou simple liste de
 * séances), des courses (`objectifs`), des saisies, du matériel. Chaque section passe ensuite par le
 * même contrôle et le même aperçu que l'import d'un widget.
 */
export function splitDocument(doc: unknown): { sections: Section[]; errors: string[] } {
  const plan = getImportSpec("week-plan");
  if (!plan) return { sections: [], errors: ["Import indisponible."] };
  if (Array.isArray(doc)) return { sections: [{ spec: plan, doc }], errors: [] };
  if (!isObject(doc)) return { sections: [], errors: ["Le document doit être un objet JSON (ou une liste de séances)."] };

  const errors: string[] = [];
  if (doc.version !== undefined && doc.version !== 1 && doc.version !== 2) {
    errors.push(`Version non prise en charge : ${JSON.stringify(doc.version)} (attendues : 1 ou 2).`);
  }
  const known = KNOWN_KEYS();
  for (const key of Object.keys(doc)) {
    if (key === "version") continue;
    if (key === "note" || key === "texte") {
      errors.push("La note libre s'importe depuis le widget Note (bouton ⤒) : elle remplace le texte de ce widget.");
    } else if (!known.includes(key)) {
      errors.push(`Champ inconnu « ${key} » à la racine (sections reconnues : ${known.join(", ")}).`);
    }
  }

  const sections: Section[] = [];
  for (const spec of GLOBAL_SPECS()) {
    const keys = spec.sectionKeys.filter((k) => doc[k] !== undefined);
    if (keys.length === 0) continue;
    if (spec.widgetId === "week-plan") {
      const part: Record<string, unknown> = {};
      for (const k of keys) part[k] = doc[k];
      part.version = doc.version ?? (doc.plan === undefined ? 1 : 2);
      sections.push({ spec, doc: part });
    } else {
      if (keys.length > 1) errors.push(`Une seule clé parmi ${spec.sectionKeys.join(" / ")} est permise.`);
      // « courses » est un synonyme de « objectifs » : le contrôle du format ne connaît que la clé canonique.
      sections.push({ spec, doc: { version: 1, [spec.sectionKeys[0] ?? ""]: doc[keys[0] ?? ""] } });
    }
  }
  if (sections.length === 0 && errors.length === 0) {
    errors.push(`Le document ne contient aucune section à importer (sections reconnues : ${known.join(", ")}).`);
  }
  return { sections, errors };
}

/** Plan visé par un document de plan : `plan` seul (sans séances) n'a pas de sens. */
export const hasSections = (doc: unknown): boolean => splitDocument(doc).sections.length > 0;

// --- prompt d'import unique ---------------------------------------------------------------------

export const GLOBAL_EXAMPLE = `{
  "version": 2,
  "plan": { "nom": "Fin de prépa 3 Rocs", "course": "Trail des 3 Rocs" },
  "sessions": [
    { "date": "2026-11-03", "type": "footing", "duree_min": 50, "zone_cible": "1-2", "dplus_cible": 80 },
    { "date": "2026-11-05", "type": "seuil", "titre": "Seuil 3 × 8 min", "duree_min": 70, "zone_cible": "3-4" },
    { "date": "2026-11-08", "type": "course", "titre": "Trail des 3 Rocs" }
  ],
  "objectifs": [
    { "nom": "Trail de Bruniquel", "date": "2027-02-14", "distance_km": 39, "priorite": 1 }
  ],
  "saisies": [
    { "date": "2026-10-25", "courbatures": 6, "note": "Descente technique, quadriceps douloureux" }
  ],
  "materiel": [
    { "nom": "Hoka Speedgoat 6", "seuil_km": 800, "km_initial": 120 }
  ]
}`;

/** Précisions propres à l'import unique (les règles de chaque format renvoient à « ci-dessus »). */
const SECTION_NOTES: Record<string, string> = {
  "week-plan": `Précisions : chaque séance de « sessions » a les champs date, type, titre, duree_min, zone_cible, dplus_cible, objectif, consignes. « type » vaut exactement : ${PLAN_TYPES}. Utilise toujours « date » (jamais « jour » ni « semaine_type » dans ce fichier).`,
};

const SECTION_TITLES: Record<string, string> = {
  "week-plan": "Plan : clés « plan » et « sessions » (ou « semaine_type »)",
  "race-goal": "Courses : clé « objectifs »",
  "evening-entry": "Saisies du soir : clé « saisies »",
  gear: "Matériel : clé « materiel »",
  strength: "Renforcement : clé « renfo »",
  fueling: "Nutrition en course : clé « nutrition »",
};

/** Le prompt unique à donner au coach : un seul format pour tous les imports. */
export function buildGlobalPrompt(): string {
  const sections = GLOBAL_SPECS()
    .map((spec) => {
      const note = SECTION_NOTES[spec.widgetId];
      return `### ${SECTION_TITLES[spec.widgetId] ?? spec.label}\n${spec.format}\nRègles :\n${spec.rules}${note ? `\n${note}` : ""}`;
    })
    .join("\n\n");
  return `Tu es mon entraîneur de trail. Transforme le document ci-joint (plan, courses, retours, matériel) en un seul fichier JSON pour mon application Coach Trail.

Réponds uniquement avec un bloc de code JSON, sans commentaire autour. N'inclus que les sections utiles (au moins une) ; n'invente rien : omets ce qui n'est pas dans le document. La racine ne contient que « version » (2) et ces sections :

${sections}

Exemple complet :
${GLOBAL_EXAMPLE}`;
}

export const GLOBAL_COACH_SENTENCE = `Peux-tu me renvoyer ce plan (et, si besoin, mes courses, retours et chaussures) sous forme d'un seul fichier JSON, au format ci-dessous, que je colle dans mon appli ? Ne garde que les sections utiles.\n\n${GLOBAL_EXAMPLE}`;
