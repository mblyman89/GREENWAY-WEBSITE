/**
 * src/lib/syndication/preflight-triage-core.ts  (R74 S29 -- pure, no I/O)
 *
 * OWNER, ROUND 13 (verbatim, follow-up):
 *   "this is the message I get when I try a post, 'The menu data itself
 *   failed its safety check, so no payload could be built. This is about the
 *   feed, not individual products.'. same message when I click the 'Fix the
 *   size problem automatically before sending...' button."
 *
 * WHAT WAS WRONG (measured, not assumed)
 * --------------------------------------
 * `buildFullMenuDecision` ran `runPreflight` over the whole feed and THREW on
 * any preflight error. The comment beside it said preflight errors are
 * "structural problems with the feed itself", and the two Leafly actions
 * repeated that claim to the owner. Reading `preflight-core.ts` disproves it:
 * of the five preflight ERROR codes, only two are about the feed --
 *
 *   duplicate_item_id     two products share one id    -> feed is broken
 *   duplicate_variant_id  two products share a size id -> feed is broken
 *
 * -- and the other three are about ONE product each:
 *
 *   missing_name          this product has no name
 *   nonpositive_price     this product (or one of its sizes) is priced $0
 *   leafly_missing_weight this flower size has no readable weight
 *
 * A reproduction of the owner's imported Cultivera menu through the real
 * transformer and the real preflight found exactly one error: a $0 size on
 * "Mfused Lemon Loopz Beverage 60ml" (priced $0 in Cultivera). One product
 * with a $0 price stopped ~486 products from reaching Leafly, and the screen
 * told him it was "not about individual products" -- the opposite of true.
 *
 * WHAT THIS DOES
 * --------------
 * Splits a preflight report into the two kinds:
 *
 *   - STRUCTURAL errors still stop everything. Withholding cannot fix two
 *     products claiming the same id; whichever one is sent, Leafly's record of
 *     the other is overwritten. That refusal is right and stays.
 *   - PER-PRODUCT errors name the product, and the "hold back only the bad
 *     ones" flows hold THAT product back (with the real reason and a fix
 *     link) and send the rest -- exactly what they already do for products
 *     Leafly's own contract rejects. Nothing bad is ever sent: the held-back
 *     product is removed from the feed BEFORE the payload is built.
 *
 * The all-or-nothing push (`pushLeaflyMenu`) keeps refusing on any error --
 * that is its documented contract -- but every refusal now NAMES the
 * products and says how to fix them, instead of a generic sentence.
 *
 * Warnings are never withheld (unchanged rule: warnings do not block).
 */

import type { PreflightIssue, PreflightReport } from "./preflight-core";

/** Error codes that are about the feed as a whole. Withholding cannot fix them. */
export const STRUCTURAL_PREFLIGHT_CODES: ReadonlySet<string> = new Set([
  "duplicate_item_id",
  "duplicate_variant_id",
]);

/** Error codes that are about one product. Holding that product back fixes them. */
export const PER_PRODUCT_PREFLIGHT_CODES: ReadonlySet<string> = new Set([
  "missing_name",
  "nonpositive_price",
  "leafly_missing_weight",
]);

export type PreflightHeldProduct = {
  itemId: string;
  itemName: string | null;
  codes: string[];
  reasons: string[];
  /** Each finding with its own code, in report order (codes[] is deduped). */
  entries: { code: string; message: string }[];
};

export type PreflightTriage = {
  /** Errors nothing can fix by holding products back. Non-empty => stop. */
  structural: PreflightIssue[];
  /**
   * Errors of a code this module does not recognise. Treated as structural
   * (fail closed): a new preflight rule must be classified on purpose before
   * a flow is allowed to withhold its way past it.
   */
  unclassified: PreflightIssue[];
  /** Products to hold back, one entry per product, sorted by id. */
  held: PreflightHeldProduct[];
  /** The ids in `held`, for filtering the feed. */
  heldIds: Set<string>;
  /** True when the feed may be sent once `heldIds` are removed. */
  sendableAfterHolding: boolean;
};

