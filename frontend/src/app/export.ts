import { fetchActivityExport, fetchExportText, type ExportFormat, type ExportPeriod } from "../api/endpoints";
import type { WidgetDefinition, WidgetSettings } from "../widgets/types";

export type ExportResult = { ok: true; chars: number } | { ok: false; reason: "empty" | "failed" | "clipboard" };

/** Copie via l'API moderne, sinon via un textarea temporaire (contexte non sécurisé, Safari après un await). */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if ("clipboard" in navigator) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refus du navigateur : repli ci-dessous
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  area.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- seul repli hors contexte sécurisé
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

async function copy(markdown: string): Promise<ExportResult> {
  if (!markdown.trim()) return { ok: false, reason: "empty" };
  if (!(await writeClipboard(markdown))) return { ok: false, reason: "clipboard" };
  return { ok: true, chars: markdown.length };
}

/** Export global (bouton « Copier pour Claude ») : le texte de la période est copié. */
export async function exportPeriod(
  period: ExportPeriod,
  format: ExportFormat = "md",
  series = "activities",
): Promise<ExportResult> {
  try {
    return await copy(await fetchExportText(period, format, series));
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Export d'une séance (bouton de la ligne ou du détail). */
export async function exportActivity(id: number): Promise<ExportResult> {
  try {
    return await copy(await fetchActivityExport(id));
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Export d'un widget (bouton du cadre) : son Markdown, formaté par le registre, est copié. */
export async function exportWidget(
  definition: WidgetDefinition,
  settings: WidgetSettings,
): Promise<ExportResult> {
  try {
    const block = await definition.exportData(settings);
    return block ? await copy(block.markdown) : { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
