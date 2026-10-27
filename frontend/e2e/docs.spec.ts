import { expect, test } from "@playwright/test";

/** Documentation : aperçu visuel d'un widget avec données d'exemple (captures dans test-results/). */
test("la fiche d'un widget montre un aperçu avec des données d'exemple", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/plan/week")) apiCalls.push(r.url()); });
  // /docs est aussi l'adresse de l'API interactive du serveur de test : on passe par l'onglet.
  await page.goto("/");
  await page.getByRole("link", { name: "Doc", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copier la doc pour mon agent" })).toBeVisible();
  apiCalls.length = 0; // l'accueil a déjà lu le programme réel ; seuls les appels de l'aperçu comptent
  await page.getByRole("article", { name: "Programme de la semaine" }).getByRole("button", { name: "Aperçu" }).click();
  const dialog = page.getByRole("dialog", { name: "Fiche : Programme de la semaine" });
  await expect(dialog.getByText("Données d'exemple")).toBeVisible();
  await expect(dialog.getByText("Footing facile", { exact: true })).toBeVisible();
  expect(apiCalls).toEqual([]); // données d'exemple : le serveur n'est pas interrogé
  await page.screenshot({ path: "test-results/docs-sheet.png", fullPage: false });
  await page.keyboard.press("Escape");

  await page.getByRole("article", { name: "Forme (CTL / ATL / TSB)" }).getByRole("button", { name: "Aperçu" }).click();
  const fitness = page.getByRole("dialog", { name: /Fiche : Forme/ });
  await expect(fitness.locator(".recharts-wrapper")).toBeVisible();
  await page.screenshot({ path: "test-results/docs-sheet-fitness.png", fullPage: false });
});
