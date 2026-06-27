import { test, expect, type Page } from "@playwright/test";

/**
 * Greenway Marijuana — core-journey smoke tests.
 *
 * Covered flows:
 *   1. Age gate appears and can be confirmed.
 *   2. Menu page loads and renders product cards.
 *   3. Add-to-cart works from a product detail page (cart launcher appears).
 *   4. Footer policy links navigate to the correct pages.
 *
 * Selectors prefer accessible roles / visible text so the tests stay resilient
 * to styling changes.
 */

const AGE_KEY = "greenway-age-confirmed-v1";

/** Confirm the 21+ age gate if it is showing. */
async function confirmAgeGate(page: Page) {
  const confirm = page.getByRole("button", { name: /Yes, I am 21\+/i });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
    await expect(confirm).toBeHidden();
  }
}

/** Pre-seed the age-confirmation flag so the gate does not block navigation. */
async function seedAgeConfirmation(page: Page) {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      /* ignore */
    }
  }, AGE_KEY);
}

test.describe("Greenway smoke", () => {
  test("age gate shows on first visit and can be confirmed", async ({ page }) => {
    await page.goto("/");
    const confirm = page.getByRole("button", { name: /Yes, I am 21\+/i });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(confirm).toBeHidden();
    // Core homepage content is present afterwards.
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("menu page loads and renders products", async ({ page }) => {
    await seedAgeConfirmation(page);
    await page.goto("/menu");
    await confirmAgeGate(page);
    // At least one product detail link should be present.
    const productLinks = page.locator('a[href^="/menu/products/"]');
    await expect(productLinks.first()).toBeVisible({ timeout: 20_000 });
    expect(await productLinks.count()).toBeGreaterThan(0);
  });

  test("add to cart shows the cart launcher", async ({ page }) => {
    await seedAgeConfirmation(page);
    await page.goto("/menu");
    await confirmAgeGate(page);

    // Open the first product detail page.
    const firstProduct = page.locator('a[href^="/menu/products/"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 20_000 });
    await firstProduct.click();

    // Add to cart (button label starts with "Add to Cart").
    const addBtn = page.getByRole("button", { name: /Add to Cart/i });
    await expect(addBtn).toBeVisible({ timeout: 20_000 });
    await addBtn.click();

    // The floating cart launcher only renders once an item is in the cart.
    await expect(page.getByRole("button", { name: /Open cart/i })).toBeVisible();
  });

  test("footer policy links navigate correctly", async ({ page }) => {
    await seedAgeConfirmation(page);
    await page.goto("/");
    await confirmAgeGate(page);

    const policies: Array<{ name: RegExp; path: string }> = [
      { name: /Privacy Policy/i, path: "/privacy-policy" },
      { name: /Terms of Use/i, path: "/terms-of-use" },
      { name: /Consumer Health Data/i, path: "/consumer-health-data" },
    ];

    for (const policy of policies) {
      await page.goto("/");
      const link = page.getByRole("link", { name: policy.name }).first();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${policy.path}/?$`));
    }
  });
});
