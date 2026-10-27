import type { QueryClient } from "@tanstack/react-query";

export interface ImportContext {
  queryClient: QueryClient;
  /** Lundi (AAAA-MM-JJ) de la semaine à remplir, pour une « semaine type ». */
  weekStart?: string;
  /** Confirmation explicite pour modifier des jours passés déjà réalisés. */
  confirmPast?: boolean;
  /** Réglages du widget d'où part l'import (note libre). */
  updateSettings?: (patch: Record<string, unknown>) => void;
}

export interface ImportPreview {
  /** Erreurs bloquantes, lisibles : tant qu'il y en a, rien ne peut être enregistré. */
  errors: string[];
  /** Ce qui sera fait, une ligne par élément. */
  lines: string[];
  /** Jours passés déjà réalisés ou appartenant à un autre plan, bloqués tant que `confirmPast` n'est pas coché. */
  blocked?: number;
  /** Nombre de créations ou remplacements possibles sans confirmation. */
  changes?: number;
  /** Rien à changer : l'import serait sans effet. */
  nothingToDo?: boolean;
  /** Informations utiles avant de confirmer (plan visé, course liée, avertissements). */
  notes?: string[];
}

/** Un format d'import : sert au panneau « Importer » des widgets et à la page Documentation. */
export interface ImportSpec {
  widgetId: string;
  /** Nom court du jeu de données importé. */
  label: string;
  /** Phrase de description du format. */
  format: string;
  /** Prompt complet à coller dans Claude pour obtenir le format exact. */
  prompt: string;
  /** Phrase à envoyer au coach (ou à Claude) avec le document source, format inclus. */
  coachSentence: string;
  /** Exemple valide, affiché et copiable. */
  example: string;
  /** Le fichier peut décrire une semaine type (jours de la semaine, sans dates). */
  weekTemplate?: boolean;
  /** Texte brut accepté en plus du JSON (note libre). */
  plainText?: boolean;
  /** Clés racine qui désignent ce jeu de données dans un document multi-sections. */
  sectionKeys: readonly string[];
  /** Règles du format, reprises dans le prompt d'import unique. */
  rules: string;
  preview: (doc: unknown, ctx: ImportContext) => Promise<ImportPreview>;
  apply: (doc: unknown, ctx: ImportContext) => Promise<string>;
}
