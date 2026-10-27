import { fetchActivityExport, fetchExportMarkdown, type ExportPeriod } from "../api/endpoints";
import type { WidgetDefinition, WidgetSettings } from "../widgets/types";

export type ExportResult = { ok: true; chars: number } | { ok: false; reason: "empty" | "failed" };

async function copy(markdown: string): Promise<ExportResult> {
  if (!markdown.trim()) return { ok: false, reason: "empty" };
  await navigator.clipboard.writeText(markdown);
  return { ok: true, chars: markdown.length };
}

/** Export global (bouton « Copier pour Claude ») : le Markdown de la période est copié. */
export async function exportPeriod(period: ExportPeriod): Promise<ExportResult> {
  try {
    return await copy(await fetchExportMarkdown(period));
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
