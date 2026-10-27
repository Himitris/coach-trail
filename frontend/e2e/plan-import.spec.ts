import { expect, test } from "@playwright/test";

/** Le plan d'exemple (même format que celui demandé à Claude) s'importe sans erreur, de façon idempotente. */
test("import du plan d'exemple : aperçu, confirmation, puis réimport sans changement", async ({ page, request }) => {
  const example = "../docs/plan-exemple.json"; // Playwright tourne depuis frontend/
  await page.goto("/plan/import"); // ancienne adresse : redirigée vers l'import unique
  await expect(page).toHaveURL(/\/importer$/);
  await expect(page.getByRole("heading", { name: "Importer", level: 1 })).toBeVisible();
  await page.getByLabel("Fichier à importer").setInputFiles(example);
  await expect(page.getByText(/Nouveau plan : « Fin de préparation – Trail des 3 Rocs »/)).toBeVisible();
  await expect(page.locator(".import-preview li")).toHaveCount(4);
  await expect(page.getByText(/Rien n'est encore enregistré|rien n'est encore enregistré/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmer l'import" }).click();
  await expect(page.getByText(/Plan importé : 4 séance\(s\) ajoutée\(s\)/).first()).toBeVisible();

  const planned = (await (await request.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30")).json()) as { date: string; plan_nom: string }[];
  expect(planned.map((p) => p.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-08"]);
  expect(new Set(planned.map((p) => p.plan_nom))).toEqual(new Set(["Fin de préparation – Trail des 3 Rocs"]));

  await page.goto("/importer");
  await page.getByLabel("Fichier à importer").setInputFiles(example);
  await expect(page.getByText(/Plan existant mis à jour/)).toBeVisible();
  await expect(page.getByText(/Rien à changer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
});

test("l'import unique accepte plusieurs sections et affiche un aperçu par section", async ({ page }) => {
  await page.goto("/importer");
  const doc = {
    version: 2,
    saisies: [{ date: "2026-10-24", courbatures: 2 }],
    materiel: [{ nom: "Paire e2e unique", km_initial: 10 }],
  };
  await page.getByRole("textbox", { name: /collez la réponse/ }).fill(JSON.stringify(doc));
  await expect(page.getByRole("region", { name: "Saisies du soir" })).toContainText("courbatures 2/10");
  await expect(page.getByRole("region", { name: "Paires de chaussures" })).toContainText("sera créée");
  await page.screenshot({ path: "test-results/import-multi.png", fullPage: true });
  await page.getByRole("checkbox", { name: "Importer : Paires de chaussures" }).uncheck();
  await page.getByRole("button", { name: "Confirmer l'import" }).click();
  await expect(page.getByText(/1 saisie\(s\) importée\(s\)\./).first()).toBeVisible();
});
