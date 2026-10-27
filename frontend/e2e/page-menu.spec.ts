import { expect, test } from "@playwright/test";

test("le menu ⋯ d'une page s'affiche en entier et supprime la page ; les touches AZERTY changent de page", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle page" }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Actions de la page/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const delete_ = menu.getByRole("menuitem", { name: "Supprimer" });
  await expect(delete_).toBeInViewport({ ratio: 1 });
  // L'élément du dessus au centre du bouton « Supprimer » est bien le menu (pas rogné par la barre).
  const onTop = await delete_.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(onTop).toBe(true);
  await page.keyboard.press("Escape");

  // Le clavier simulé n'a pas de touches AZERTY : on émet l'événement tel que le navigateur le produit.
  const press = (key: string) => page.evaluate((k) => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); }, key);
  await press("&");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await press("é");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: /Actions de la page/ }).click();
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
});
