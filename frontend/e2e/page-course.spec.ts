import { expect, test, type Page } from "@playwright/test";

/** Page Courses : plan attribué à une course, vérification visuelle bureau / téléphone (captures dans test-results/). */
test.describe.configure({ mode: "serial" });

async function noHorizontalOverflow(page: Page) {
  const measure = () =>
    page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => el.getBoundingClientRect().right > limit + 1 && !el.closest(".table-scroll, .tabs, .tabs-links"))
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      return { overflow: document.documentElement.scrollWidth - limit, wide };
    });
  // la grille se recalcule après le redimensionnement : on attend qu'elle se stabilise
  await expect.poll(async () => (await measure()).wide, { message: "éléments qui dépassent de l'écran" }).toEqual([]);
  expect((await measure()).overflow).toBeLessThanOrEqual(1);
}

test("la page Courses attribue un plan à une course, sur ordinateur et sur téléphone", async ({ page, request }) => {
  const goal = (await (await request.post("/api/goals", { data: { nom: "Course e2e", date: "2027-03-14", distance_km: 42, dplus_m: 2000 } })).json()) as { id: number };
  const doc = { version: 2, plan: { nom: "Plan e2e" }, sessions: [{ date: "2027-03-01", type: "footing", duree_min: 45 }, { date: "2027-03-03", type: "seuil" }] };
  const imported = await request.post("/api/plan/import?dry_run=false", { data: doc });
  expect(imported.ok()).toBe(true);

  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Courses", level: 1 })).toBeVisible();
  await expect(page.getByText("Plans sans course")).toBeVisible();
  await page.getByLabel("Attribuer à une course").selectOption(String(goal.id));
  const card = page.getByRole("article", { name: "Course e2e" });
  await expect(card.getByText("Plan e2e")).toBeVisible();
  await expect(card.getByText(/2 séance/)).toBeVisible();

  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/courses-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByText("Plan e2e")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/courses-mobile.png", fullPage: true });

  // nettoyage : le plan (séances comprises) puis la course
  const plans = (await (await request.get("/api/plans")).json()) as { id: number; nom: string }[];
  for (const plan of plans.filter((p) => p.nom === "Plan e2e")) await request.delete(`/api/plans/${plan.id}`);
  await request.delete(`/api/goals/${goal.id}`);
});
