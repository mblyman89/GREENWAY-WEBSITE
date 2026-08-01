/**
 * src/lib/medical/medical-content-core.ts
 *
 * SLICE 107 — the PURE single source of truth for the EDITABLE copy on the
 * public /medical page AND the page-level "hide this page" switch.
 *
 * DESIGN (grounded in src/components/medical/MedicalProgramContent.tsx and the
 * page's own HONESTY RULES header):
 *
 *   - Only the PRESENTATIONAL copy is editable — section eyebrows/titles and
 *     the two informational bullet lists (what to bring / card perks). Every
 *     fallback below is BYTE-FOR-BYTE identical to what the page ships today,
 *     so seeding produces zero visible change until a staff member edits and
 *     publishes a block. (Same live-look-safe contract as SLICE 105/106.)
 *
 *   - The STATUTORY mechanics stay FIXED in the component (tax/limit fine
 *     print, WAC/RCW citations) and the purchase-limit TABLE stays LIVE from
 *     the compliance core `purchase-limit-display-core`. An editable block can
 *     therefore never overpromise, drop a citation, or drift the legal table
 *     (WAC 314-55-155: no therapeutic claims; RCW 82.08.9998 / WAC 314-55-090
 *     / WAC 314-55-095 mechanics must remain exact).
 *
 *   - The page-level HIDE switch is a single "select" content block
 *     `medical.page.hidden` ("no" = Visible [default] / "yes" = Hidden). When
 *     Hidden, the public /medical route returns notFound() and the Medical nav
 *     link is filtered out of both the desktop and mobile menus.
 *
 * Storage: content_blocks rows only — field_type / draft_value /
 * published_value are plain unconstrained text columns
 * (supabase/migrations/0005_slice5_cms.sql L100-102), and field_type has NO
 * CHECK constraint, so the new "plain"/"select" blocks need NO migration —
 * the same basis as SLICE 105 "select" and SLICE 106 "richjson".
 */

// ---------------------------------------------------------------------------
// Page-level "hide this page" switch (a "select" content block).
// ---------------------------------------------------------------------------

/** The ONE content_blocks row that stores whether /medical is hidden. */
export const MEDICAL_HIDE_BLOCK = "medical.page.hidden";

/**
 * Options for the hide switch. The FIRST option is the default (Visible), so a
 * blank / unseeded / unknown value always keeps the page VISIBLE — a mis-typed
 * value can never accidentally hide the page.
 */
export const MEDICAL_HIDE_OPTIONS = [
  { value: "no", label: "Visible (default)", className: "" },
  { value: "yes", label: "Hidden", className: "" },
] as const;

/** The stored value that means "page is hidden". */
export const MEDICAL_HIDDEN_VALUE = "yes";

/** The default (Visible) stored value. */
export const MEDICAL_VISIBLE_VALUE = "no";

/**
 * Is the Medical page hidden for the given stored select value?
 * ONLY the exact value "yes" hides it; everything else (blank / unseeded /
 * "no" / any unknown string / null / undefined) keeps the page VISIBLE.
 */
export function isMedicalPageHidden(value: string | null | undefined): boolean {
  return (value ?? "").trim() === MEDICAL_HIDDEN_VALUE;
}

// ---------------------------------------------------------------------------
// Editable copy registry (each entry is a plain content block).
// ---------------------------------------------------------------------------

/**
 * One editable copy block on the Medical page. `fallback` MUST be byte-for-byte
 * identical to the copy currently rendered by MedicalProgramContent.tsx.
 */
export type MedicalContentBlock = {
  /** content_blocks.block_key */
  key: string;
  /** Friendly label shown in the admin editor. */
  label: string;
  /** Optional helper line under the field in the admin editor. */
  help?: string;
  /** Byte-identical live copy — the seed default and public fallback. */
  fallback: string;
};

/**
 * The curated list of editable Medical copy blocks, in the order they appear
 * on the page. Grouped by section for the admin editor. Every `fallback` is
 * copied verbatim from MedicalProgramContent.tsx (SLICE 107 audit F4).
 */
