/**
 * SLICE 15 — the "Stock needing recount" report (pure core).
 *
 * ─── WHY A PARSER AND NOT A NEW TABLE ─────────────────────────────────────
 *
 * The oversold event is ALREADY recorded. When a sale drives a tracked level
 * past zero, `buildVariantDecrementPlan` pushes a sentence onto its
 * `oversold[]` array (sale-decrement-core.ts:213), `summarizeDecrement` folds
 * that into the note prefixed with `OVERSOLD:` (:312), and
 * sale-decrement.ts:243 writes the note onto the sale's own `order_events`
 * row. Verified by reading those files, not from memory.
 *
 * What was missing was never the WRITE. `grep -rn "OVERSOLD" src/app`
 * returned nothing: the record existed and was displayed nowhere. So this
 * slice adds the READ, and deliberately does not add a second write path.
 * A new table would mean two records of one event that can disagree, and the
 * register's copy would be the less trustworthy one — it reads a cached
 * count while the server reads the live level.
 *
 * The note row also carries the attribution for free: it is attached to its
 * own `order_id`, which is exactly the traceability WAC 314-55-087(2)(b)
 * demands ("the opportunity to trace any transaction back to the original
 * source").
 *
 * ─── WHAT THE REPORT HAS TO CONTAIN ───────────────────────────────────────
 *
 * The column set is not invented. It mirrors Lightspeed Retail's Negative
 * Inventory report, which is the closest thing to a de facto standard here:
 * item, quantity on hand, adjustment reason, SOURCE (the specific sale),
 * quantity removed, employee, and date/time. See
 * docs/slice-15-research-oversold-industry-standard.md for the sourcing.
 *
 * ─── PARSING DISCIPLINE ───────────────────────────────────────────────────
 *
 * The note is a human sentence, so the parser is written to FAIL SOFT: a
 * sentence it cannot fully understand still yields a row carrying the raw
 * text, because dropping a variance because its wording drifted would hide
 * exactly the discrepancy the report exists to surface. A silently short
 * report is worse than an untidy one.
 *
 * Pure: no I/O, no React, no clock. Self-tested below.
 */

/** The exact marker `summarizeDecrement` writes (sale-decrement-core.ts:312). */
export const OVERSOLD_MARKER = "OVERSOLD:";

/** Markers that can FOLLOW the oversold section in the same note. */
const TRAILING_MARKERS = ["UNMATCHED:", "LOT SHORTFALL:"] as const;

/** One product needing a recount, as the report shows it. */
export type OversoldReportRow = {
  /** Product label exactly as the sale recorded it. */
  productName: string;
  /** Units that actually left the shelf. null when unparseable. */
  sold: number | null;
  /** Units the system believed it had. null when unparseable. */
  tracked: number | null;
  /** sold - tracked. null when either side is unparseable. */
  shortfall: number | null;
  /** SOURCE — the order this came from (Lightspeed's Source column). */
  orderId: string;
  /** Who was on the register, when the row records it. */
  actorLabel: string | null;
  /** When (ISO string as stored). */
  occurredAt: string | null;
  /** The original sentence, always kept so nothing is lost in translation. */
  raw: string;
};

/** An `order_events` row as this report needs it. */
export type OversoldEventRow = {
  orderId: string;
  note: string | null;
  actorLabel?: string | null;
  occurredAt?: string | null;
};

/**
 * Pull the oversold section out of a decrement note.
 *
 * Returns "" when the note has no oversold section — the overwhelmingly
 * common case, since most sales are clean.
 */
export function extractOversoldSection(note: string | null | undefined): string {
  if (typeof note !== "string") return "";
  const start = note.indexOf(OVERSOLD_MARKER);
  if (start < 0) return "";
  const after = note.slice(start + OVERSOLD_MARKER.length);
  // The oversold section runs until the next known marker, because
  // summarizeDecrement joins the sections with a single space and provides no
  // terminator of its own.
  let end = after.length;
  for (const marker of TRAILING_MARKERS) {
    const at = after.indexOf(marker);
    if (at >= 0 && at < end) end = at;
  }
  return after.slice(0, end).trim();
}

