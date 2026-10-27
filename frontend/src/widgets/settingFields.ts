import type { SettingField } from "./types";

/** Réglages usuels, réutilisés par les widgets de métriques (période, sport, métrique). */

export const periodField = (
  options: readonly { value: string; label: string }[] = [
    { value: "4w", label: "4 semaines" },
    { value: "8w", label: "8 semaines" },
    { value: "12w", label: "12 semaines" },
    { value: "26w", label: "6 mois" },
  ],
): SettingField => ({ key: "period", label: "Période", type: "select", options });

export const sportField = (): SettingField => ({
  key: "sport",
  label: "Sport",
  type: "select",
  options: [
    { value: "all", label: "Tous les sports" },
    { value: "run", label: "Course à pied" },
    { value: "trail", label: "Trail" },
    { value: "other", label: "Autres" },
  ],
});

export const metricField = (options: readonly { value: string; label: string }[]): SettingField => ({
  key: "metric",
  label: "Métrique",
  type: "select",
  options,
});