export const MEDICAL_CONTENT_BLOCKS: readonly MedicalContentBlock[] = [
  // ---- "What to bring" card ------------------------------------------------
  {
    key: "medical.bring.eyebrow",
    label: "“What to bring” — eyebrow",
    help: "The small gold label above the section title.",
    fallback: "Get carded in store",
  },
  {
    key: "medical.bring.title",
    label: "“What to bring” — title",
    fallback: "What to bring",
  },
  {
    key: "medical.bring.item1",
    label: "“What to bring” — item 1",
    fallback:
      "A valid medical cannabis authorization form (DOH 630-236) from your healthcare practitioner — tamper-resistant original, complete and signed.",
  },
  {
    key: "medical.bring.item2",
    label: "“What to bring” — item 2",
    fallback: "Valid government-issued photo ID matching the authorization.",
  },
  {
    key: "medical.bring.item3",
    label: "“What to bring” — item 3",
    fallback:
      "About 15–20 minutes: our certified medical cannabis consultant verifies your form, enters you into the state database, and prints your recognition card in store.",
  },
  // ---- "What your card gets you" card -------------------------------------
  {
    key: "medical.perks.eyebrow",
    label: "“Card perks” — eyebrow",
    help: "The small gold label above the section title.",
    fallback: "Recognition card perks",
  },
  {
    key: "medical.perks.title",
    label: "“Card perks” — title",
    fallback: "What your card gets you",
  },
  {
    key: "medical.perks.item1",
    label: "“Card perks” — item 1",
    fallback:
      "Sales tax (9.3%) waived on DOH-compliant products (chapter 246-70 WAC) — look for the medical designation on qualifying items.",
  },
  {
    key: "medical.perks.item2",
    label: "“Card perks” — item 2",
    fallback:
      "Excise tax (37%) waived on DOH-compliant products while the state exemption window is open — the single biggest saving on qualifying purchases.",
  },
  {
    key: "medical.perks.item3",
    label: "“Card perks” — item 3",
    fallback:
      "Purchase limits three times higher than recreational limits (see the table below).",
  },
  {
    key: "medical.perks.item4",
    label: "“Card perks” — item 4",
    fallback:
      "Ages 18–20 may purchase with a valid recognition card (recreational sales are 21+).",
  },
  // ---- "High-CBD" card (eyebrow + title only; body is statutory) -----------
  {
    key: "medical.cbd.eyebrow",
    label: "“High-CBD” — eyebrow",
    help: "The small gold label above the section title.",
    fallback: "No card? No problem",
  },
  {
    key: "medical.cbd.title",
    label: "“High-CBD” — title",
    fallback: "High-CBD products — tax break for everyone",
  },
  // ---- "Purchase limits" card (eyebrow + title only; table stays live) -----
  {
    key: "medical.limits.eyebrow",
    label: "“Purchase limits” — eyebrow",
    help: "The small gold label above the section title.",
    fallback: "Carry more, shop less often",
  },
  {
    key: "medical.limits.title",
    label: "“Purchase limits” — title",
    fallback: "Purchase limits: medical vs. recreational",
  },
] as const;

/**
 * MIG-5 Slice 1 (ADD) — the Medical page's HERO + INTRO copy.
 *
 * These three blocks (`medical.hero.title`, `medical.hero.subtitle`,
 * `medical.intro.body`) are rendered on the public /medical page by
 * MedicalProgramContent.tsx via <SiteText>, whose fallback is the
 * content-blocks SEED defaultValue. They were seeded with EXPLICIT rows in
 * content-blocks-seed.ts (NOT via medicalCopyBlockSeeds), and until now they
 * were editable ONLY in the generic Site Content "junk drawer".
 *
 * This registry surfaces them in the dedicated Medical page editor too
 * (additive-first). It is DELIBERATELY SEPARATE from MEDICAL_CONTENT_BLOCKS so
 * it does NOT feed medicalCopyBlockSeeds() — that would DOUBLE-SEED these keys
 * (they already have explicit seed rows) and break the intentional invariant
 * that MEDICAL_CONTENT_BLOCKS holds exactly the 15 non-hero copy blocks.
 *
 * Each `fallback` below is BYTE-FOR-BYTE identical to the seed defaultValue in
 * content-blocks-seed.ts, so nothing on the public page changes when a staff
 * member merely opens this editor — only an explicit edit + Publish changes the
 * live site (identical draft→publish machinery as the 15 copy blocks).
 */
