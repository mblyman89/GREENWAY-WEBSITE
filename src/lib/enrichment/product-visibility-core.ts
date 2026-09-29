/**
 * src/lib/enrichment/product-visibility-core.ts  (Round 12 — Cultivera fix reachability)
 *
 * PURE planner for the product page's Visibility control
 * ("Inherit POS" / "Always show" / "Always hide").
 *
 * ═══ THE DEAD END THIS CLOSES (verified, not assumed) ═══
 *
 * The Visibility select wrote ONLY `product_enrichments.hidden_override`
 * (src/app/admin/products/actions.ts). The one reader of that column is
 * `mergeForDisplay` (src/lib/enrichment/store.ts), which has NO callers
 * (card-identity-core.ts calls it "orphaned"). Everything that actually
 * decides whether a card is shown reads `menu_items.hidden`:
 *   - the website            live-menu.ts  (row.hidden → item.hidden)
 *   - the register feed      api/pos/menu  (item.hidden)
 *   - the sellability report register-sellability-store (menu_items.hidden)
 * So "Always show" changed nothing anywhere, and the blocked-stock fix link
 * "Un-hide on the product page" (blocked-stock-fix-core.ts, hidden_card)
 * sent the owner to a control that did not work. The cards it matters for
 * are exactly the Cultivera-upload cards the importer hid:
 * `no_product_master` (transform.ts, 771 on the owner's real export) and
 * `no_inventory`.
 *
 * ═══ THE FIX ═══
 *
 * Saving Visibility now ALSO writes `menu_items.hidden` on the live versions
 * (published + staged intake versions — the same set the lot price write
 * uses, price-write-store.ts). This module decides WHAT to write, per row,
 * and it is REVERSIBLE by construction:
 *
 *   The prior POS state is carried inside `hidden_reason` as
 *   `owner_override_show:<prior>` / `owner_override_hide:<prior>`, where
 *   <prior> is the importer's own reason ("no_product_master", …) or empty
 *   when the POS had the card visible. "Inherit POS" decodes that and puts
 *   back exactly what the importer wrote. Nothing is ever lost, and a row
 *   that was never overridden is never touched by "Inherit".
 *
 * Readers that care about `hidden_reason` were checked:
 *   - missing-product-master-core requires `hidden && reason === no_product_master`
 *     → an un-hidden (shown) row correctly leaves that worklist; "Inherit"
 *     restores the exact reason so it returns.
 *   - fact-review-store un-hides only `reason = reviewer_rejected` → an owner
 *     override is never silently undone by a reviewer approve.
 *   - fact-review-core buckets by `hidden` only; hiddenReasonText explains the
 *     owner prefix (see there).
 *
 * Pure: plain data in, plain data out. No I/O.
 */

export type VisibilityChoice = "inherit" | "show" | "hide";

export const OVERRIDE_SHOW_PREFIX = "owner_override_show:";
export const OVERRIDE_HIDE_PREFIX = "owner_override_hide:";
/**
 * Encodes "the POS had it hidden but recorded no reason", so that case also
 * round-trips exactly (hidden:true, hidden_reason:null) instead of coming
 * back visible. An empty suffix means "the POS had it visible".
 */
export const PRIOR_HIDDEN_NO_REASON = "~";

/** Normalise the raw form value. Anything unknown is "inherit" (the safe no-op). */
export function parseVisibilityChoice(raw: unknown): VisibilityChoice {
  const s = String(raw ?? "").trim();
  return s === "show" || s === "hide" ? s : "inherit";
}

/** The enrichment column value for a choice (null = inherit). */
export function hiddenOverrideFor(choice: VisibilityChoice): boolean | null {
  return choice === "inherit" ? null : choice === "hide";
}

export type MenuRowVisibility = { hidden: boolean; hidden_reason: string | null };

/** Is this row currently carrying an owner override written by this module? */
export function isOwnerOverride(reason: string | null | undefined): boolean {
  const r = reason ?? "";
  return r.startsWith(OVERRIDE_SHOW_PREFIX) || r.startsWith(OVERRIDE_HIDE_PREFIX);
}