/**
 * Split the section into one sentence per product.
 *
 * `oversold[]` entries are joined with a single space and each has the shape
 * `"NAME" — sold N, only M tracked (...).`, so every entry contains exactly
 * one QUOTED PAIR followed by unquoted prose. Matching that pair-plus-prose
 * shape is what makes the split reliable.
 *
 * Two delimiters were rejected. Splitting on ". " breaks product names that
 * contain a period, which is most of them ("Gone 3.5g"). Splitting before
 * every `"` breaks at the CLOSING quote of the name as well as the opening
 * one, cutting each entry in half — a bug this module's own self-test caught.
 */
export function splitOversoldSentences(section: string): string[] {
  if (typeof section !== "string" || !section.trim()) return [];
  const text = section.trim();
  const out: string[] = [];
  // "name" then everything up to (but not including) the next opening quote.
  const entry = /"[^"]*"[^"]*/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(text)) !== null) {
    // Anything BEFORE the first quoted pair is drifted wording, not noise —
    // keep it so a malformed note still surfaces rather than vanishing.
    if (m.index > consumed) {
      const lead = text.slice(consumed, m.index).trim();
      if (lead) out.push(lead);
    }
    const chunk = m[0].trim();
    if (chunk) out.push(chunk);
    consumed = m.index + m[0].length;
  }
  // Trailing text with no quoted pair at all (fully drifted wording).
  if (consumed < text.length) {
    const tail = text.slice(consumed).trim();
    if (tail) out.push(tail);
  }
  return out;
}

/**
 * Parse one sentence written by sale-decrement-core.ts:213, whose exact shape
 * is: `"NAME" — sold N, only M tracked (level clamped to 0; cycle count to
 * reconcile).`
 *
 * Never throws. Unparseable numbers come back null with `raw` intact.
 */
export function parseOversoldSentence(sentence: string): {
  productName: string;
  sold: number | null;
  tracked: number | null;
} {
  const raw = typeof sentence === "string" ? sentence.trim() : "";
  // Product name: everything inside the FIRST pair of double quotes. A name
  // containing a quote would break a greedy match, so this is non-greedy.
  const nameMatch = raw.match(/^"(.*?)"/);
  const productName = nameMatch ? nameMatch[1]! : raw.replace(/\s+—.*$/, "").trim();
  const soldMatch = raw.match(/sold\s+(\d+)/i);
  const trackedMatch = raw.match(/only\s+(\d+)\s+tracked/i);
  const sold = soldMatch ? Number.parseInt(soldMatch[1]!, 10) : null;
  const tracked = trackedMatch ? Number.parseInt(trackedMatch[1]!, 10) : null;
  return {
    productName,
    sold: Number.isFinite(sold as number) ? (sold as number) : null,
    tracked: Number.isFinite(tracked as number) ? (tracked as number) : null,
  };
}

/**
 * Build the report rows from raw `order_events` rows.
 *
 * Rows with no oversold section are skipped entirely, so passing the whole
 * decrement history is safe and cheap.
 */
export function buildOversoldReport(rows: OversoldEventRow[]): OversoldReportRow[] {
  if (!Array.isArray(rows)) return [];
  const out: OversoldReportRow[] = [];
  for (const row of rows) {
    if (!row || typeof row.orderId !== "string" || !row.orderId) continue;
    const section = extractOversoldSection(row.note);
    if (!section) continue;
    for (const sentence of splitOversoldSentences(section)) {
      const { productName, sold, tracked } = parseOversoldSentence(sentence);
      if (!productName) continue;
      const shortfall = sold != null && tracked != null ? Math.max(0, sold - tracked) : null;
      out.push({
        productName,
        sold,
        tracked,
        shortfall,
        orderId: row.orderId,
        actorLabel: typeof row.actorLabel === "string" && row.actorLabel.trim() ? row.actorLabel.trim() : null,
        occurredAt: typeof row.occurredAt === "string" && row.occurredAt.trim() ? row.occurredAt : null,
        raw: sentence,
      });
    }
  }
  return out;
}