export const MEDICAL_HERO_BLOCKS: readonly MedicalContentBlock[] = [
  {
    key: "medical.hero.title",
    label: "Hero — title",
    help: "The big headline at the top of the public Medical page.",
    fallback: "Medical Cannabis at Greenway",
  },
  {
    key: "medical.hero.subtitle",
    label: "Hero — subtitle",
    help: "The bold line directly under the hero title.",
    fallback:
      "Greenway Marijuana is a medically endorsed retailer with certified medical cannabis consultants on staff.",
  },
  {
    key: "medical.intro.body",
    label: "Intro paragraph",
    help: "The paragraph under the hero explaining the medical program at a glance. Keep claims factual — no therapeutic or curative claims.",
    fallback:
      "Washington patients with a valid authorization can join the state's voluntary Medical Cannabis Authorization Database at our store, receive a recognition card, and unlock tax savings and higher purchase limits on qualifying products. Here's how it works and what to bring.",
  },
] as const;

/** Every editable Medical block key (for a one-shot getContentValues fetch). */
export const MEDICAL_CONTENT_KEYS: readonly string[] = MEDICAL_CONTENT_BLOCKS.map(
  (b) => b.key,
);

/** Fast lookup: block_key -> byte-identical fallback copy. */
const MEDICAL_FALLBACKS: Record<string, string> = Object.fromEntries(
  MEDICAL_CONTENT_BLOCKS.map((b) => [b.key, b.fallback]),
);

/** The byte-identical fallback for a Medical block key ("" if unknown). */
export function medicalFallback(key: string): string {
  return MEDICAL_FALLBACKS[key] ?? "";
}

/** Every hero/intro block key (MIG-5 Slice 1). */
export const MEDICAL_HERO_KEYS: readonly string[] = MEDICAL_HERO_BLOCKS.map(
  (b) => b.key,
);

/** Fast lookup: hero/intro block_key -> byte-identical fallback copy. */
const MEDICAL_HERO_FALLBACKS: Record<string, string> = Object.fromEntries(
  MEDICAL_HERO_BLOCKS.map((b) => [b.key, b.fallback]),
);

/**
 * The byte-identical fallback for a Medical HERO/INTRO block key ("" if
 * unknown). Kept separate from medicalFallback so the two registries never mix.
 */
export function medicalHeroFallback(key: string): string {
  return MEDICAL_HERO_FALLBACKS[key] ?? "";
}

/** Is this block_key one of the Medical HERO/INTRO blocks (MIG-5 Slice 1)? */
export function isMedicalHeroBlock(key: string | null | undefined): boolean {
  return !!key && key in MEDICAL_HERO_FALLBACKS;
}

/**
 * Resolve a Medical block's display value from a fetched values record, with a
 * guaranteed byte-identical fallback. A blank/whitespace-only stored value
 * falls back to the shipped copy so the page can never render an empty line.
 */
export function resolveMedicalValue(
  key: string,
  values: Record<string, string> | null | undefined,
): string {
  const fallback = medicalFallback(key);
  const raw = values?.[key];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed.length ? raw : fallback;
}

