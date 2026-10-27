import { expect, test, type Page } from "@playwright/test";

/** Calendrier : navigation semaine/mois, détail d'un jour, clavier, bureau et téléphone (captures dans test-results/). */
test.describe.configure({ mode: "serial" });

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("le calendrier navigue de semaine en semaine et de mois en mois, avec détail et clavier", async ({ page, request }) => {
  const goal = (await (await request.post("/api/goals", { data: { nom: "Course cal e2e", date: "2027-03-14", distance_km: 30 } })).json()) as { id: number };
  const sessions = [
    { date: "2027-03-01", type: "footing", titre: "Footing lundi", duree_min: 45, consignes: "Facile." },
    { date: "2027-03-03", type: "seuil", titre: "Seuil mercredi", duree_min: 60 },
    { date: "2027-03-10", type: "longue", titre: "Sortie longue", duree_min: 150, objectif: "Endurance" },
    { date: "2027-03-14", type: "course", titre: "Jour J" },
  ];
  const imported = await request.post("/api/plan/import?dry_run=false", { data: { version: 2, plan: { nom: "Plan cal e2e", course: "Course cal e2e" }, sessions } });
  expect(imported.ok()).toBe(true);

  await page.goto("/calendrier?vue=semaine&date=2027-03-02");
  await expect(page.getByRole("heading", { level: 2, name: /Semaine du 1 mars au 7 mars/ })).toBeVisible();
  await expect(page.getByRole("gridcell")).toHaveCount(7);
  await expect(page.getByRole("gridcell", { name: /Footing lundi/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Légende" }).getByText("Plan cal e2e")).toBeVisible();

  // détail d'un jour au clic, puis déplacement au clavier
  await page.getByRole("gridcell", { name: /mer\. 3 mars/ }).click();
  const detail = page.getByRole("region", { name: /Détail du/ });
  await expect(detail.getByText("Seuil mercredi")).toBeVisible();
  await expect(detail.getByText(/plan : Plan cal e2e/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("gridcell", { name: /mar\. 2 mars/ })).toHaveAttribute("aria-selected", "true");

  await page.screenshot({ path: "test-results/calendar-week-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Semaine du 8 mars au 14 mars/ })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: /Sortie longue/ })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: /course : Course cal e2e/ })).toBeVisible();

  await page.getByRole("button", { name: "Mois", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "mars 2027" })).toBeVisible();
  await expect(page.getByRole("gridcell")).toHaveCount(35);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/calendar-month-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Mois suivant" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "avril 2027" })).toBeVisible();
  await page.getByRole("button", { name: "Mois précédent" }).click();
  await expect(page.getByRole("gridcell", { name: /Footing lundi/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("gridcell", { name: /Footing lundi/ })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/calendar-month-mobile.png", fullPage: true });

  const plans = (await (await request.get("/api/plans")).json()) as { id: number; nom: string }[];
  for (const plan of plans.filter((p) => p.nom === "Plan cal e2e")) await request.delete(`/api/plans/${plan.id}`);
  await request.delete(`/api/goals/${goal.id}`);
});
