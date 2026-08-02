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
// Home "Shop by Category" per-lane images (SLICE: home type cards)
//
// The six category tiles (Flower, Prerolls, Concentrates, Edibles, Liquids,
// Topicals) can each show an owner-uploaded product photo INSIDE the card. The
// chosen image URL/path is stored per lane on the home.category section's
// settings JSON under `laneImages` (an object keyed by lane key). An unset lane
// resolves to "" so the tile renders its clean text-only fallback (byte
// identical to today's card). Reuses the existing settings JSON column — no new
// migration, mirrors the card-count helpers above.
// ---------------------------------------------------------------------------

/** The settings-JSON key (on home.category) holding the per-lane image map. */
export const LANE_IMAGES_KEY = "laneImages";

/** The six category lane keys, in display order (mirrors categoryLanes). */
export const HOME_TYPE_LANE_KEYS = [
  "flower",
  "prerolls",
  "concentrates",
  "edibles",
  "liquids",
  "topicals",
] as const;

export type HomeTypeLaneKey = (typeof HOME_TYPE_LANE_KEYS)[number];

/** Coerce any value into a safe image string ("" when missing/non-string). */
export function clampLaneImage(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read the per-lane image map out of the home.category section settings JSON.
 * Always returns a full map (every lane key present); unset lanes resolve to "".
 * Missing / malformed settings resolve to an all-empty map.
 */
export function readLaneImages(
  settings: Record<string, unknown> | null | undefined,
): Record<HomeTypeLaneKey, string> {
  const out = {} as Record<HomeTypeLaneKey, string>;
  const raw =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)[LANE_IMAGES_KEY]
      : undefined;
  const map =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const key of HOME_TYPE_LANE_KEYS) {
    out[key] = clampLaneImage(map[key]);
  }
  return out;
}

/**
 * Read a single lane's image ("" when unset/invalid). Convenience over
 * readLaneImages when only one lane is needed.
 */
export function readLaneImage(
  settings: Record<string, unknown> | null | undefined,
  lane: string,
): string {
  if (!(HOME_TYPE_LANE_KEYS as readonly string[]).includes(lane)) return "";
  return readLaneImages(settings)[lane as HomeTypeLaneKey];
}

/**
 * Return a NEW settings object with one lane's image set (or cleared when the
 * value is blank), keeping every other setting (lanes / cardCount / other lane
 * images) untouched. The nested laneImages object is cloned, never mutated.
 */
export function writeLaneImage(
  settings: Record<string, unknown> | null | undefined,
  lane: string,
  value: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    settings && typeof settings === "object" ? { ...settings } : {};
  const current = readLaneImages(settings);
  const next: Record<string, string> = { ...current };
  if ((HOME_TYPE_LANE_KEYS as readonly string[]).includes(lane)) {
    next[lane] = clampLaneImage(value);
  }
  // Drop empty entries so an all-default map serializes clean (no visible change).
  const trimmed: Record<string, string> = {};
  for (const key of HOME_TYPE_LANE_KEYS) {
    if (next[key]) trimmed[key] = next[key];
  }
  if (Object.keys(trimmed).length > 0) base[LANE_IMAGES_KEY] = trimmed;
  else delete base[LANE_IMAGES_KEY];
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

  // ---- Per-lane images -----------------------------------------------------
  ok(HOME_TYPE_LANE_KEYS.length === 6, "six type lane keys");
  ok(HOME_TYPE_LANE_KEYS[0] === "flower", "first lane is flower");
  ok(HOME_TYPE_LANE_KEYS[5] === "topicals", "last lane is topicals");

  // clampLaneImage
  ok(clampLaneImage("/x.png") === "/x.png", "clampLaneImage passes a string");
  ok(clampLaneImage("  /x.png  ") === "/x.png", "clampLaneImage trims");
  ok(clampLaneImage(null) === "", "clampLaneImage null -> empty");
  ok(clampLaneImage(123) === "", "clampLaneImage number -> empty");
  ok(clampLaneImage(undefined) === "", "clampLaneImage undefined -> empty");

  // readLaneImages — full map, unset lanes empty
  const imgs = readLaneImages({ laneImages: { flower: "/f.png", edibles: "/e.png" } });
  ok(imgs.flower === "/f.png", "read lane image flower");
  ok(imgs.edibles === "/e.png", "read lane image edibles");
  ok(imgs.prerolls === "", "unset lane -> empty");
  ok(Object.keys(imgs).length === 6, "readLaneImages returns all six lanes");
  ok(readLaneImages(null).flower === "", "read null settings -> empty map");
  ok(readLaneImages({}).flower === "", "read missing laneImages -> empty");
  ok(
    readLaneImages({ laneImages: "nope" as unknown as object }).flower === "",
    "read malformed laneImages -> empty",
  );

  // readLaneImage — single lane
  ok(
    readLaneImage({ laneImages: { flower: "/f.png" } }, "flower") === "/f.png",
    "readLaneImage valid lane",
  );
  ok(readLaneImage({ laneImages: { flower: "/f.png" } }, "bogus") === "", "readLaneImage bad lane -> empty");

  // writeLaneImage — preserves other settings, clones nested map, drops blanks
  const w1 = writeLaneImage({ lanes: "category", cardCount: 16 }, "flower", "/f.png");
  ok(w1.lanes === "category", "writeLaneImage preserves lanes");
  ok(w1.cardCount === 16, "writeLaneImage preserves cardCount");
  ok(
    (w1.laneImages as Record<string, string>).flower === "/f.png",
    "writeLaneImage sets the lane",
  );
  const w2 = writeLaneImage(w1, "edibles", "/e.png");
  ok(
    (w2.laneImages as Record<string, string>).flower === "/f.png" &&
      (w2.laneImages as Record<string, string>).edibles === "/e.png",
    "writeLaneImage keeps prior lane image",
  );
  const w3 = writeLaneImage(w2, "flower", "");
  ok(
    !(w3.laneImages as Record<string, string>).flower &&
      (w3.laneImages as Record<string, string>).edibles === "/e.png",
    "writeLaneImage blanks a lane, keeps others",
  );
  const w4 = writeLaneImage({ lanes: "category" }, "flower", "");
  ok(!("laneImages" in w4), "writeLaneImage drops empty laneImages entirely");
  ok(w4.lanes === "category", "writeLaneImage keeps lanes when clearing images");
  ok(writeLaneImage({}, "bogus", "/x.png").laneImages === undefined, "writeLaneImage ignores bad lane");
  // Immutability: original nested map not mutated
  const origSettings = { laneImages: { flower: "/f.png" } };
  writeLaneImage(origSettings, "edibles", "/e.png");
  ok(
    !("edibles" in (origSettings.laneImages as Record<string, string>)),
    "writeLaneImage does not mutate the input nested map",
  );

  return { passed, failed };
}
