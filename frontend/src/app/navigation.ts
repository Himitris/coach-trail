/** Navigation hors de l'application (retour OAuth) ; isolée pour pouvoir être simulée dans les tests. */
export const navigateExternal = (url: string): void => {
  window.location.assign(url);
};

/** Écrans hors tableau de bord : onglets fixes sur ordinateur, section « Outils » du menu sur téléphone. */
export const TOOLS = [
  { to: "/course", label: "Course", hint: "Jour J : plan de course, nutrition, veille et matin" },
  { to: "/courses", label: "Plans & courses", hint: "Courses et plans attribués" },
  { to: "/importer", label: "Importer", hint: "Plan, courses, saisies ou matériel produits par Claude" },
  { to: "/docs", label: "Documentation", hint: "Widgets, imports et prompts" },
  { to: "/sources", label: "Sources", hint: "Garmin, Intervals.icu, Strava, import FIT/GPX" },
] as const;

/** Un outil est actif sur son chemin exact ou un sous-chemin (« /course » ne doit pas activer « /courses »). */
export const toolActive = (pathname: string, to: string): boolean => pathname === to || pathname.startsWith(`${to}/`);
