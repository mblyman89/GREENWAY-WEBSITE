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
  /** Accepted lots that matched NO PO line — left for manual receiving. */
  unmatchedLots: { lotId: string; label: string; qty: number }[];
  /** Human-readable timeline summary (manifest_events note). */
  note: string;
};

/** Same normalization discipline as po-match-core's vendor names. */
export function normalizeProductName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      unmatchedLots.push({ lotId: lot.id, label: lotLabel(lot), qty });
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
  if (receipts.length === 0) {
    return (
      `Linked PO: none of the ${lots.length} accepted lot(s) matched a PO line — ` +
      `receive them manually on the PO page.`
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
  if (unmatchedLots.length > 0) {
    parts.push(
      "Not on the PO (left for manual receive): " +
        unmatchedLots.map((u) => `“${u.label}” (${u.qty})`).join(", ") +
        ".",
    );
  }
  return parts.join(" ").slice(0, 2000);
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

  return { passed };
}
