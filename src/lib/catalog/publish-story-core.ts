/**
 * src/lib/catalog/publish-story-core.ts
 *
 * S00 — ONE TRUTHFUL STORY about what happens after "Approve". PURE.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Since PR #550 (df261041, 2026-07-16, owner-approved "Option 1"), approving a
 * received product WITH A PRICE publishes it to the website and the register
 * automatically: approveDraftWithPrice → stageIntakeMenuVersionForManifest →
 * autoPublishIntakeVersion (the same gated `publish_menu_version` RPC the
 * manual button uses). The runtime truth lives in
 * src/lib/pos/intake-menu-staging.ts.
 *
 * But three different descriptions of that moment survived on screen and on
 * the printed SOP sheet: "added to the next menu import you stage … go live
 * when you publish that version" (the pre-#550 Option B design), "click
 * Publish when it looks right", and the true one. An owner reading the app
 * had to reverse-engineer the pipeline from contradictory copy (audit
 * findings F-002, F-003, F-007, F-016, F-024, F-029, F-061, F-075, F-089).
 *
 * The exceptions are real and must be told too. An update WAITS instead of
 * publishing itself in exactly two cases (both verified in
 * intake-menu-staging.ts):
 *   1. HELD — the word-by-word extraction engine could not verify a fact on an
 *      mg-dosed product (`fact_extraction_review`); Rule 3.1 sends uncertain
 *      facts to a human, never to customers.
 *   2. FAILED — the automatic publish RPC did not finish; the staged update
 *      is the manual fallback.
 * Either way it waits in the Publish command center (Admin → Publish Menu,
 * /admin/publish) — never on the one-time Cultivera Menu Imports page.
 *
 * HOW IT STAYS TRUE
 * ─────────────────
 * Surfaces import these sentences instead of retyping them, and
 * tests/compliance/receiving-is-the-real-pipeline.test.ts scans the admin
 * tree for STALE_PUBLISH_PHRASES so the old story cannot be reintroduced.
 *
 * PURE: no I/O, no React, no server-only — safe for the SOP sheet, server
 * components, and tsx harnesses alike.
 */

/** Where a waiting menu update is handled. Matches admin-nav-data "Publish Menu". */
export const PUBLISH_CENTER_PATH = "/admin/publish";

/** The human name of that page, as the admin nav labels it. */
export const PUBLISH_CENTER_LABEL = "Admin \u2192 Publish Menu";

/**
 * The one sentence every onboarding / publish surface uses for the normal
 * path. Present tense, no hedging: this IS what the code does.
 */
export const APPROVE_PUBLISHES_COPY =
  "When you approve a product with a price, it is published to the website and the register automatically \u2014 no upload and no Publish click.";

/**
 * The exception, told right next to the rule so nobody is surprised when an
 * update waits.
 */
export const HELD_EXCEPTION_COPY =
  `If a product has a fact that needs a second look (or the automatic publish didn't finish), the update waits under ${PUBLISH_CENTER_LABEL} and tells you exactly what to check.`;

/** What the Menu Imports page is for now (standing rule 11). */
export const MENU_IMPORTS_PURPOSE_COPY =
  "Products you approve publish themselves. This page is only for (1) the one-time Cultivera import and (2) the rare update that was held for review \u2014 the same held updates also appear under Admin \u2192 Publish Menu, which is the easier place to handle them.";

/**
 * Phrases from the superseded "Option B" story (and its cousins). None of
 * these may appear anywhere under src/app/admin, src/lib/catalog or
 * src/lib/inventory. Lower-case; matching is case-insensitive.
 */
export const STALE_PUBLISH_PHRASES: readonly string[] = [
  "next menu import you stage",
  "go live when you publish that version",
  "waiting for the next menu publish",
  "click publish when it looks right",
  "open menu imports and press publish",
  "publish it on admin \u2192 menu imports",
];

/**
 * Return every stale phrase found in `text` (case-insensitive). Empty array
 * means the text tells the current story.
 */
export function findStalePublishPhrases(text: string): string[] {
  const hay = text.toLowerCase();
  return STALE_PUBLISH_PHRASES.filter((p) => hay.includes(p));
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPublishStoryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`publish-story-core self-test failed: ${msg}`);
    }
  };

  // The rule states the automatic publish and names both places it reaches.
  ok(APPROVE_PUBLISHES_COPY.includes("automatically"), "rule says automatically");
  ok(APPROVE_PUBLISHES_COPY.includes("website"), "rule names the website");
  ok(APPROVE_PUBLISHES_COPY.includes("register"), "rule names the register");
  ok(APPROVE_PUBLISHES_COPY.includes("price"), "rule is conditional on a price");

  // The exception names the command center, never Menu Imports.
  ok(HELD_EXCEPTION_COPY.includes("Publish Menu"), "exception points at Publish Menu");
  ok(!/menu imports/i.test(HELD_EXCEPTION_COPY), "exception never sends the owner to Menu Imports");
  ok(HELD_EXCEPTION_COPY.includes("didn't finish"), "exception covers the failed-publish case");
  ok(HELD_EXCEPTION_COPY.includes("second look"), "exception covers the fact-review hold");

  // Menu Imports is described as one-time (rule 11).
  ok(MENU_IMPORTS_PURPOSE_COPY.includes("one-time Cultivera import"), "Menu Imports = one-time Cultivera");
  ok(MENU_IMPORTS_PURPOSE_COPY.includes("publish themselves"), "Menu Imports copy restates the rule");

  // Path + label agree with the admin nav (admin-nav-data: label "Publish Menu", href /admin/publish).
  ok(PUBLISH_CENTER_PATH === "/admin/publish", "path");
  ok(PUBLISH_CENTER_LABEL.endsWith("Publish Menu"), "label");

  // The canonical sentences never contain a stale phrase themselves.
  for (const s of [APPROVE_PUBLISHES_COPY, HELD_EXCEPTION_COPY, MENU_IMPORTS_PURPOSE_COPY]) {
    ok(findStalePublishPhrases(s).length === 0, `canonical copy is clean: ${s.slice(0, 30)}`);
  }

  // The detector finds each banned phrase, case-insensitively, inside noise.
  for (const p of STALE_PUBLISH_PHRASES) {
    ok(findStalePublishPhrases(`xx ${p.toUpperCase()} yy`).includes(p), `detects "${p}"`);
    ok(p === p.toLowerCase(), `phrase stored lower-case: ${p}`);
  }
  // The exact pre-S00 drafts help step (verbatim) is caught.
  const oldStep =
    "Approved drafts are added automatically to the next menu import you stage \u2014 the import review screen lists each one, and they go live when you publish that version.";
  ok(findStalePublishPhrases(oldStep).length === 2, "old drafts help step trips two phrases");
  // Clean text yields nothing (no false positives on the new copy's own words).
  ok(findStalePublishPhrases("Press Publish in the Publish command center.").length === 0, "no false positive");
  ok(findStalePublishPhrases("").length === 0, "empty text is clean");

  return { passed, failed };
}
