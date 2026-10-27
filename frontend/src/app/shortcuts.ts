import { useEffect } from "react";

/** Vrai si la cible est un champ de saisie (les raccourcis ne doivent pas gêner la frappe). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Rangée AZERTY du haut, sans Maj : pages 1 à 10 (le pavé numérique et la rangée chiffres 1–9 restent valables). */
export const AZERTY_KEYS = ["&", "é", '"', "'", "(", "-", "è", "_", "ç", "à"] as const;

/** Libellé de la touche de la page `index` (base 0) pour l'onglet, ou null au-delà de 10 pages. */
export function shortcutLabel(index: number): string | null {
  return AZERTY_KEYS[index] ?? null;
}

/**
 * Raccourcis : 1 à 9 (pavé numérique ou rangée chiffres) et & é " ' ( - è _ ç à ; renvoie l'index
 * (base 0) de la page visée, ou null si la touche ne correspond pas à une page, si un modificateur
 * est enfoncé ou si l'on est en train de saisir du texte.
 */
export function pageIndexForKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target" | "repeat">,
  pageCount: number,
): number | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return null;
  if (isTypingTarget(event.target)) return null;
  const azerty = (AZERTY_KEYS as readonly string[]).indexOf(event.key);
  const index = azerty >= 0 ? azerty : /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
  return index >= 0 && index < pageCount ? index : null;
}

export function usePageShortcuts(pageCount: number, goTo: (index: number) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const index = pageIndexForKey(event, pageCount);
      if (index !== null) {
        event.preventDefault();
        goTo(index);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pageCount, goTo]);
}