/**
 * Group the rows by product — the PERSISTENT FLAG half of the owner's
 * request. He asked for both a list and a per-product flag that survives
 * until the product is recounted, and this is what a product-level view needs:
 * how many separate sales sold it short, and the total units it is off by.
 *
 * Sorted worst-first (biggest total shortfall, then most occurrences), which
 * is the same "bring the negatives to the top" ordering Lightspeed recommends
 * when working their report.
 */
export type OversoldProductFlag = {
  productName: string;
  /** How many separate sales oversold this product. */
  occurrences: number;
  /** Total units the count is off by across those sales. */
  totalShortfall: number;
  /** The most recent occurrence, for "when did this start" triage. */
  lastSeenAt: string | null;
};

export function groupOversoldByProduct(rows: OversoldReportRow[]): OversoldProductFlag[] {
  if (!Array.isArray(rows)) return [];
  const byName = new Map<string, OversoldProductFlag>();
  for (const r of rows) {
    const existing = byName.get(r.productName);
    const add = r.shortfall ?? 0;
    if (!existing) {
      byName.set(r.productName, {
        productName: r.productName,
        occurrences: 1,
        totalShortfall: add,
        lastSeenAt: r.occurredAt,
      });
      continue;
    }
    existing.occurrences += 1;
    existing.totalShortfall += add;
    // Keep the LATEST timestamp. String compare is valid for ISO-8601 UTC,
    // which is what the database returns.
    if (r.occurredAt && (!existing.lastSeenAt || r.occurredAt > existing.lastSeenAt)) {
      existing.lastSeenAt = r.occurredAt;
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.totalShortfall - a.totalShortfall || b.occurrences - a.occurrences || a.productName.localeCompare(b.productName),
  );
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOversoldReportCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`oversold-report-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  // The EXACT string sale-decrement-core.ts:213 produces. If that wording
  // ever changes, these tests are the tripwire.
  const one = `"Blue Dream 1g" — sold 2, only 1 tracked (level clamped to 0; cycle count to reconcile).`;
  const two = `"Gone 3.5g" — sold 3, only 0 tracked (level clamped to 0; cycle count to reconcile).`;

  // ── extraction ─────────────────────────────────────────────────────────
  ok(extractOversoldSection(null) === "", "null note yields no section");
  ok(extractOversoldSection(undefined) === "", "undefined note yields no section");
  ok(extractOversoldSection("Inventory decremented for 2 line(s).") === "", "a clean note yields no section");
  const note = `Inventory decremented for 2 line(s): 2 menu variant(s), 0 lot touch(es). OVERSOLD: ${one}`;
  ok(extractOversoldSection(note) === one, "the oversold section is extracted exactly");

  // A note carrying MORE sections must not bleed them into the oversold part.
  const noisy = `Inventory decremented. OVERSOLD: ${one} UNMATCHED: "X" — item found but none matched.`;
  const extracted = extractOversoldSection(noisy);
  ok(extracted === one, "a following UNMATCHED section is not absorbed");
  ok(!extracted.includes("UNMATCHED"), "the trailing marker is excluded");
  const noisy2 = `Inventory decremented. OVERSOLD: ${one} LOT SHORTFALL: something.`;
  ok(extractOversoldSection(noisy2) === one, "a following LOT SHORTFALL section is not absorbed");

  // ── splitting ──────────────────────────────────────────────────────────
  ok(splitOversoldSentences("").length === 0, "empty section splits to nothing");
  ok(splitOversoldSentences(one).length === 1, "one sentence splits to one");
  const both = splitOversoldSentences(`${one} ${two}`);
  ok(both.length === 2, "two sentences split on the opening quote");
  ok(both[0]!.startsWith('"Blue Dream'), "first sentence intact");
  ok(both[1]!.startsWith('"Gone'), "second sentence intact");
  // A product name containing a period must not split — the reason we do not
  // split on ". ".
  ok(splitOversoldSentences(two).length === 1, '"3.5g" in a name does not cause a split');

  // ── parsing ────────────────────────────────────────────────────────────
  const p = parseOversoldSentence(one);
  ok(p.productName === "Blue Dream 1g", "product name comes from inside the quotes");
  ok(p.sold === 2 && p.tracked === 1, "sold and tracked are parsed");
  const p2 = parseOversoldSentence(two);
  ok(p2.productName === "Gone 3.5g" && p2.sold === 3 && p2.tracked === 0, "a zero tracked count parses (not falsy-dropped)");
  // Fail-soft: drifted wording keeps the row rather than losing the variance.
  const drift = parseOversoldSentence(`"Odd Product" — something unexpected happened.`);
  ok(drift.productName === "Odd Product", "a drifted sentence still yields the product name");
  ok(drift.sold === null && drift.tracked === null, "unparseable numbers are null, not 0");

  // ── report assembly ────────────────────────────────────────────────────
  ok(buildOversoldReport([]).length === 0, "no rows, no report");
  ok(buildOversoldReport(null as unknown as OversoldEventRow[]).length === 0, "non-array input handled");
  ok(
    buildOversoldReport([{ orderId: "o1", note: "Inventory decremented cleanly." }]).length === 0,
    "clean sales never appear in the report",
  );
  const report = buildOversoldReport([
    { orderId: "o1", note: `Decremented. OVERSOLD: ${one}`, actorLabel: "Michael", occurredAt: "2026-09-03T10:00:00Z" },
    { orderId: "o2", note: `Decremented. OVERSOLD: ${two}`, actorLabel: "  ", occurredAt: "2026-09-03T11:00:00Z" },
    { orderId: "o3", note: "Decremented cleanly." },
  ]);
  ok(report.length === 2, "only the oversold sales become rows");
  ok(report[0]!.orderId === "o1", "SOURCE: the row carries its order id");
  ok(report[0]!.actorLabel === "Michael", "the row carries who");
  ok(report[0]!.occurredAt === "2026-09-03T10:00:00Z", "the row carries when");
  ok(report[0]!.shortfall === 1, "shortfall computed (2 - 1)");
  ok(report[1]!.shortfall === 3, "shortfall computed (3 - 0)");
  ok(report[1]!.actorLabel === null, "a blank actor normalises to null, not an empty string");
  ok(report[0]!.raw === one, "the original sentence is always preserved");
  // A row missing an order id cannot be traced, so it cannot be a report row.
  ok(buildOversoldReport([{ orderId: "", note: `OVERSOLD: ${one}` }]).length === 0, "an untraceable row is skipped");

  // Two products in ONE sale must both surface.
  const multi = buildOversoldReport([{ orderId: "o9", note: `Decremented. OVERSOLD: ${one} ${two}` }]);
  ok(multi.length === 2, "two oversold products in one sale yield two rows");
  ok(multi.every((r) => r.orderId === "o9"), "both rows trace to the same sale");

  // ── grouping (the persistent per-product flag) ─────────────────────────
  ok(groupOversoldByProduct([]).length === 0, "no rows, no flags");
  const flags = groupOversoldByProduct(
    buildOversoldReport([
      { orderId: "o1", note: `OVERSOLD: ${one}`, occurredAt: "2026-09-01T10:00:00Z" },
      { orderId: "o2", note: `OVERSOLD: ${one}`, occurredAt: "2026-09-03T10:00:00Z" },
      { orderId: "o3", note: `OVERSOLD: ${two}`, occurredAt: "2026-09-02T10:00:00Z" },
    ]),
  );
  ok(flags.length === 2, "two distinct products are flagged");
  ok(flags[0]!.productName === "Gone 3.5g", "worst total shortfall sorts first (3 beats 1+1=2)");
  ok(flags[0]!.totalShortfall === 3 && flags[0]!.occurrences === 1, "single big variance totalled");
  const blue = flags.find((f) => f.productName === "Blue Dream 1g")!;
  ok(blue.occurrences === 2, "repeat offences are counted");
  ok(blue.totalShortfall === 2, "repeat shortfalls accumulate");
  ok(blue.lastSeenAt === "2026-09-03T10:00:00Z", "lastSeenAt keeps the LATEST timestamp");

  console.log(`oversold-report-core self-tests: ${pass} assertion(s) passed`);
}
