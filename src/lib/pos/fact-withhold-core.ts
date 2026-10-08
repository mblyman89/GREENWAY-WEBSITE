/**
 * src/lib/pos/fact-withhold-core.ts  (Round 27, slice R27-1 - one flagged
 * product no longer blocks the whole delivery)
 *
 * PURE. No fs, no network, no Supabase, no clock.
 *
 * THE OWNER'S REPORT (round 27, screenshots of the Publish page and Product
 * Onboarding): two accepted deliveries, 34 products; the Publish page says
 * "Waiting: 3 facts need a second look" and "Adds 7 products" - and a product
 * whose facts he DID save (Apple Cardamom) is still not live.
 *
 * WHY (verified in code, not assumed)
 *   intake-menu-staging.ts wrote `initialPublishOutcome(factFlags.length)`:
 *   while ANY fact flag on a delivery was unanswered, the WHOLE snapshot was
 *   held - so 3 open flags (bytes Raspberry Peach / Honeydew Melon / Sour
 *   Mandarin) kept the other 4 new products off the website and the register,
 *   including the one he fixed. A fix re-staged the delivery and it was held
 *   again by the other two.
 *
 * THE FIX (this module decides; the staging executor obeys)
 *   1. The lots of the UNRESOLVED flags are taken out of the approved drafts
 *      (planFactWithhold) and the delivery is planned again WITHOUT them. The
 *      re-plan masters the remaining lots on their own, so no card can show
 *      an unverified lot's facts (a grouped card's facts come from its base
 *      lot - removing only a size would have left those facts on the card).
 *   2. Each withheld flag is kept on the version, marked
 *      context.withheld = true (markWithheld), so Product Onboarding still
 *      shows its fix panel and the Publish page lists it as "kept off the
 *      menu" - never a silent drop (Rule 3.3).
 *   3. If nothing else on the delivery is new, the update holds exactly as
 *      before (decideWithhold "hold") - nothing gained by publishing an
 *      unchanged menu, and the existing hold path stays the safe default.
 *   4. A failed decision read still fails CLOSED: an unresolved flag's lot is
 *      never published; only the products with nothing to verify go live.
 *
 * Kill switch: INTAKE_FACT_WITHHOLD=off restores the whole-delivery hold.
 *
 * Embedded self-tests at the bottom (run-pure-selftests.ts).
 */

