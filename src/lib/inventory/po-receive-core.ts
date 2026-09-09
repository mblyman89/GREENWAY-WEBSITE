/**
 * src/lib/inventory/po-receive-core.ts
 *
 * W6 — PURE matching + planning for AUTO-RECEIVING a finalized manifest's
 * newly-activated lots against its linked purchase order's lines (the link is
 * W5 / migration 0102). No DB, no server-only: just the thinking.
 *
 * MATCHING KEY (audit Part 5, rule 8): `pos_product_key` is THE menu-matching
 * key — a lot matches a PO line by exact pos_product_key first. Only when a
 * lot has no key (or no line carries that key) do we fall back to a
 * normalized product-name match, and the plan flags those so a human can
 * double-check. Lots that match nothing are NEVER force-received — they are
 * listed for the existing manual receive form on the PO page.
 *
 * ── AMBIGUOUS NAMES ARE REFUSED, NOT GUESSED (defect A, sweep 2026-09) ──────
 *
 * This function WRITES: po-receive-store.ts calls receivePoLine(lineId, qty)
 * for every planned receipt, with no human in the loop. So a wrong match here
 * books stock against the wrong PO line and nobody ever sees an error — the
 * timeline note cheerfully says "Auto-received".
 *
 * The name fallback used to end in `candidates.find(...) ?? candidates[0]`.
 * When two PO lines normalized to the SAME name that picked one and moved on.
 * Measured over the 1,707 real strain names in the back-office database
 * (scripts/recon/receiving-sweep-part3.py): 4 raw name collisions and 12
 * full-SKU collisions, including 'Orange & Cream' vs 'Orange Cream' — two
 * genuinely different products.
 *
 * Receiving already refuses to guess an ambiguous BRAND squeeze (rule 11,
 * brand-resolve-core.ts). It must hold the same line here. An ambiguous name
 * now goes to unmatchedLots with reason "ambiguous-name" and the human
 * receives it on the PO page in thirty seconds. A miss is recoverable and
 * visible; a wrong receipt is neither.
 *
 * The KEY path deliberately keeps its old behaviour: two lines sharing one
 * pos_product_key is a duplicate-line problem, not an identity ambiguity, and
 * the "fill the line that still needs product first" rule is correct there.
 *
 * ALLOCATION: a lot's full quantity goes to ONE line (lots are physical
 * packages; splitting one lot across duplicate lines invents data we don't
 * have). When several lines share the same key/name, the first line with
 * remaining un-received quantity wins; if all are already full, the first
 * candidate takes the overflow (recorded honestly as OVER in the deltas).
 *
 * IDEMPOTENCY lives in the CALLER: finalize passes only the lot ids it
 * activated IN THIS RUN (a lot leaves quarantine exactly once), so re-running
 * finalize never double-receives.
 */

/** An accepted, newly-activated manifest lot (what physically arrived). */
export type ReceivableLot = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  received_qty: number;
};

/** A purchase-order line (what was ordered, and any prior partial receipts). */
export type ReceivablePoLine = {
  id: string;
  pos_product_key: string | null;
  product_name: string;
  order_qty: number;
  /** Quantity received on this line BEFORE this delivery (prior partials). */
  received_qty: number;
  unit: string;
};

/** One planned call to receivePoLine(lineId, qty). */
export type PlannedReceipt = {
  lineId: string;
  qty: number;
  label: string;
  matchedBy: "key" | "name";
};

/** Ordered-vs-delivered picture for ONE PO line after this delivery. */
export type LineDelta = {
  lineId: string;
  label: string;
  orderQty: number;
  previouslyReceived: number;
  deliveredNow: number;
  /** none = nothing in this delivery; exact/under/over compare TOTAL received to ordered. */
  outcome: "none" | "exact" | "under" | "over";
};

export type AutoReceivePlan = {
  receipts: PlannedReceipt[];
  deltas: LineDelta[];
  /**
   * Accepted lots this planner REFUSED to auto-receive — left for the manual
   * receive form on the PO page. Two honest reasons, kept apart because they
   * read very differently to the person holding the boxes:
   *   • "no-match"       — nothing on the PO looks like this lot at all.
   *   • "ambiguous-name" — SEVERAL PO lines normalize to this lot's name and
   *                        the lot carries no pos_product_key, so picking one
   *                        would be a guess (defect A). See the header banner.
   */
  unmatchedLots: {
    lotId: string;
    label: string;
    qty: number;
    reason: "no-match" | "ambiguous-name";
  }[];
  /** Human-readable timeline summary (manifest_events note). */
  note: string;
};

