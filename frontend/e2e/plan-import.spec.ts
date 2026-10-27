import { expect, test } from "@playwright/test";

/** Le plan d'exemple (même format que celui demandé à Claude) s'importe sans erreur, de façon idempotente. */
test("import du plan d'exemple : aperçu, confirmation, puis réimport sans changement", async ({ page, request }) => {
  const example = "../docs/plan-exemple.json"; // Playwright tourne depuis frontend/
  await page.goto("/plan/import");
  await page.getByLabel("Fichier du plan").setInputFiles(example);
  await expect(page.getByText(/Aperçu \(rien n'est enregistré\)/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Création/ })).toHaveCount(4);
  await page.getByRole("button", { name: "Confirmer l'import" }).click();
  await expect(page.getByText(/Plan enregistré/)).toBeVisible();

  const planned = (await (await request.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30")).json()) as { date: string }[];
  expect(planned.map((p) => p.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-08"]);

  await page.goto("/plan/import");
  await page.getByLabel("Fichier du plan").setInputFiles(example);
  await expect(page.getByText(/Rien à changer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
});
