/**
 * src/lib/inventory/menu-live-step-core.ts
 *
 * The ④ "On menu" step for the guided intake ribbon — PURE (no React, no
 * I/O — vitest-testable). Since intake auto-publish shipped, approving a
 * received product's price on Product Onboarding puts it live on the website
 * + POS automatically; this core decides what the ribbon's 4th step shows so
 * the owner can see, from the manifest page itself, whether this delivery's
 * products made it onto the menu — without ever visiting Menu Imports.
 *
 * States (evidence-based, never guessed):
 *   • Manifest not accepted yet         → todo (greyed; nothing menu-side yet)
 *   • Counts unavailable (read failed)  → todo (we never claim "done" blind)
 *   • Drafts still unpriced             → current → "price & approve" (deep-link)
 *   • Staged version stuck unpublished  → current → "publish now" fallback
 *     (the auto-publish is best-effort; if it hiccups the staged draft lands
 *     on Menu Imports and this step points straight at it)
 *   • Approved products live            → done ("on the menu")
 *   • No new products from the delivery → done (nothing was needed)
 */

/** Mirrors guided-accept-core's GuidedStepState minus "failed" (step ④ never fails). */
export type MenuStepState = "done" | "current" | "todo";

export type MenuStepInput = {
  /** catalog_product_drafts rows for the manifest still in status "draft". */
  pendingDrafts: number;
  /** catalog_product_drafts rows for the manifest in status "approved". */
  approvedDrafts: number;
  /** An intake-origin STAGED menu version for this manifest still exists
   *  (auto-publish didn't finish — the Menu Imports fallback has it). */
  stagedWaiting: boolean;
};

export type MenuStepView = {
  state: MenuStepState;
  /** Plain-English "what do I do here?" override for the ribbon when the
   *  menu step is the story — null falls back to the accept-stage copy. */
  line: string | null;
  /** Deep-link that advances the step (drafts page / Menu Imports), or null. */
  href: string | null;
  /** Label for the deep-link button, or null. */
  linkLabel: string | null;
};

export const MENU_STEP_LABEL = "On menu";
export const DRAFTS_PATH = "/admin/inventory/drafts";
export const MENU_IMPORTS_PATH = "/admin/menu-imports";

/** Manifest statuses whose lots have entered inventory (menu work can exist). */
const ACCEPTED_STATUSES = new Set(["accepted", "partially_accepted"]);