/**
 * Unit tokens that may legitimately follow a bare number in a product name.
 * Cannabis retail packaging only — deliberately a short, closed list rather
 * than a general "letters after digits" rule, because a general rule would
 * also join things like "Batch 5 A".
 */
const NAME_UNIT_TOKENS = ["mg", "g", "oz", "ml", "pk", "ct", "pc"] as const;

/**
 * Join a bare number to a following unit token: "1 g" → "1g", "10 pk" → "10pk".
 *
 * Decimals need no special handling. Punctuation stripping runs FIRST, so
 * "3.5g" is already "3 5g" and "3.5 g" is already "3 5 g"; this rule then
 * joins the trailing "5 g" and both land on the same key, "3 5g". (An earlier
 * draft used `(\d+(?: \d+)?)` to grab the whole "3 5" — mutation testing
 * proved that optional group changes nothing on any of the 2,615 real product
 * names, so it is gone rather than left as decoration.)
 *
 * /g is REQUIRED: a name may carry more than one number+unit pair, e.g.
 * "Gummies 10 pk 100 mg".
 */
const NAME_UNIT_RE = new RegExp(String.raw`\b(\d+) (${NAME_UNIT_TOKENS.join("|")})\b`, "g");

/**
 * Same normalization discipline as po-match-core's vendor names, PLUS the
 * number/unit join (defect B, sweep 2026-09).
 *
 * ── WHY NOT JUST SQUEEZE OUT ALL THE SPACES? ───────────────────────────────
 *
 * Because that is the tempting fix and it is measurably WRONG here. brandKey()
 * removes all whitespace, which is right for brands, where spacing carries no
 * meaning. In a product name spacing sits next to SIZE, and size IS identity:
 * booking a 1g delivery against a 3.5g line is exactly the wrong-line bug this
 * module now refuses to commit.
 *
 * Measured over the 2,615 real product records in the back-office database
 * (scripts/recon/receiving-name-key-measure.py):
 *
 *     normalizer   distinct keys   colliding keys
 *     current             2,615                0
 *     squeeze-all         2,614                1   <- REGRESSION on real data
 *     number+unit join    2,615                0   <- this one
 *
 * The squeeze-all collision is real, not hypothetical:
 *   'Drops 1:1 CBD Daydreamy Cranberry/MAC #4'
 *   'Drops1:1 CBD Daydreamy Cranberry / MAC #4'
 *
 * The narrow join closes 2,026 of 2,026 spacing misses (every real name with a
 * unit suffix, respelled with a space before the unit) and introduces ZERO new
 * collisions and ZERO size merges. That is why the rule is this narrow.
 */
export function normalizeProductName(s: string | null | undefined): string {
  const base = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // No lastIndex reset needed: String.prototype.replace with a /g regex sets
  // lastIndex to 0 itself (ECMA-262, RegExp.prototype[Symbol.replace]), and
  // nothing here calls .test()/.exec() on NAME_UNIT_RE. Verified by mutation
  // testing — deleting a defensive reset must be observable or not exist.
  return base.replace(NAME_UNIT_RE, "$1$2");
}

function lotLabel(lot: ReceivableLot): string {
  return lot.product_name?.trim() || lot.pos_product_key || lot.id;
}

/**
 * Match activated lots to PO lines and plan the receipts + deltas. Pure and
 * deterministic; performs NO writes.
 */