/**
 * The state the POS/importer gave this row, before any owner override.
 * For a never-overridden row that is simply the row itself.
 */
export function posStateOf(row: MenuRowVisibility): MenuRowVisibility {
  const r = row.hidden_reason ?? "";
  for (const prefix of [OVERRIDE_SHOW_PREFIX, OVERRIDE_HIDE_PREFIX]) {
    if (r.startsWith(prefix)) {
      const prior = r.slice(prefix.length);
      if (prior === "") return { hidden: false, hidden_reason: null };
      if (prior === PRIOR_HIDDEN_NO_REASON) return { hidden: true, hidden_reason: null };
      return { hidden: true, hidden_reason: prior };
    }
  }
  return { hidden: row.hidden, hidden_reason: row.hidden_reason ?? null };
}

/**
 * What to write to one menu_items row for a choice, or null when the row is
 * already in that state (no write, no churn).
 */
export function planRowVisibility(
  row: MenuRowVisibility,
  choice: VisibilityChoice,
): MenuRowVisibility | null {
  const pos = posStateOf(row);
  let next: MenuRowVisibility;
  if (choice === "inherit") {
    // Only undoes OUR override: for a row nobody overrode, posStateOf returns
    // the row unchanged, so the no-op check below returns null (no write).
    next = pos;
  } else {
    const prior = pos.hidden ? pos.hidden_reason || PRIOR_HIDDEN_NO_REASON : "";
    next =
      choice === "show"
        ? { hidden: false, hidden_reason: OVERRIDE_SHOW_PREFIX + prior }
        : { hidden: true, hidden_reason: OVERRIDE_HIDE_PREFIX + prior };
  }
  if (next.hidden === row.hidden && (next.hidden_reason ?? null) === (row.hidden_reason ?? null)) return null;
  return next;
}

/** Plain-English line for the product page: what the live menu does right now. */
export function liveVisibilityText(row: MenuRowVisibility): string {
  const pos = posStateOf(row);
  const posPart = pos.hidden
    ? `the POS import hid it${pos.hidden_reason ? ` (${pos.hidden_reason})` : ""}`
    : "the POS import had it visible";
  const r = row.hidden_reason ?? "";
  if (r.startsWith(OVERRIDE_SHOW_PREFIX)) return `Shown on the live menu by your override — ${posPart}.`;
  if (r.startsWith(OVERRIDE_HIDE_PREFIX)) return `Hidden on the live menu by your override — ${posPart}.`;
  return row.hidden ? `Hidden on the live menu — ${posPart}.` : "Visible on the live menu.";
}

