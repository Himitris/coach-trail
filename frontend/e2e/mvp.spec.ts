import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Parcours de recette de la phase 1, dans l'ordre : chaque test s'appuie sur l'état du précédent. */
test.describe.configure({ mode: "serial" });

const activityCount = async (request: APIRequestContext): Promise<number> => {
  const response = await request.get("/api/activities?limit=200");
  return ((await response.json()) as unknown[]).length;
};

async function syncFromUi(page: Page) {
  await page.goto("/sources");
  const button = page.getByRole("button", { name: /Synchroniser maintenant|Synchronisation en cours/ });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("Synchronisation lancée.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Synchroniser maintenant" })).toBeEnabled();
  await expect(page.getByText("À jour", { exact: true }).first()).toBeVisible();
}

test("la synchronisation relancée deux fois ne crée aucun doublon", async ({ page, request }) => {
  await expect.poll(() => activityCount(request)).toBe(0);

  await syncFromUi(page);
  const first = await activityCount(request);
  expect(first).toBeGreaterThanOrEqual(10);
  const wellness = (await (await request.get("/api/metrics/wellness?days=365")).json()) as {
    points: unknown[];
  };
  expect(wellness.points.length).toBeGreaterThanOrEqual(60);

  await syncFromUi(page);
  expect(await activityCount(request)).toBe(first);
  const again = (await (await request.get("/api/metrics/wellness?days=365")).json()) as {
    points: unknown[];
  };
  expect(again.points.length).toBe(wellness.points.length);
  await expect(page.getByLabel("Sauvegardes")).toBeVisible();
});

test("l'accueil montre semaine, charge, dernières sorties et récupération", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/p\//);
  for (const title of [
    "Programme de la semaine",
    "Charge de la semaine",
    "Dernières sorties",
    "Récupération",
    "Saisie du soir",
  ]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  const recent = page.locator("article", { has: page.getByRole("heading", { name: "Dernières sorties" }) });
  await expect(recent.getByRole("button", { name: /^Détail :/ }).first()).toBeVisible();
  expect(await recent.getByRole("button", { name: /^Détail :/ }).count()).toBe(
    Math.min(7, await activityCount(request)),
  );

  const load = page.locator("article", { has: page.getByRole("heading", { name: "Charge de la semaine" }) });
  await expect(load).toContainText("Temps");
  await expect(load).toContainText("Moyenne 4 sem.");

  const recovery = page.locator("article", { has: page.getByRole("heading", { name: "Récupération" }) });
  await expect(recovery).toContainText("HRV");
  await expect(recovery).toContainText("avis Garmin, non validé");
});

test("la saisie du soir est enregistrée et survit au rechargement", async ({ page, request }) => {
  await page.goto("/");
  const entry = page.locator("article", { has: page.getByRole("heading", { name: "Saisie du soir" }) });
  await entry.getByRole("button", { name: /Effort perçu \(RPE\).* : 7$/ }).first().click();
  await expect(entry.getByText("Enregistré ✓")).toBeVisible();
  await entry.getByRole("button", { name: /Courbatures : 3$/ }).click();
  await entry.getByRole("button", { name: "Malade" }).click();
  await expect(entry.getByRole("button", { name: "Malade" })).toHaveAttribute("aria-pressed", "true");
  await entry.getByLabel("Note").fill("Jambes lourdes");
  await entry.getByLabel("Note").blur();
  await expect(entry.getByText("Enregistré ✓")).toBeVisible();

  await page.reload();
  const again = page.locator("article", { has: page.getByRole("heading", { name: "Saisie du soir" }) });
  await expect(again.getByRole("button", { name: /Effort perçu \(RPE\).* : 7$/ }).first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(again.getByLabel("Note")).toHaveValue("Jambes lourdes");

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const saved = (await (await request.get(`/api/entries?from=${today}&to=${today}`)).json()) as {
    courbatures: number | null;
    malade: boolean | null;
    note: string | null;
    sessions: { rpe: number }[];
  }[];
  expect(saved[0]).toMatchObject({ courbatures: 3, malade: true, note: "Jambes lourdes" });
  expect(saved[0]?.sessions[0]?.rpe).toBe(7);
});

test("l'export « Copier pour Claude » tient en deux clics", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Copier pour Claude" }).click(); // clic 1
  await page.getByRole("dialog", { name: "Copier pour Claude" }).getByRole("button", { name: "Copier" }).click(); // clic 2
  await expect(page.getByText(/Export copié pour Claude/)).toBeVisible();

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("# Coach Trail — export");
  for (const section of ["## Profil athlète", "## Récupération", "## Glossaire des métriques", "## Limites et sources"]) {
    expect(text).toContain(section);
  }
  expect(text).toContain("Jambes lourdes"); // la saisie du soir est dans l'export
  expect(text).toContain("RPE 7/10");
  expect(text.length).toBeLessThan(60_000);
});