/** The diagnostic shape staging produces (InjectionDiagnostic, structurally). */
export type WithholdDiagnostic = {
  severity: "info" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

/** The env switch (default ON; only an explicit off/false/0 disables it). */
export const FACT_WITHHOLD_ENV = "INTAKE_FACT_WITHHOLD";

export function factWithholdEnabled(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0" || v === "no");
}

/** manifest_events.event_type when an update published with products kept off. */
export const WITHHELD_EVENT = "menu_published_some_withheld";

/** The timeline note (what happened and where the facts are set, plainly). */
export function withheldNote(n: number): string {
  const count = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const what = count === 1 ? "1 product was" : `${count} products were`;
  return `The menu update published. ${what} kept off the menu and the register because a fact could not be verified \u2014 set the facts on Product Onboarding \u2192 Approved (the highlighted products) and each one goes live by itself.`;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const keyOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** The lot key a flag is about (context.pos_product_key), trimmed. */
export function withheldKeyOf(flag: unknown): string | null {
  if (!isObj(flag) || !isObj(flag.context)) return null;
  return keyOf(flag.context.pos_product_key);
}

export type WithholdPlan<D> = {
  /** Lot keys kept off this update. */
  withheldKeys: Set<string>;
  /** The approved drafts the delivery is planned again with. */
  keepDrafts: D[];
  /** Draft ids kept off (every draft carrying a withheld key). */
  withheldDraftIds: string[];
  /** Flags whose lot key could not be read: they cannot be withheld alone. */
  unkeyed: number;
};

/**
 * Split the approved drafts: every draft whose POS key is the lot of an
 * unresolved flag is kept off; the rest are planned again. A flag with no
 * readable lot key cannot be isolated, so it is counted in `unkeyed` and the
 * caller must hold the whole update (decideWithhold) - never guess which
 * product it meant.
 */
export function planFactWithhold<D extends { id: string; pos_product_key: string | null }>(input: {
  unresolved: readonly unknown[];
  drafts: readonly D[];
}): WithholdPlan<D> {
  const withheldKeys = new Set<string>();
  let unkeyed = 0;
  for (const f of input.unresolved) {
    const k = withheldKeyOf(f);
    if (k) withheldKeys.add(k);
    else unkeyed += 1;
  }
  const keepDrafts: D[] = [];
  const withheldDraftIds: string[] = [];
  for (const d of input.drafts) {
    const k = keyOf(d.pos_product_key);
    if (k && withheldKeys.has(k)) withheldDraftIds.push(d.id);
    else keepDrafts.push(d);
  }
  return { withheldKeys, keepDrafts, withheldDraftIds, unkeyed };
}

/**
 * Copies of the flags with context.withheld = true (the input is never
 * mutated - the first plan's diagnostics stay as the engine wrote them).
 */
export function markWithheld<F extends WithholdDiagnostic>(flags: readonly F[]): F[] {
  return flags.map((f) => ({ ...f, context: { ...(isObj(f.context) ? f.context : {}), withheld: true } }));
}

export type WithholdDecision =
  | { kind: "none" }
  | { kind: "hold"; why: "disabled" | "unkeyed" | "nothing_else" | "replan_flagged" }
  | { kind: "withhold" };

/**
 * What staging does with its unresolved flags.
 *   none     - nothing unresolved: publish as normal.
 *   hold     - hold the WHOLE update as before: the switch is off, a flag
 *              cannot be tied to one lot, nothing else is new, or the re-plan
 *              raised an unresolved flag of its own (defensive - it cannot
 *              under the current engine, which flags per draft).
 *   withhold - publish the re-plan; the flagged lots stay off.
 */
export function decideWithhold(input: {
  unresolvedCount: number;
  enabled: boolean;
  unkeyed: number;
  replanHasChanges: boolean;
  replanUnresolved: number;
}): WithholdDecision {
  if (input.unresolvedCount <= 0) return { kind: "none" };
  if (!input.enabled) return { kind: "hold", why: "disabled" };
  if (input.unkeyed > 0) return { kind: "hold", why: "unkeyed" };
  if (!input.replanHasChanges) return { kind: "hold", why: "nothing_else" };
  if (input.replanUnresolved > 0) return { kind: "hold", why: "replan_flagged" };
  return { kind: "withhold" };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runFactWithholdCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL fact-withhold-core: " + msg);
    }
  };

  // switch
  ok(factWithholdEnabled(undefined), "unset -> on");
  ok(factWithholdEnabled(""), "empty -> on");
  ok(factWithholdEnabled("on"), "on -> on");
  ok(!factWithholdEnabled("off"), "off -> off");
  ok(!factWithholdEnabled(" FALSE "), "FALSE -> off (trimmed, case-insensitive)");
  ok(!factWithholdEnabled("0"), "0 -> off");
  ok(!factWithholdEnabled("no"), "no -> off");

  // note
  ok(withheldNote(1).includes("1 product was kept off"), "singular note");
  ok(withheldNote(3).includes("3 products were kept off"), "plural note");
  ok(withheldNote(Number.NaN).includes("0 products"), "NaN note honest");
  ok(withheldNote(2).includes("Product Onboarding"), "note says where to fix");
  ok(WITHHELD_EVENT === "menu_published_some_withheld", "event name");

  // keys
  const flag = (key: unknown, extra: Record<string, unknown> = {}): WithholdDiagnostic => ({
    severity: "warning",
    code: "fact_extraction_review",
    message: "m",
    context: { pos_product_key: key, draft_id: "d", ...extra },
  });
  ok(withheldKeyOf(flag(" K1 ")) === "K1", "key trimmed");
  ok(withheldKeyOf(flag("")) === null, "blank key null");
  ok(withheldKeyOf({ code: "x" }) === null, "no context null");
  ok(withheldKeyOf(null) === null, "null flag null");

  // plan
  const drafts = [
    { id: "a", pos_product_key: "K1" },
    { id: "b", pos_product_key: " K2 " },
    { id: "c", pos_product_key: "K3" },
    { id: "d", pos_product_key: null },
    { id: "e", pos_product_key: "K1" },
  ];
  const p = planFactWithhold({ unresolved: [flag("K1"), flag("K2")], drafts });
  ok(p.withheldKeys.size === 2 && p.withheldKeys.has("K1") && p.withheldKeys.has("K2"), "withheld keys");
  ok(p.keepDrafts.map((d) => d.id).join(",") === "c,d", "kept drafts keep order; keyless kept");
  ok(p.withheldDraftIds.join(",") === "a,b,e", "every draft of a withheld key is kept off (dupes too, padded key too)");
  ok(p.unkeyed === 0, "no unkeyed");
  const pu = planFactWithhold({ unresolved: [flag(null), { nope: 1 }], drafts });
  ok(pu.unkeyed === 2 && pu.keepDrafts.length === drafts.length, "unkeyed flags withhold nothing and are counted");
  const pe = planFactWithhold({ unresolved: [], drafts });
  ok(pe.keepDrafts.length === 5 && pe.withheldDraftIds.length === 0, "nothing unresolved keeps everything");

  // mark
  const orig = [flag("K1")];
  const marked = markWithheld(orig);
  ok(marked[0].context?.withheld === true, "marked withheld");
  ok(marked[0].context?.pos_product_key === "K1" && marked[0].context?.draft_id === "d", "context kept");
  ok(orig[0].context?.withheld === undefined, "input not mutated");
  ok(marked[0] !== orig[0], "a copy");
  const noCtx = markWithheld([{ severity: "warning", code: "c", message: "m" } as WithholdDiagnostic]);
  ok(noCtx[0].context?.withheld === true, "flag without context gains one");

  // decide
  const base = { unresolvedCount: 2, enabled: true, unkeyed: 0, replanHasChanges: true, replanUnresolved: 0 };
  ok(decideWithhold({ ...base, unresolvedCount: 0 }).kind === "none", "nothing unresolved -> none");
  ok(decideWithhold(base).kind === "withhold", "happy path -> withhold");
  const why = (d: WithholdDecision) => (d.kind === "hold" ? d.why : d.kind);
  ok(why(decideWithhold({ ...base, enabled: false })) === "disabled", "switch off -> hold");
  ok(why(decideWithhold({ ...base, unkeyed: 1 })) === "unkeyed", "unkeyed -> hold");
  ok(why(decideWithhold({ ...base, replanHasChanges: false })) === "nothing_else", "nothing else new -> hold");
  ok(why(decideWithhold({ ...base, replanUnresolved: 1 })) === "replan_flagged", "replan flagged -> hold");
  ok(why(decideWithhold({ ...base, enabled: false, unresolvedCount: 0 })) === "none", "none outranks the switch");

  return { passed, failed };
}
