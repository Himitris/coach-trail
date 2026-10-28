import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "coach-trail-theme";

const systemTheme = (): Theme =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Applique le thème choisi ; sans choix, le thème du système s'applique via la feuille de style. */
export function applyStoredTheme(): void {
  const theme = stored();
  if (theme) document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme());
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // stockage indisponible : le choix vaut pour cette session seulement
    }
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}