/** Does saving this choice change the live menu for this row? */
export function choiceChangesLiveMenu(row: MenuRowVisibility, choice: VisibilityChoice): boolean {
  return planRowVisibility(row, choice) !== null;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runProductVisibilityCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL product-visibility-core: " + msg);
    }
  };
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // parse
  ok(parseVisibilityChoice("show") === "show", "parse show");
  ok(parseVisibilityChoice("hide") === "hide", "parse hide");
  ok(parseVisibilityChoice("inherit") === "inherit", "parse inherit");
  ok(parseVisibilityChoice(" show ") === "show", "parse trims");
  ok(parseVisibilityChoice("SHOW") === "inherit", "parse is exact");
  ok(parseVisibilityChoice(null) === "inherit", "parse null");
  ok(parseVisibilityChoice("delete") === "inherit", "parse unknown -> inherit");

  // override column
  ok(hiddenOverrideFor("inherit") === null, "override inherit null");
  ok(hiddenOverrideFor("show") === false, "override show false");
  ok(hiddenOverrideFor("hide") === true, "override hide true");

  const master = { hidden: true, hidden_reason: "no_product_master" };
  const visible = { hidden: false, hidden_reason: null };

  // Cultivera no_product_master card: show un-hides and remembers the reason.
  const shown = planRowVisibility(master, "show");
  ok(eq(shown, { hidden: false, hidden_reason: "owner_override_show:no_product_master" }), "show un-hides master-less card");
  ok(isOwnerOverride(shown!.hidden_reason), "shown is an override");
  ok(eq(posStateOf(shown!), master), "pos state of shown row is the importer's");
  // Inherit restores EXACTLY.
  ok(eq(planRowVisibility(shown!, "inherit"), master), "inherit restores no_product_master");
  // Show again is a no-op.
  ok(planRowVisibility(shown!, "show") === null, "show on shown is no-op");
  // Hide from shown keeps the ORIGINAL prior (no nesting).
  ok(eq(planRowVisibility(shown!, "hide"), { hidden: true, hidden_reason: "owner_override_hide:no_product_master" }), "hide from shown keeps prior");

  // no_inventory card too.
  ok(eq(planRowVisibility({ hidden: true, hidden_reason: "no_inventory" }, "show"), { hidden: false, hidden_reason: "owner_override_show:no_inventory" }), "show un-hides no_inventory");

  // Visible card: hide, then inherit back to visible.
  const hid = planRowVisibility(visible, "hide");
  ok(eq(hid, { hidden: true, hidden_reason: "owner_override_hide:" }), "hide visible card");
  ok(eq(planRowVisibility(hid!, "inherit"), visible), "inherit restores visible");
  ok(eq(posStateOf(hid!), visible), "pos of hidden-visible is visible");
  // Show on a visible card still records the override (so inherit is exact).
  ok(eq(planRowVisibility(visible, "show"), { hidden: false, hidden_reason: "owner_override_show:" }), "show on visible records override");

  // Inherit on a never-overridden row never touches it.
  ok(planRowVisibility(master, "inherit") === null, "inherit leaves importer hide alone");
  ok(planRowVisibility(visible, "inherit") === null, "inherit leaves visible alone");
  ok(planRowVisibility({ hidden: true, hidden_reason: "reviewer_rejected" }, "inherit") === null, "inherit leaves reviewer reject alone");
  // A hidden row with NO reason round-trips exactly (sentinel "~").
  const bare = { hidden: true, hidden_reason: null };
  const bareShown = planRowVisibility(bare, "show");
  ok(eq(bareShown, { hidden: false, hidden_reason: "owner_override_show:~" }), "show reasonless hidden");
  ok(eq(planRowVisibility(bareShown!, "inherit"), bare), "inherit restores reasonless hidden");
  ok(eq(planRowVisibility(bare, "hide"), { hidden: true, hidden_reason: "owner_override_hide:~" }), "hide reasonless hidden");
  ok(liveVisibilityText(bareShown!) === "Shown on the live menu by your override — the POS import hid it.", "text shown bare");
  // Reviewer reject overridden by owner show: prior kept.
  ok(eq(planRowVisibility({ hidden: true, hidden_reason: "reviewer_rejected" }, "show"), { hidden: false, hidden_reason: "owner_override_show:reviewer_rejected" }), "show over reviewer reject keeps prior");
  // Hide on already-hidden importer card records override (hidden unchanged, reason changes).
  ok(eq(planRowVisibility(master, "hide"), { hidden: true, hidden_reason: "owner_override_hide:no_product_master" }), "hide on master-less records override");

  // changes
  ok(choiceChangesLiveMenu(master, "show") === true, "changes show");
  ok(choiceChangesLiveMenu(master, "inherit") === false, "no change inherit");

  // text
  ok(liveVisibilityText(visible) === "Visible on the live menu.", "text visible");
  ok(liveVisibilityText(master) === "Hidden on the live menu — the POS import hid it (no_product_master).", "text importer hidden");
  ok(liveVisibilityText(shown!) === "Shown on the live menu by your override — the POS import hid it (no_product_master).", "text shown override");
  ok(liveVisibilityText(hid!) === "Hidden on the live menu by your override — the POS import had it visible.", "text hide override");
  ok(liveVisibilityText({ hidden: true, hidden_reason: null }) === "Hidden on the live menu — the POS import hid it.", "text hidden no reason");

  return { passed, failed };
}