export function buildAutoReceivePlan(
  lots: ReceivableLot[],
  lines: ReceivablePoLine[],
): AutoReceivePlan {
  const plannedByLine = new Map<string, number>();
  const matchedByLine = new Map<string, "key" | "name">();
  const unmatchedLots: AutoReceivePlan["unmatchedLots"] = [];

  const remaining = (line: ReceivablePoLine): number =>
    line.order_qty - line.received_qty - (plannedByLine.get(line.id) ?? 0);

  for (const lot of lots) {
    const qty = Number(lot.received_qty ?? 0);
    if (qty <= 0) continue; // nothing physically arrived on this lot

    // 1) Exact pos_product_key match (THE key — audit rule 8).
    const key = lot.pos_product_key?.trim() || null;
    let candidates: ReceivablePoLine[] = key
      ? lines.filter((l) => (l.pos_product_key?.trim() || null) === key)
      : [];
    let matchedBy: "key" | "name" = "key";

    // 2) Fallback: normalized product-name match (flagged for human review).
    if (candidates.length === 0) {
      const name = normalizeProductName(lot.product_name);
      if (name) {
        candidates = lines.filter((l) => normalizeProductName(l.product_name) === name);
      }
      matchedBy = "name";
    }

    if (candidates.length === 0) {
      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty, reason: "no-match" });
      continue;
    }

    // 2a) REFUSE an ambiguous NAME match. Two PO lines whose names normalize
    //     the same are two different products as far as we can prove, and
    //     this function writes. Hand it to a human instead of guessing.
    //
    //     Only the NAME path is refused. The KEY path above is allowed to have
    //     several candidates: a shared pos_product_key means duplicate lines
    //     for the SAME product, where "fill the line that still needs product"
    //     is the right answer, not an identity guess.
    if (matchedBy === "name" && candidates.length > 1) {
      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty, reason: "ambiguous-name" });
      continue;
    }

    // Prefer the first candidate line that still NEEDS product; otherwise the
    // first candidate absorbs the overflow (honest OVER in the deltas).
    const target = candidates.find((l) => remaining(l) > 0) ?? candidates[0];
    plannedByLine.set(target.id, (plannedByLine.get(target.id) ?? 0) + qty);
    // A line that got ANY name-based allocation is flagged "name".
    if (matchedBy === "name" || !matchedByLine.has(target.id)) {
      if (matchedBy === "name") matchedByLine.set(target.id, "name");
      else if (!matchedByLine.has(target.id)) matchedByLine.set(target.id, "key");
    }
  }

  const receipts: PlannedReceipt[] = [];
  const deltas: LineDelta[] = [];
  for (const line of lines) {
    const deliveredNow = plannedByLine.get(line.id) ?? 0;
    if (deliveredNow > 0) {
      receipts.push({
        lineId: line.id,
        qty: deliveredNow,
        label: line.product_name,
        matchedBy: matchedByLine.get(line.id) ?? "key",
      });
    }
    const total = line.received_qty + deliveredNow;
    deltas.push({
      lineId: line.id,
      label: line.product_name,
      orderQty: line.order_qty,
      previouslyReceived: line.received_qty,
      deliveredNow,
      outcome:
        deliveredNow === 0
          ? "none"
          : total === line.order_qty
            ? "exact"
            : total < line.order_qty
              ? "under"
              : "over",
    });
  }

  return { receipts, deltas, unmatchedLots, note: buildNote(receipts, deltas, unmatchedLots, lots) };
}

