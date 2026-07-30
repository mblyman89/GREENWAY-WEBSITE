/**
 * src/lib/cms/home-section-settings-core.ts
 *
 * SLICE 112 — Home page editor "superpowers".
 *
 * Pure, dependency-free helpers for the homepage section SETTINGS that live in
 * the existing page_sections.settings JSON column (migration 0013 — no new
 * migration needed here; the column is unconstrained JSON). This is the single
 * source of truth for the two owner-controllable card counts on the homepage:
 *
 *   - home.settings section  → settings.dailyDealsCount  (the "Today's Deal"
 *                              highlights grid rendered by <HomeDailyDeals>)
 *   - home.brand section      → settings.cardCount        (the "Shop by Brand"
 *                              grid rendered by <HomeBrands>)
 *
 * Both default to 16 (the count the site shipped with) so nothing changes until
 * the owner picks a different amount. This module is imported by BOTH client
 * components (SectionCard, home render helpers) and the server, so it must never
 * import server-only code.
 */

/** The card-count choices the owner can pick from, in dropdown order. */
export const HOME_CARD_COUNTS = [4, 8, 12, 16, 20, 24] as const;

/** The safe default (what the homepage shipped with). */
export const HOME_CARD_COUNT_DEFAULT = 16;

/** Friendly labels for each choice (16 is marked as the default). */
export const HOME_CARD_COUNT_OPTIONS: { value: number; label: string }[] =
  HOME_CARD_COUNTS.map((n) => ({
    value: n,
    label: n === HOME_CARD_COUNT_DEFAULT ? `${n} cards (default)` : `${n} cards`,
  }));

/** The settings-JSON key used on the home.settings section for the deals grid. */
export const DAILY_DEALS_COUNT_KEY = "dailyDealsCount";

/** The settings-JSON key used on the home.brand section for the brand grid. */
export const BRAND_COUNT_KEY = "cardCount";

/**
 * Coerce any value into one of the allowed card counts. Accepts a number or a
 * numeric string. Anything not exactly in HOME_CARD_COUNTS (including junk,
 * null, NaN) falls back to the default — the grid can never render a broken or
 * hostile size.
 */
export function clampHomeCardCount(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
  } else {
    return HOME_CARD_COUNT_DEFAULT;
  }
  if (!Number.isFinite(n)) return HOME_CARD_COUNT_DEFAULT;
  return (HOME_CARD_COUNTS as readonly number[]).includes(n)
    ? n
    : HOME_CARD_COUNT_DEFAULT;
}

/**
 * Read a card count out of a section's settings JSON by key. Missing / malformed
 * settings resolve to the default.
 */
export function readHomeCardCount(
  settings: Record<string, unknown> | null | undefined,
  key: string,
): number {
  if (!settings || typeof settings !== "object") return HOME_CARD_COUNT_DEFAULT;
  return clampHomeCardCount((settings as Record<string, unknown>)[key]);
}

/**
 * Return a NEW settings object with `key` set to a validated card count, keeping
 * every other existing key untouched (so lanes / titleClassName / any future
 * settings are never dropped when the owner changes a count).
 */
export function writeHomeCardCount(
  settings: Record<string, unknown> | null | undefined,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    settings && typeof settings === "object" ? { ...settings } : {};
  base[key] = clampHomeCardCount(value);
  return base;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runHomeSectionSettingsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[home-section-settings] FAIL: ${msg}`);
    }
  };

  // Choices + default
  ok(HOME_CARD_COUNTS.length === 6, "six card-count choices");
  ok(HOME_CARD_COUNT_DEFAULT === 16, "default is 16");
  ok((HOME_CARD_COUNTS as readonly number[]).includes(16), "16 is a valid choice");
  ok(HOME_CARD_COUNT_OPTIONS.length === 6, "six labelled options");
  ok(
    HOME_CARD_COUNT_OPTIONS.find((o) => o.value === 16)?.label.includes("default") ===
      true,
    "16 is labelled default",
  );
  ok(
    HOME_CARD_COUNT_OPTIONS.find((o) => o.value === 8)?.label === "8 cards",
    "non-default label has no '(default)'",
  );

  // clampHomeCardCount
  ok(clampHomeCardCount(4) === 4, "clamp accepts 4");
  ok(clampHomeCardCount(24) === 24, "clamp accepts 24");
  ok(clampHomeCardCount("12") === 12, "clamp accepts numeric string");
  ok(clampHomeCardCount(15) === HOME_CARD_COUNT_DEFAULT, "off-list 15 -> default");
  ok(clampHomeCardCount(0) === HOME_CARD_COUNT_DEFAULT, "zero -> default");
  ok(clampHomeCardCount(-8) === HOME_CARD_COUNT_DEFAULT, "negative -> default");
  ok(clampHomeCardCount(1000) === HOME_CARD_COUNT_DEFAULT, "huge -> default");
  ok(clampHomeCardCount(null) === HOME_CARD_COUNT_DEFAULT, "null -> default");
  ok(clampHomeCardCount(undefined) === HOME_CARD_COUNT_DEFAULT, "undefined -> default");
  ok(clampHomeCardCount("abc") === HOME_CARD_COUNT_DEFAULT, "junk string -> default");
  ok(clampHomeCardCount(NaN) === HOME_CARD_COUNT_DEFAULT, "NaN -> default");
  ok(clampHomeCardCount({}) === HOME_CARD_COUNT_DEFAULT, "object -> default");
  ok(clampHomeCardCount("") === HOME_CARD_COUNT_DEFAULT, "empty string -> default");

  // readHomeCardCount
  ok(readHomeCardCount({ cardCount: 20 }, "cardCount") === 20, "read valid key");
  ok(
    readHomeCardCount({ cardCount: 99 }, "cardCount") === HOME_CARD_COUNT_DEFAULT,
    "read off-list -> default",
  );
  ok(readHomeCardCount(null, "cardCount") === HOME_CARD_COUNT_DEFAULT, "read null settings");
  ok(readHomeCardCount({}, "missing") === HOME_CARD_COUNT_DEFAULT, "read missing key");
  ok(
    readHomeCardCount({ dailyDealsCount: "8" }, DAILY_DEALS_COUNT_KEY) === 8,
    "read deals key from string",
  );

  // writeHomeCardCount — preserves other keys, validates the count
  const merged = writeHomeCardCount({ lanes: "brand" }, BRAND_COUNT_KEY, 12);
  ok(merged.lanes === "brand", "write preserves lanes");
  ok(merged.cardCount === 12, "write sets validated count");
  const merged2 = writeHomeCardCount(
    { lanes: "brand", cardCount: 4 },
    BRAND_COUNT_KEY,
    "bogus",
  );
  ok(merged2.cardCount === HOME_CARD_COUNT_DEFAULT, "write coerces junk to default");
  ok(merged2.lanes === "brand", "write still preserves lanes on junk");
  const merged3 = writeHomeCardCount(null, DAILY_DEALS_COUNT_KEY, 24);
  ok(merged3.dailyDealsCount === 24, "write onto null settings");
  // Immutability: original object not mutated
  const original = { lanes: "brand" as string };
  writeHomeCardCount(original, BRAND_COUNT_KEY, 8);
  ok(!("cardCount" in original), "write does not mutate the input object");

  return { passed, failed };
}
