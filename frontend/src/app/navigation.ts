/** Navigation hors de l'application (retour OAuth) ; isolée pour pouvoir être simulée dans les tests. */
export const navigateExternal = (url: string): void => {
  window.location.assign(url);
};