/** Human timeline summary — what happened, what's off, what needs a human. */
function buildNote(
  receipts: PlannedReceipt[],
  deltas: LineDelta[],
  unmatchedLots: AutoReceivePlan["unmatchedLots"],
  lots: ReceivableLot[],
): string {
  // Ambiguous refusals are NOT the same story as "not on the PO" — the lot IS
  // on the PO, twice, and we declined to guess which line. Say so out loud so
  // the note never implies the product is missing from the order.
  const ambiguous = unmatchedLots.filter((u) => u.reason === "ambiguous-name");
  const noMatch = unmatchedLots.filter((u) => u.reason !== "ambiguous-name");
  const ambiguousSentence =
    ambiguous.length > 0
      ? " " +
        `${ambiguous.length} lot(s) matched SEVERAL PO lines by name and carry no POS key — ` +
        `NOT auto-received, receive them manually so the right line is credited: ` +
        ambiguous.map((u) => `“${u.label}” (${u.qty})`).join(", ") +
        "."
      : "";
  // Named in BOTH the zero-receipt and partial-receipt paths: a note that says
  // "receive them manually" without saying WHICH lots is useless at the dock.
  const noMatchSentence =
    noMatch.length > 0
      ? " Not on the PO (left for manual receive): " +
        noMatch.map((u) => `“${u.label}” (${u.qty})`).join(", ") +
        "."
      : "";

  if (receipts.length === 0) {
    return (
      `Linked PO: none of the ${lots.length} accepted lot(s) were auto-received — ` +
      `receive them manually on the PO page.` +
      noMatchSentence +
      ambiguousSentence
    ).slice(0, 2000);
  }
  const totalQty = receipts.reduce((s, r) => s + r.qty, 0);
  const parts: string[] = [
    `Auto-received against the linked PO: ${receipts.length} line(s), ${totalQty} unit(s).`,
  ];
  const nameMatched = receipts.filter((r) => r.matchedBy === "name");
  if (nameMatched.length > 0) {
    parts.push(
      `${nameMatched.length} line(s) matched by product NAME (no POS key) — double-check: ` +
        nameMatched.map((r) => `“${r.label}”`).join(", ") +
        ".",
    );
  }
  const variances = deltas.filter((d) => d.outcome === "under" || d.outcome === "over");
  if (variances.length > 0) {
    parts.push(
      "Variances: " +
        variances
          .map(
            (d) =>
              `“${d.label}” ${d.outcome === "over" ? "OVER" : "short"} — now ${
                d.previouslyReceived + d.deliveredNow
              }/${d.orderQty} ordered`,
          )
          .join("; ") +
        ".",
    );
  }
  const untouched = deltas.filter((d) => d.outcome === "none");
  if (untouched.length > 0) {
    parts.push(
      "Ordered but not in this delivery: " +
        untouched.map((d) => `“${d.label}”`).join(", ") +
        ".",
    );
  }
  return (parts.join(" ") + noMatchSentence + ambiguousSentence).slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runPoReceiveCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL po-receive-core: " + msg);
    passed += 1;
  };

  const lot = (over: Partial<ReceivableLot>): ReceivableLot => ({
    id: "lot1",
    pos_product_key: "SKU-1",
    product_name: "Blue Dream 1g",
    received_qty: 10,
    ...over,
  });
  const line = (over: Partial<ReceivablePoLine>): ReceivablePoLine => ({
    id: "line1",
    pos_product_key: "SKU-1",
    product_name: "Blue Dream 1g",
    order_qty: 10,
    received_qty: 0,
    unit: "each",
    ...over,
  });

  // Exact key match → one receipt, exact delta.
  {
    const p = buildAutoReceivePlan([lot({})], [line({})]);
    assert(p.receipts.length === 1 && p.receipts[0].qty === 10, "key match receives 10");
    assert(p.receipts[0].matchedBy === "key", "matchedBy key");
    assert(p.deltas[0].outcome === "exact", "exact outcome");
    assert(p.unmatchedLots.length === 0, "no unmatched");
  }

  // Key beats name: lot key points at line2 even though names align with line1.
  {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: "SKU-2" })],
      [line({ id: "l1", pos_product_key: "SKU-1" }), line({ id: "l2", pos_product_key: "SKU-2", product_name: "Other" })],
    );
    assert(p.receipts[0].lineId === "l2", "key match outranks name match");
  }

  // Name fallback (lot has no key) is flagged.
  {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "BLUE-DREAM 1G!" })],
      [line({ pos_product_key: "SKU-9", product_name: "Blue Dream 1g" })],
    );
    assert(p.receipts.length === 1 && p.receipts[0].matchedBy === "name", "normalized name fallback");
    assert(p.note.includes("NAME"), "note flags name matches");
  }

  // No match → unmatched lot, zero receipts, honest note.
  {
    const p = buildAutoReceivePlan([lot({ pos_product_key: "ZZZ", product_name: "Mystery" })], [line({})]);
    assert(p.receipts.length === 0, "no receipts when nothing matches");
    assert(p.unmatchedLots.length === 1 && p.unmatchedLots[0].qty === 10, "unmatched listed");
    assert(p.note.includes("manually"), "note points to manual receive");
  }

  // Two lots, same key → summed onto the line; over-delivery flagged OVER.
  {
    const p = buildAutoReceivePlan(
      [lot({ id: "a", received_qty: 6 }), lot({ id: "b", received_qty: 6 })],
      [line({ order_qty: 10 })],
    );
    assert(p.receipts[0].qty === 12, "lots sum on one line");
    assert(p.deltas[0].outcome === "over", "over-delivery flagged");
    assert(p.note.includes("OVER"), "note mentions OVER");
  }

  // Duplicate-key lines: fill the line with remaining need first.
  {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 5 })],
      [line({ id: "full", order_qty: 5, received_qty: 5 }), line({ id: "open", order_qty: 5, received_qty: 0 })],
    );
    assert(p.receipts.length === 1 && p.receipts[0].lineId === "open", "remaining-need line preferred");
  }

  // Prior partial receipts count toward the delta outcome.
  {
    const p = buildAutoReceivePlan([lot({ received_qty: 4 })], [line({ order_qty: 10, received_qty: 6 })]);
    assert(p.deltas[0].outcome === "exact" && p.deltas[0].previouslyReceived === 6, "prior partial completes the line");
  }

  // Short delivery → under; untouched line listed in the note.
  {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 3 })],
      [line({ order_qty: 10 }), line({ id: "l2", pos_product_key: "SKU-9", product_name: "Sour OG" })],
    );
    assert(p.deltas[0].outcome === "under", "short flagged under");
    assert(p.deltas[1].outcome === "none", "untouched line outcome none");
    assert(p.note.includes("Sour OG"), "note lists undelivered line");
  }

  // Zero-qty lots are skipped; empty inputs plan nothing.
  {
    const p = buildAutoReceivePlan([lot({ received_qty: 0 })], [line({})]);
    assert(p.receipts.length === 0 && p.unmatchedLots.length === 0, "zero-qty lot skipped");
    const empty = buildAutoReceivePlan([], []);
    assert(empty.receipts.length === 0 && empty.deltas.length === 0, "empty inputs plan nothing");
  }

  // A plain miss carries reason "no-match".
  {
    const p = buildAutoReceivePlan([lot({ pos_product_key: "ZZZ", product_name: "Mystery" })], [line({})]);
    assert(p.unmatchedLots[0].reason === "no-match", "plain miss reason is no-match");
  }

  // ── DEFECT A: an ambiguous NAME match is refused, never guessed ───────────
  // Two PO lines, different products, whose names normalize identically. The
  // lot has no pos_product_key, so the only evidence is the name — and it
  // points at both. Auto-receiving would silently credit the wrong line.
  {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream" })],
      [
        line({ id: "l1", pos_product_key: "SKU-A", product_name: "Orange & Cream" }),
        line({ id: "l2", pos_product_key: "SKU-B", product_name: "Orange Cream" }),
      ],
    );
    assert(p.receipts.length === 0, "ambiguous name receives nothing");
    assert(p.deltas.every((d) => d.outcome === "none"), "ambiguous name books no delta");
    assert(p.unmatchedLots.length === 1, "ambiguous lot is listed once");
    assert(p.unmatchedLots[0].reason === "ambiguous-name", "reason is ambiguous-name");
    assert(p.unmatchedLots[0].qty === 10, "ambiguous lot keeps its full qty");
    assert(p.note.includes("SEVERAL"), "note explains the refusal");
    assert(!p.note.includes("Not on the PO"), "ambiguous is not reported as missing from the PO");
  }

  // A name match that is UNambiguous still auto-receives (the fix must not
  // break the ordinary single-candidate name fallback).
  {
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Orange Cream" })],
      [
        line({ id: "l1", pos_product_key: "SKU-A", product_name: "Orange Cream" }),
        line({ id: "l2", pos_product_key: "SKU-B", product_name: "Grape Ape" }),
      ],
    );
    assert(p.receipts.length === 1 && p.receipts[0].lineId === "l1", "unambiguous name still receives");
    assert(p.unmatchedLots.length === 0, "unambiguous name is not refused");
  }

  // The KEY path is deliberately NOT refused: duplicate lines sharing one
  // pos_product_key are the same product, so "fill the open line" is correct.
  {
    const p = buildAutoReceivePlan(
      [lot({ received_qty: 5 })],
      [
        line({ id: "full", order_qty: 5, received_qty: 5 }),
        line({ id: "open", order_qty: 5, received_qty: 0 }),
      ],
    );
    assert(p.receipts.length === 1 && p.receipts[0].lineId === "open", "duplicate KEY lines are not refused");
    assert(p.unmatchedLots.length === 0, "duplicate KEY lines produce no refusal");
  }

  // Refusal is per-lot, not per-plan: a good lot still receives alongside a
  // refused one, and the note tells both stories.
  {
    const p = buildAutoReceivePlan(
      [
        lot({ id: "good", pos_product_key: "SKU-1", received_qty: 4 }),
        lot({ id: "bad", pos_product_key: null, product_name: "Orange Cream", received_qty: 7 }),
      ],
      [
        line({ id: "l1", pos_product_key: "SKU-1", order_qty: 4, product_name: "Blue Dream 1g" }),
        line({ id: "l2", pos_product_key: "SKU-A", product_name: "Orange & Cream" }),
        line({ id: "l3", pos_product_key: "SKU-B", product_name: "Orange Cream" }),
      ],
    );
    assert(p.receipts.length === 1 && p.receipts[0].lineId === "l1", "good lot still receives");
    assert(p.unmatchedLots.length === 1 && p.unmatchedLots[0].lotId === "bad", "only the bad lot is refused");
    assert(p.note.includes("Auto-received") && p.note.includes("SEVERAL"), "note covers both outcomes");
  }

  // An ambiguous lot must never be listed under "Not on the PO" — it IS on the
  // PO, twice. Both refusal kinds in one delivery, kept in separate sentences.
  {
    const p = buildAutoReceivePlan(
      [
        lot({ id: "miss", pos_product_key: "ZZZ", product_name: "Mystery" }),
        lot({ id: "amb", pos_product_key: null, product_name: "Orange Cream" }),
      ],
      [
        line({ id: "l1", pos_product_key: "SKU-A", product_name: "Orange & Cream" }),
        line({ id: "l2", pos_product_key: "SKU-B", product_name: "Orange Cream" }),
      ],
    );
    const start = p.note.indexOf("Not on the PO");
    const notOnPo = p.note.slice(start, p.note.indexOf(".", start) + 1);
    assert(start >= 0, "genuine miss is reported");
    assert(notOnPo.includes("Mystery"), "the miss is named there");
    assert(!notOnPo.includes("Orange Cream"), "ambiguous lot is NOT in the missing list");
  }

  // ── DEFECT B: number/unit spacing no longer splits one product in two ─────
  {
    assert(normalizeProductName("Blue Dream 1 g") === "blue dream 1g", "1 g joins to 1g");
    assert(
      normalizeProductName("Blue Dream 3.5 g") === normalizeProductName("Blue Dream 3.5g"),
      "3.5 g and 3.5g share a key",
    );
    assert(normalizeProductName("Gummies 100 mg") === "gummies 100mg", "100 mg joins to 100mg");
    assert(normalizeProductName("Pre-Rolls 10 pk") === "pre rolls 10pk", "10 pk joins to 10pk");
    // Size is identity: different sizes must NOT collapse together.
    assert(
      normalizeProductName("Blue Dream 1 g") !== normalizeProductName("Blue Dream 3.5 g"),
      "1g and 3.5g stay different products",
    );
    // The closed unit list is the point — a general digits+letters rule would
    // wrongly join a batch or lot number to the word after it.
    // /g matters: multi-pack names carry more than one number+unit pair.
    assert(
      normalizeProductName("Gummies 10 pk 100 mg") === "gummies 10pk 100mg",
      "every number/unit pair joins, not just the first",
    );
    assert(normalizeProductName("Batch 5 A") === "batch 5 a", "non-unit token is not joined");
    assert(normalizeProductName("Blue Dream 2 for 1") === "blue dream 2 for 1", "plain numbers untouched");
    // A lot and a line that differ only by that spacing now MATCH end to end.
    const p = buildAutoReceivePlan(
      [lot({ pos_product_key: null, product_name: "Blue Dream 3.5 g" })],
      [line({ pos_product_key: "SKU-9", product_name: "Blue Dream 3.5g" })],
    );
    assert(p.receipts.length === 1 && p.receipts[0].matchedBy === "name", "spacing variant now matches");
  }

  return { passed };
}
