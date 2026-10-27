import { expect, test } from "@playwright/test";

test("le manifeste décrit une appli installable avec ses icônes", async ({ request }) => {
  const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest.name).toBe("Coach Trail");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  const purposes = manifest.icons.map((i) => `${i.sizes}/${i.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192/any", "512x512/any", "192x192/maskable", "512x512/maskable"]));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
});

test("le service worker affiche l'appli hors ligne, sans jamais mettre en cache l'API de données", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Coach Trail" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // le service worker contrôle la page, le layout est mis en cache

  const cached = await page.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) keys.push(new URL(request.url).pathname);
    }
    return keys;
  });
  expect(cached).toContain("/");
  expect(cached.filter((p) => p.startsWith("/api/") && p !== "/api/layout")).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Hors ligne" })).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await context.setOffline(false);
});