/** Defensive count parse: garbage / negative / non-finite → 0. */
function clampCount(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Decide the ribbon's ④ "On menu" step for a manifest. `input` is null when
 * the page could not read the draft/staged counts — we then show a neutral
 * todo rather than guessing an outcome.
 */
export function menuStep(manifestStatus: string, input: MenuStepInput | null): MenuStepView {
  // Before the manifest is accepted (or when it was rejected outright) there
  // is no menu work — the step sits greyed at the end of the rail.
  if (!ACCEPTED_STATUSES.has(manifestStatus)) {
    return { state: "todo", line: null, href: null, linkLabel: null };
  }

  // Counts unavailable: never claim done without evidence.
  if (!input) {
    return { state: "todo", line: null, href: null, linkLabel: null };
  }

  const pending = clampCount(input.pendingDrafts);
  const approved = clampCount(input.approvedDrafts);

  if (pending > 0) {
    const plural = pending === 1 ? "" : "s";
    const verb = pending === 1 ? "needs" : "need";
    return {
      state: "current",
      line: `${pending} product${plural} from this delivery still ${verb} a price. Open Product Onboarding, set the price, and press “Approve” — each one goes live on the website + register automatically the moment you approve it.`,
      href: DRAFTS_PATH,
      linkLabel: "Price & approve",
    };
  }

  if (input.stagedWaiting) {
    return {
      state: "current",
      line: "A menu update from this delivery is staged but hasn't gone live — the automatic publish didn't finish. Open Menu Imports and press Publish to put it live.",
      href: MENU_IMPORTS_PATH,
      linkLabel: "Publish now",
    };
  }

  if (approved > 0) {
    const plural = approved === 1 ? "" : "s";
    return {
      state: "done",
      line: `Done — this delivery's ${approved} approved product${plural} went live on the website + register automatically. Add photos & descriptions in Product Enrichment whenever you're ready.`,
      href: null,
      linkLabel: null,
    };
  }

  // No drafts at all (nothing new, or everything dismissed as not-new):
  // the menu needed nothing from this delivery.
  return {
    state: "done",
    line: "Done — this delivery needed no new menu products (everything on it was already on the menu). Nothing left to do here.",
    href: null,
    linkLabel: null,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMenuLiveStepCoreTests(): void {
  let passed = 0;
  function ok(cond: boolean, msg: string): void {
    if (!cond) throw new Error(`menu-live-step-core self-test failed: ${msg}`);
    passed += 1;
  }

  const counts = (p: number, a: number, s = false): MenuStepInput => ({
    pendingDrafts: p,
    approvedDrafts: a,
    stagedWaiting: s,
  });

  // Pre-accept lifecycle statuses → neutral todo, no line, no link.
  for (const st of ["pending", "in_transit", "received", "rejected", "???", ""]) {
    const v = menuStep(st, counts(3, 0));
    ok(v.state === "todo" && v.line === null && v.href === null, `pre-accept ${st || "(blank)"} → todo`);
  }

  // Accepted but counts unavailable → todo (never claim done blind).
  ok(menuStep("accepted", null).state === "todo", "accepted + null counts → todo");
  ok(menuStep("accepted", null).line === null, "accepted + null counts → no line override");

  // Drafts still unpriced → current, deep-links to the drafts page.
  const pending = menuStep("accepted", counts(2, 1));
  ok(pending.state === "current", "pending drafts → current");
  ok(pending.line !== null && pending.line.includes("2 products"), "pending plural count woven in");
  ok(pending.href === DRAFTS_PATH && pending.linkLabel === "Price & approve", "pending → drafts deep-link");
  const one = menuStep("partially_accepted", counts(1, 0));
  ok(one.line !== null && one.line.includes("1 product from") && one.line.includes("needs"), "singular copy");

  // Pending drafts outrank a stuck staged version (price first, then publish).
  const both = menuStep("accepted", counts(1, 0, true));
  ok(both.href === DRAFTS_PATH, "pending outranks stagedWaiting");

  // Staged-but-unpublished fallback → current, deep-links to Menu Imports.
  const stuck = menuStep("accepted", counts(0, 2, true));
  ok(stuck.state === "current", "stagedWaiting → current");
  ok(stuck.line !== null && stuck.line.includes("Publish"), "stagedWaiting line names Publish");
  ok(stuck.href === MENU_IMPORTS_PATH && stuck.linkLabel === "Publish now", "stagedWaiting → menu-imports deep-link");

  // Approved and nothing waiting → done ("on the menu").
  const live = menuStep("accepted", counts(0, 3));
  ok(live.state === "done", "approved live → done");
  ok(live.line !== null && live.line.includes("3 approved products went live"), "done copy counts products");
  ok(live.href === null && live.linkLabel === null, "done → no link");
  const liveOne = menuStep("accepted", counts(0, 1));
  ok(liveOne.line !== null && liveOne.line.includes("1 approved product went"), "done singular copy");

  // No drafts at all → done, "nothing was needed" copy.
  const none = menuStep("accepted", counts(0, 0));
  ok(none.state === "done", "no drafts → done");
  ok(none.line !== null && none.line.includes("needed no new menu products"), "no-drafts copy");

  // Garbage counts sanitize to 0 rather than misrendering.
  const garbage = menuStep("accepted", {
    pendingDrafts: Number.NaN,
    approvedDrafts: -4,
    stagedWaiting: false,
  });
  ok(garbage.state === "done" && garbage.line !== null && garbage.line.includes("needed no new"), "garbage counts → sanitized");

  // Label constant is stable (the ribbon and tests render it verbatim).
  ok(MENU_STEP_LABEL === "On menu", "step label");

  console.log(`menu-live-step-core: PASSED ${passed} assertions`);
}
