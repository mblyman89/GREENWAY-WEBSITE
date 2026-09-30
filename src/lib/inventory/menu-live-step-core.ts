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
 *   • Staged version stuck unpublished  → current → "review & publish"
 *     (held for a fact check, or the best-effort auto-publish hiccuped; the
 *     staged draft waits in the Publish command center and this step points
 *     straight at it — S00: never at the one-time Menu Imports page)
 *   • Approved products live            → done ("on the menu")
 *   • No new products from the delivery → done (nothing was needed)
 */

import { PUBLISH_CENTER_PATH } from "@/lib/catalog/publish-story-core";
import { waitingMenuFix, type WaitingMenuVersion } from "@/lib/pos/menu-waiting-link-core";

/** Mirrors guided-accept-core's GuidedStepState minus "failed" (step ④ never fails). */
export type MenuStepState = "done" | "current" | "todo";

export type MenuStepInput = {
  /** catalog_product_drafts rows for the manifest still in status "draft". */
  pendingDrafts: number;
  /** catalog_product_drafts rows for the manifest in status "approved". */
  approvedDrafts: number;
  /** An intake-origin STAGED menu version for this manifest still exists
   *  (held for a fact check, or auto-publish didn't finish — it waits in the
   *  Publish command center). */
  stagedWaiting: boolean;
  /** R13a: the one waiting update (newest, not superseded) and why it waits.
   *  When present the step links to where that reason is FIXED
   *  (menu-waiting-link-core), never to the bare Publish page. */
  waitingVersion?: WaitingMenuVersion | null;
  /** R13a: the delivery, so the link opens its products / returns to it. */
  manifestId?: string | null;
};

export type MenuStepView = {
  state: MenuStepState;
  /** Plain-English "what do I do here?" override for the ribbon when the
   *  menu step is the story — null falls back to the accept-stage copy. */
  line: string | null;
  /** Deep-link that advances the step (drafts page / Publish command center), or null. */
  href: string | null;
  /** Label for the deep-link button, or null. */
  linkLabel: string | null;
};

export const MENU_STEP_LABEL = "On menu";
export const DRAFTS_PATH = "/admin/inventory/drafts";
/** S00: held / failed intake updates are handled in the Publish command center
 *  (admin nav "Publish Menu"). Re-exported from the ONE shared definition. */
export { PUBLISH_CENTER_PATH };

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

  if (input.stagedWaiting && input.waitingVersion) {
    const fix = waitingMenuFix({ manifestId: input.manifestId ?? null, version: input.waitingVersion });
    return { state: "current", line: fix.fixText, href: fix.href, linkLabel: fix.label };
  }

  if (input.stagedWaiting) {
    // Legacy input without the named row (a caller that only has the flag).
    return {
      state: "current",
      line: "A menu update from this delivery is waiting instead of going live — either a product has a fact that needs a second look, or the automatic publish didn't finish. Open the Publish command center, check what it names, and press Publish.",
      href: PUBLISH_CENTER_PATH,
      linkLabel: "Review & publish",
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

  // Staged-but-unpublished (held or failed) → current, deep-links to the
  // Publish command center — never the one-time Menu Imports page (S00).
  const stuck = menuStep("accepted", counts(0, 2, true));
  ok(stuck.state === "current", "stagedWaiting → current");
  ok(stuck.line !== null && stuck.line.includes("Publish command center"), "stagedWaiting line names the command center");
  ok(stuck.line !== null && stuck.line.includes("second look"), "stagedWaiting line covers the fact-review hold");
  ok(stuck.line !== null && !/menu imports/i.test(stuck.line), "stagedWaiting line never says Menu Imports");
  ok(stuck.href === PUBLISH_CENTER_PATH && stuck.linkLabel === "Review & publish", "stagedWaiting → publish-center deep-link");

  // R13a: with the named waiting row, the step goes where the reason is fixed.
  const M = "11111111-2222-4333-8444-555555555555";
  const held = menuStep("accepted", { ...counts(0, 2, true), manifestId: M, waitingVersion: { id: "v1", state: "held_for_fact_review" } });
  ok(held.state === "current", "held fact -> current");
  ok(held.href === `${DRAFTS_PATH}?status=approved&manifest=${M}`, "held fact -> this delivery's approved products");
  ok(held.linkLabel === "Check the flagged facts", "held fact label");
  ok(held.line !== null && held.line.includes("second look") && !/menu imports/i.test(held.line), "held fact line");
  const cut = menuStep("accepted", { ...counts(0, 2, true), manifestId: M, waitingVersion: { id: "v2", state: "held_for_cutover" } });
  ok(cut.href === "/admin/menu-imports/cutover", "cutover hold -> cutover page");
  const failed = menuStep("accepted", { ...counts(0, 2, true), manifestId: M, waitingVersion: { id: "v3", state: "auto_publish_failed" } });
  ok(failed.href !== null && failed.href.startsWith("/admin/menu-imports/version/v3?back="), "failed -> the update's review page");
  ok(failed.href !== PUBLISH_CENTER_PATH && held.href !== PUBLISH_CENTER_PATH, "never the bare Publish page with a named row");
  const pendingFirst = menuStep("accepted", { ...counts(1, 0, true), manifestId: M, waitingVersion: { id: "v1", state: "held_for_fact_review" } });
  ok(pendingFirst.href === DRAFTS_PATH, "pending still outranks a named waiting row");
  const noFlag = menuStep("accepted", { ...counts(0, 2, false), manifestId: M, waitingVersion: { id: "v1", state: "held_for_fact_review" } });
  ok(noFlag.state === "done", "stagedWaiting false wins over a stray row");

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
