import { buildGlobalPrompt, GLOBAL_EXAMPLE } from "../imports/engine";
import { getImportSpec } from "../imports/specs";
import { listWidgets } from "../widgets";
import type { SettingField, WidgetDefinition } from "../widgets/types";

const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body}\n\`\`\``;

const display = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

function fieldLine(field: SettingField, defaults: Record<string, unknown>): string {
  const fallback = defaults[field.key];
  const shown = fallback === undefined || fallback === null || fallback === "" ? "aucun" : display(fallback);
  switch (field.type) {
    case "select":
      return `- ${field.label} (\`${field.key}\`) : ${field.options.map((o) => `\`${o.value}\` ${o.label}`).join(" · ")} — défaut : \`${shown}\``;
    case "number":
      return `- ${field.label} (\`${field.key}\`, nombre${field.min === undefined ? "" : ` de ${field.min}`}${field.max === undefined ? "" : ` à ${field.max}`}) — défaut : \`${shown}\``;
    case "boolean":
      return `- ${field.label} (\`${field.key}\`, oui/non) — défaut : \`${shown}\``;
    case "text":
      return `- ${field.label} (\`${field.key}\`, texte) — défaut : \`${shown}\``;
  }
}

/** Fiche Markdown d'un widget : contenu, réglages, export, et import avec son prompt et son exemple. */
export function widgetSheetMarkdown(widget: WidgetDefinition): string {
  const spec = getImportSpec(widget.id);
  const lines = [
    `## Widget « ${widget.title} » (\`${widget.id}\`)`,
    "",
    widget.description,
    "",
    `- Taille par défaut : ${widget.defaultSize.w}×${widget.defaultSize.h} (minimum ${widget.minSize.w}×${widget.minSize.h}) sur une grille de 12 colonnes.`,
    `- Réglages : ${widget.settingsSchema.length === 0 ? "aucun." : ""}`,
  ];
  for (const field of widget.settingsSchema) lines.push(`  ${fieldLine(field, widget.defaultSettings)}`);
  lines.push("- Export : bouton ⤓ du cadre (Markdown copié pour Claude) ; menu d'export du cadre (JSON / CSV).");
  lines.push(`- Import : ${spec ? `bouton ⤒ du cadre — ${spec.label}.` : "aucun (données calculées depuis Garmin ou Intervals.icu)."}`);
  if (spec) {
    lines.push("", `### Import « ${spec.label} »`, "", spec.format, "");
    lines.push("Prompt à donner à Claude avec le document source :", fence("text", spec.prompt), "");
    lines.push("Phrase pour le coach :", fence("text", spec.coachSentence), "");
    lines.push("Exemple valide :", fence(spec.plainText ? "markdown" : "json", spec.example));
  }
  return lines.join("\n");
}

/** Toute la documentation en un seul Markdown, à coller à un agent qui prépare des imports. */
export function fullDocMarkdown(): string {
  const widgets = listWidgets();
  return [
    "# Coach Trail — documentation pour un agent",
    "",
    "Coach Trail est un carnet de bord d'entraînement trail (un seul utilisateur, interface en français). Il affiche des widgets alimentés par Garmin (repli Intervals.icu) et garde les plans produits par le coach. Rien n'est envoyé à la montre ; les imports et exports se font toujours à la demande de l'utilisateur.",
    "",
    "## Principe d'un import",
    "",
    "1. L'agent produit un JSON versionné au format décrit plus bas, sans texte autour.",
    "2. L'utilisateur le colle (ou dépose le fichier) dans la page **Importer**.",
    "3. L'appli vérifie le format et affiche un aperçu **sans rien écrire** ; toute erreur est signalée en français avec la ligne concernée.",
    "4. L'utilisateur confirme une seule fois. Les jours passés déjà réalisés et les jours d'un autre plan ne sont jamais modifiés sans confirmation explicite.",
    "",
    "## Import unique (plan, courses, saisies, matériel)",
    "",
    "Un seul fichier peut contenir plusieurs sections (`plan` + `sessions`, `objectifs`, `saisies`, `materiel`). Chaque section est vérifiée séparément. Le format version 1 (sans bloc `plan`) reste accepté. La note libre s'importe uniquement depuis le widget Note.",
    "",
    "Prompt à donner à Claude avec le document source :",
    fence("text", buildGlobalPrompt()),
    "",
    "Exemple valide :",
    fence("json", GLOBAL_EXAMPLE),
    "",
    "## Pages",
    "",
    "- **Pages à widgets** (autant que voulu) : raccourcis `&` `é` `\"` `'` `(` `-` `è` `_` `ç` `à` ou 1 à 9 du pavé numérique.",
    "- **Courses** : les courses prévues et le plan attribué à chacune.",
    "- Menu ☰ (en haut à droite) : **Importer**, **Documentation**, **Sources** (santé de Garmin, Intervals.icu, Strava ; boutons « Synchroniser maintenant » et « Vérifier les nouveautés »).",
    "",
    "## Règles métriques",
    "",
    "Les composantes sont affichées avec leur tendance et un niveau de preuve, jamais de score unique maison. Pas d'alerte de blessure (ACWR au mieux grisé, « non validé »). HRV : moyenne 7 jours face à la base, sans feu vert/rouge. CTL/ATL/TSB : courbe de tendance, pas un verdict. Training Readiness et Body Battery : avis propriétaires de la montre.",
    "",
    `## Widgets (${widgets.length})`,
    "",
    widgets.map(widgetSheetMarkdown).join("\n\n"),
    "",
    "## Exports",
    "",
    "- **Copier pour Claude** (en-tête) : résumé Markdown d'une période (7 jours, 4 ou 12 semaines, plage libre), avec glossaire des niveaux de preuve ; formats Markdown, JSON versionné et CSV.",
    "- **⤓ sur chaque widget** : ses données en Markdown ; menu d'export : JSON / CSV.",
    "- Rien n'est envoyé automatiquement : l'utilisateur colle ou joint le résultat lui-même.",
    "",
  ].join("\n");
}