function trim(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Classify a preflight report for one channel.
 *
 * @param report      The full preflight report.
 * @param channel     Only errors that matter to this channel are considered.
 * @param nameOf      Product name by id, for the owner-facing list.
 */
export function triagePreflight(
  report: PreflightReport,
  channel: "leafly" | "weedmaps",
  nameOf?: (itemId: string) => string | null,
): PreflightTriage {
  const structural: PreflightIssue[] = [];
  const unclassified: PreflightIssue[] = [];
  const byItem = new Map<string, PreflightIssue[]>();

  for (const issue of report?.issues ?? []) {
    if (issue.severity !== "error") continue;
    const channels = Array.isArray(issue.channels) ? issue.channels : [];
    if (!channels.includes(channel)) continue;
    const code = trim(issue.code);
    if (STRUCTURAL_PREFLIGHT_CODES.has(code)) {
      structural.push(issue);
      continue;
    }
    const id = trim(issue.itemId);
    if (!PER_PRODUCT_PREFLIGHT_CODES.has(code) || id.length === 0) {
      unclassified.push(issue);
      continue;
    }
    const bucket = byItem.get(id);
    if (bucket === undefined) byItem.set(id, [issue]);
    else bucket.push(issue);
  }

  const held: PreflightHeldProduct[] = [];
  for (const [itemId, list] of byItem) {
    const name = nameOf ? nameOf(itemId) : null;
    held.push({
      itemId,
      itemName: name && name.trim().length > 0 ? name : null,
      codes: Array.from(new Set(list.map((i) => trim(i.code)))).sort(),
      reasons: list.map((i) => i.message),
      entries: list.map((i) => ({ code: trim(i.code), message: i.message })),
    });
  }
  held.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  return {
    structural,
    unclassified,
    held,
    heldIds: new Set(held.map((h) => h.itemId)),
    sendableAfterHolding: structural.length === 0 && unclassified.length === 0,
  };
}

/** Plain-words fix for one code. */
export function preflightFixHint(code: string): string {
  switch (code) {
    case "nonpositive_price":
      return "Give it a real price (open the product, or the lot page, and set the price).";
    case "missing_name":
      return "Give the product a name.";
    case "leafly_missing_weight":
      return 'Fix the size label so it states a weight, e.g. "3.5g" or "1 oz".';
    case "duplicate_item_id":
      return "Two products share one id. This needs a developer -- it is not fixed by editing a product.";
    case "duplicate_variant_id":
      return "Two products share one size id. This needs a developer -- it is not fixed by editing a product.";
    default:
      return "Open the product and correct it.";
  }
}

/**
 * The owner-facing explanation when a send is refused by preflight.
 *
 * Replaces the old sentence, which claimed every preflight refusal was "about
 * the feed, not individual products" -- false for three of the five codes.
 * Names up to `limit` problems, each with the product and the fix.
 */
export function describePreflightRefusal(
  report: PreflightReport,
  channel: "leafly" | "weedmaps",
  nameOf?: (itemId: string) => string | null,
  limit = 10,
): string {
  const t = triagePreflight(report, channel, nameOf);
  const parts: string[] = [];
  const hard = [...t.structural, ...t.unclassified];
  if (hard.length > 0) {
    parts.push(
      `Nothing was sent. ${hard.length} problem${hard.length === 1 ? "" : "s"} affect${hard.length === 1 ? "s" : ""} ` +
        `the menu as a whole, so holding products back cannot fix ${hard.length === 1 ? "it" : "them"}: ` +
        hard
          .slice(0, limit)
          .map((i) => `${i.message} ${preflightFixHint(trim(i.code))}`)
          .join(" | ") +
        (hard.length > limit ? ` | ...and ${hard.length - limit} more.` : ""),
    );
  }
  if (t.held.length > 0) {
    const lines = t.held.slice(0, limit).map((h) => {
      const who = h.itemName ? `${h.itemName} (${h.itemId})` : h.itemId;
      return `${who}: ${h.reasons[0] ?? "No reason recorded."} ${preflightFixHint(h.codes[0] ?? "")}`;
    });
    parts.push(
      `${t.held.length} product${t.held.length === 1 ? " has" : "s have"} a problem that would put bad data on ` +
        `the menu: ${lines.join(" | ")}` +
        (t.held.length > limit ? ` | ...and ${t.held.length - limit} more.` : "") +
        (hard.length === 0
          ? ` Fix ${t.held.length === 1 ? "it" : "them"}, or use "Send my whole menu, hold back only the bad ones", ` +
            `which now holds ${t.held.length === 1 ? "this product" : "these products"} back by name and sends the rest.`
          : ""),
    );
  }
  if (parts.length === 0) {
    return "Nothing was sent: the safety check refused the menu but recorded no error. This needs a developer.";
  }
  return parts.join(" ");
}

/* ========================================================================== */
/* Self-tests                                                                 */
/* ========================================================================== */

export function __runPreflightTriageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[preflight-triage-core] FAILED: ${name}`);
    }
  };
  const issue = (
    code: PreflightIssue["code"],
    itemId: string,
    severity: "error" | "warning" = "error",
    channels: ("leafly" | "weedmaps")[] = ["leafly", "weedmaps"],
  ): PreflightIssue => ({ severity, code, channels, itemId, message: `${code} on ${itemId}` });
  const report = (issues: PreflightIssue[]): PreflightReport => {
    const errorCount = issues.filter((i) => i.severity === "error").length;
    return { ok: errorCount === 0, errorCount, warningCount: issues.length - errorCount, issues };
  };
  const names: Record<string, string> = { a: "Alpha", b: "Bravo", m: "Mfused Lemon Loopz Beverage 60ml" };
  const nameOf = (id: string) => names[id] ?? null;

  // 1. The owner's real case: one $0 size.
  const owner = triagePreflight(report([issue("nonpositive_price", "m")]), "leafly", nameOf);
  ok("owner case: sendable after holding", owner.sendableAfterHolding);
  ok("owner case: one product held", owner.held.length === 1 && owner.heldIds.has("m"));
  ok("owner case: named", owner.held[0]?.itemName === "Mfused Lemon Loopz Beverage 60ml");
  ok("owner case: code kept", owner.held[0]?.codes.join(",") === "nonpositive_price");
  ok("owner case: no structural", owner.structural.length === 0);

  // 2. Structural codes still stop.
  const dupItem = triagePreflight(report([issue("duplicate_item_id", "a")]), "leafly");
  ok("duplicate item id is structural", dupItem.structural.length === 1);
  ok("duplicate item id not sendable", !dupItem.sendableAfterHolding);
  ok("duplicate item id holds nothing", dupItem.held.length === 0);
  const dupVar = triagePreflight(report([issue("duplicate_variant_id", "b")]), "leafly");
  ok("duplicate variant id is structural", !dupVar.sendableAfterHolding && dupVar.structural.length === 1);

  // 3. Mixed: structural wins, per-product still listed.
  const mixed = triagePreflight(
    report([issue("duplicate_item_id", "a"), issue("missing_name", "b")]),
    "leafly",
    nameOf,
  );
  ok("mixed: not sendable", !mixed.sendableAfterHolding);
  ok("mixed: per-product still named", mixed.held.length === 1 && mixed.held[0]?.itemId === "b");

  // 4. Warnings never withhold.
  const warnOnly = triagePreflight(
    report([issue("long_name", "a", "warning"), issue("unparseable_weight", "b", "warning", ["weedmaps"])]),
    "leafly",
  );
  ok("warnings: nothing held", warnOnly.held.length === 0);
  ok("warnings: sendable", warnOnly.sendableAfterHolding);

  // 5. Channel filter: a weedmaps-only error is not Leafly's problem.
  const wmOnly: PreflightIssue = {
    severity: "error",
    code: "nonpositive_price",
    channels: ["weedmaps"],
    itemId: "a",
    message: "x",
  };
  ok("other channel ignored", triagePreflight(report([wmOnly]), "leafly").held.length === 0);
  ok("own channel counted", triagePreflight(report([wmOnly]), "weedmaps").held.length === 1);

  // 6. Every per-product code holds.
  for (const code of ["missing_name", "nonpositive_price", "leafly_missing_weight"] as const) {
    const t = triagePreflight(report([issue(code, "a", "error", ["leafly"])]), "leafly");
    ok(`${code} holds the product`, t.heldIds.has("a") && t.sendableAfterHolding);
  }

  // 7. Fail closed on an unknown code / blank id.
  const unknown = triagePreflight(
    report([{ ...issue("missing_name", "a"), code: "brand_new_rule" as PreflightIssue["code"] }]),
    "leafly",
  );
  ok("unknown code is unclassified", unknown.unclassified.length === 1);
  ok("unknown code not sendable", !unknown.sendableAfterHolding);
  const blank = triagePreflight(report([issue("nonpositive_price", "  ")]), "leafly");
  ok("blank id cannot be held", blank.unclassified.length === 1 && !blank.sendableAfterHolding);

  // 8. Several problems on one product -> one entry, all reasons, sorted codes.
  const multi = triagePreflight(
    report([issue("nonpositive_price", "a"), issue("missing_name", "a"), issue("nonpositive_price", "a")]),
    "leafly",
  );
  ok("one entry per product", multi.held.length === 1);
  ok("all reasons kept", multi.held[0]?.reasons.length === 3);
  ok(
    "entries keep each code with its message",
    multi.held[0]?.entries.map((e) => e.code).join(",") === "nonpositive_price,missing_name,nonpositive_price",
  );
  ok("codes distinct and sorted", multi.held[0]?.codes.join(",") === "missing_name,nonpositive_price");

  // 9. Stable order.
  const order = triagePreflight(
    report([issue("missing_name", "z"), issue("missing_name", "b"), issue("missing_name", "m")]),
    "leafly",
  );
  ok("sorted by id", order.held.map((h) => h.itemId).join(",") === "b,m,z");

  // 10. Empty / null-ish report.
  const empty = triagePreflight(report([]), "leafly");
  ok("empty: sendable, nothing held", empty.sendableAfterHolding && empty.held.length === 0);
  ok(
    "null issues tolerated",
    triagePreflight({ ok: true, errorCount: 0, warningCount: 0, issues: undefined as unknown as PreflightIssue[] }, "leafly")
      .sendableAfterHolding,
  );

  // 11. The refusal text.
  const text = describePreflightRefusal(report([issue("nonpositive_price", "m")]), "leafly", nameOf);
  ok("text names the product", text.includes("Mfused Lemon Loopz Beverage 60ml (m)"));
  ok("text gives the fix", text.includes("real price"));
  ok("text points to the hold-back button", text.includes("hold back only the bad ones"));
  ok("text never claims it is not about products", !/not about individual products/i.test(text));
  const hardText = describePreflightRefusal(report([issue("duplicate_item_id", "a")]), "leafly");
  ok("structural text says it affects the whole menu", hardText.includes("menu as a whole"));
  ok("structural text says developer", hardText.includes("developer"));
  ok("structural text does not offer hold-back", !hardText.includes("hold back only the bad ones"));
  const many = describePreflightRefusal(
    report(Array.from({ length: 13 }, (_, i) => issue("missing_name", `p${String(i).padStart(2, "0")}`))),
    "leafly",
    undefined,
    10,
  );
  ok("text caps the list", many.includes("...and 3 more."));
  ok("text with nothing recorded is honest", describePreflightRefusal(report([]), "leafly").includes("developer"));

  // 12. Hints.
  ok("hint for price", preflightFixHint("nonpositive_price").includes("price"));
  ok("hint for weight", preflightFixHint("leafly_missing_weight").includes("3.5g"));
  ok("hint for duplicates is a developer", preflightFixHint("duplicate_variant_id").includes("developer"));
  ok("hint default", preflightFixHint("x").length > 0);

  // 13. Sets are disjoint and cover every preflight error code.
  const allErrorCodes = ["duplicate_item_id", "duplicate_variant_id", "missing_name", "nonpositive_price", "leafly_missing_weight"];
  ok(
    "every error code classified exactly once",
    allErrorCodes.every(
      (c) => Number(STRUCTURAL_PREFLIGHT_CODES.has(c)) + Number(PER_PRODUCT_PREFLIGHT_CODES.has(c)) === 1,
    ),
  );

  return { passed, failed };
}
