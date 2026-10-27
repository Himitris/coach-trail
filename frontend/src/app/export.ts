import type { WidgetDefinition, WidgetSettings } from "../widgets/types";

export type ExportResult = { ok: true; chars: number } | { ok: false; reason: "empty" | "failed" };

/**
 * Export d'un widget (bouton du cadre). Pour l'instant : le Markdown du widget est copié dans le
 * presse-papiers. Le prompt 09 remplacera ceci par l'assemblage « Copier pour Claude ».
 */
export async function exportWidget(
  definition: WidgetDefinition,
  settings: WidgetSettings,
): Promise<ExportResult> {
  try {
    const block = await definition.exportData(settings);
    if (!block) return { ok: false, reason: "empty" };
    await navigator.clipboard.writeText(block.markdown);
    return { ok: true, chars: block.markdown.length };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
