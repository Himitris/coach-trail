import { expect, test, type Page } from "@playwright/test";

/** Page d'exemple « Course » : vérification visuelle bureau / téléphone (captures dans test-results/). */
test.describe.configure({ mode: "serial" });

const TITLES = ["Objectif de course", "Nutrition en course", "Fatigue musculaire", "Monotonie et tension"];

async function noHorizontalOverflow(page: Page) {
  const measure = () =>
    page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el.getBoundingClientRect().right > limit + 1 && !el.closest(".table-scroll, .tabs"))
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      return { overflow: document.documentElement.scrollWidth - limit, wide };
    });
  // la grille se recalcule après le redimensionnement : on attend qu'elle se stabilise
  await expect.poll(async () => (await measure()).wide, { message: "éléments qui dépassent de l'écran" }).toEqual([]);
  expect((await measure()).overflow).toBeLessThanOrEqual(1);
}

test("la page « Course » s'affiche sur ordinateur et sur téléphone", async ({ page, request }) => {
  await request.post("/api/sync/run");
  await expect.poll(async () => ((await (await request.get("/api/activities?limit=200")).json()) as unknown[]).length).toBeGreaterThan(5);

  await page.goto("/");
  await page.getByRole("button", { name: "+ Course" }).click();
  for (const title of TITLES) await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // la sortie longue de 4 h est proposée pour la nutrition, la saisie rapide fonctionne
  const fueling = page.locator("article", { has: page.getByRole("heading", { name: "Nutrition en course" }) });
  await fueling.getByRole("button", { name: "Saisir" }).click();
  await fueling.getByLabel("Glucides (g/h)").fill("72");
  await fueling.getByRole("button", { name: "Score digestif : 1" }).click();
  await fueling.getByRole("button", { name: "Enregistrer" }).click();
  await expect(fueling.getByText("72 g/h")).toBeVisible();

  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/course-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  for (const title of TITLES) await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/course-mobile.png", fullPage: true });
});