/** Is this block_key one of the editable Medical copy blocks? */
export function isMedicalContentBlock(key: string | null | undefined): boolean {
  return !!key && key in MEDICAL_FALLBACKS;
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runMedicalContentCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("medical-content-core: " + msg);
    passed += 1;
  };

  // ---- Hide switch ---------------------------------------------------------
  ok(MEDICAL_HIDE_BLOCK === "medical.page.hidden", "hide block key is stable");
  ok(MEDICAL_HIDE_OPTIONS[0]!.value === "no", "first hide option is 'no' (Visible default)");
  ok(MEDICAL_HIDE_OPTIONS[1]!.value === "yes", "second hide option is 'yes' (Hidden)");
  ok(MEDICAL_HIDE_OPTIONS.length === 2, "exactly two hide options");
  // Only the exact "yes" hides the page; everything else keeps it visible.
  ok(isMedicalPageHidden("yes"), "'yes' hides the page");
  ok(isMedicalPageHidden("  yes  "), "padded 'yes' hides the page");
  ok(!isMedicalPageHidden("no"), "'no' keeps the page visible");
  ok(!isMedicalPageHidden(""), "blank keeps the page visible (default)");
  ok(!isMedicalPageHidden(null), "null keeps the page visible (default)");
  ok(!isMedicalPageHidden(undefined), "undefined keeps the page visible (default)");
  ok(!isMedicalPageHidden("YES"), "case-sensitive: 'YES' does NOT hide (safe)");
  ok(!isMedicalPageHidden("hidden"), "unknown value keeps the page visible (safe)");

  // ---- Editable copy registry ---------------------------------------------
  ok(MEDICAL_CONTENT_BLOCKS.length === 15, "15 editable Medical copy blocks");
  ok(MEDICAL_CONTENT_KEYS.length === MEDICAL_CONTENT_BLOCKS.length, "keys mirror blocks");

  // Keys are unique.
  const seen = new Set<string>();
  for (const b of MEDICAL_CONTENT_BLOCKS) {
    ok(!seen.has(b.key), `duplicate key: ${b.key}`);
    seen.add(b.key);
    ok(b.key.startsWith("medical."), `${b.key} is namespaced under medical.`);
    ok(b.label.trim().length > 0, `${b.key} has a label`);
    ok(b.fallback.trim().length > 0, `${b.key} has non-empty byte-identical copy`);
  }

  // The hide block is NOT one of the editable copy blocks (different editor).
  ok(!isMedicalContentBlock(MEDICAL_HIDE_BLOCK), "hide block is not a copy block");
  ok(isMedicalContentBlock("medical.bring.title"), "bring.title is a copy block");
  ok(!isMedicalContentBlock("medical.hero.title"), "hero.title (SiteText) is not in this registry");
  ok(!isMedicalContentBlock(""), "empty key is not a copy block");
  ok(!isMedicalContentBlock(null), "null key is not a copy block");

  // ---- Hero/intro registry (MIG-5 Slice 1) --------------------------------
  // A SEPARATE registry so it never feeds medicalCopyBlockSeeds (no double
  // seed) and keeps MEDICAL_CONTENT_BLOCKS at exactly 15.
  ok(MEDICAL_HERO_BLOCKS.length === 3, "3 hero/intro Medical blocks");
  ok(MEDICAL_HERO_KEYS.length === MEDICAL_HERO_BLOCKS.length, "hero keys mirror blocks");
  const heroSeen = new Set<string>();
  for (const b of MEDICAL_HERO_BLOCKS) {
    ok(!heroSeen.has(b.key), `duplicate hero key: ${b.key}`);
    heroSeen.add(b.key);
    ok(b.key.startsWith("medical."), `${b.key} is namespaced under medical.`);
    ok(b.label.trim().length > 0, `${b.key} has a label`);
    ok(b.fallback.trim().length > 0, `${b.key} has non-empty byte-identical copy`);
    // The two registries must be DISJOINT (a key is in exactly one).
    ok(!isMedicalContentBlock(b.key), `${b.key} is NOT in the 15-copy registry`);
  }
  // The three expected keys are present and recognised by the hero helper.
  ok(isMedicalHeroBlock("medical.hero.title"), "hero.title is a hero block");
  ok(isMedicalHeroBlock("medical.hero.subtitle"), "hero.subtitle is a hero block");
  ok(isMedicalHeroBlock("medical.intro.body"), "intro.body is a hero block");
  ok(!isMedicalHeroBlock("medical.bring.title"), "bring.title is NOT a hero block");
  ok(!isMedicalHeroBlock(MEDICAL_HIDE_BLOCK), "hide block is NOT a hero block");
  ok(!isMedicalHeroBlock(null), "null key is not a hero block");
  // Byte-identical fallbacks (guards against copy drift from the seed).
  ok(
    medicalHeroFallback("medical.hero.title") === "Medical Cannabis at Greenway",
    "hero.title fallback exact",
  );
  ok(medicalHeroFallback("nope") === "", "unknown hero key fallback = ''");

  // ---- Fallback + resolve safety ------------------------------------------
  ok(medicalFallback("medical.bring.title") === "What to bring", "bring.title fallback exact");
  ok(medicalFallback("nope") === "", "unknown key fallback = ''");

  // Missing / blank values fall back to the shipped byte-identical copy.
  ok(
    resolveMedicalValue("medical.bring.title", null) === "What to bring",
    "null values -> fallback",
  );
  ok(
    resolveMedicalValue("medical.bring.title", {}) === "What to bring",
    "missing key -> fallback",
  );
  ok(
    resolveMedicalValue("medical.bring.title", { "medical.bring.title": "   " }) ===
      "What to bring",
    "blank stored value -> fallback",
  );
  // A real edit is honoured verbatim (leading/trailing spaces of a real value
  // are preserved once there is non-whitespace content).
  ok(
    resolveMedicalValue("medical.bring.title", { "medical.bring.title": "Bring these" }) ===
      "Bring these",
    "real edit is honoured verbatim",
  );

  return { passed };
}
