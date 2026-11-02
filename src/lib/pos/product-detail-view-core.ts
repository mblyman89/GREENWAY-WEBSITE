/**
 * src/lib/pos/product-detail-view-core.ts  (register-lot-details — client half)
 *
 * Owner request (verbatim, 2026 register round): "add significantly more
 * details to the browse menu. We need every detail available, vendor lot
 * number, everything."
 *
 * The per-LOT facts (vendor lot number, lot code, CCRS inventory id, vendor
 * and licence, manifest / invoice, received and expiry dates, stock, the
 * POS-stated potency, the full lab result and COA) live in five back-office
 * tables. They do NOT ride the cached menu bundle: the bundle is gzip-capped
 * for Vercel's response limit (bundleSizeVerdict) and every product would pay
 * for facts a budtender opens a few times an hour. Instead the info card asks
 * GET /api/pos/product-details ONLINE when it opens (the same pattern as the
 * B42 card photo) and the server builds the rows with product-detail-core.
 *
 * THIS file is the half the REGISTER imports: the wire types and a defensive
 * parser for the response. It has NO heavy imports on purpose — the packaged
 * iPad app bundles everything the register touches, and the server-side
 * builder pulls in the lab-certificate readers, which the device never needs.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

/** One "label: value" fact on a lot. `tone` drives colour only. */
export type LotDetailRow = {
  label: string;
  value: string;
  /** Short qualifier shown under the value (e.g. "read from a PDF — unconfirmed"). */
  note?: string;
  tone?: "warn" | "danger" | "ok";
};

export type LotDetailSection = {
  title: string;
  rows: LotDetailRow[];
};

/** Everything the card shows about ONE inventory lot of this size. */
export type LotDetailView = {
  lotId: string;
  /** "Lot ABC-123" / the vendor lot number — the collapsible header. */
  headline: string;
  /** One-line summary under the headline ("12 on hand · received 2026-05-01"). */
  summary: string;
  /** True for the lot the register is selling from (active + stocked). */
  sellable: boolean;
  sections: LotDetailSection[];
  /** Detected terpenes from the stored COA read, most abundant first. */
  terpenes: { name: string; ppm: number }[];
  /** Public lab certificate link when the lab gave one. */
  coaUrl: string | null;
};

export type ProductDetailsResponse = {
  lots: LotDetailView[];
  /** Total lots found for this size before the display cap. */
  lotCount: number;
  /** Plain-English problems reading the back office (never silent — rule 15). */
  warnings: string[];
};

/** Hard caps the parser enforces so a bad response cannot flood the card. */
export const DETAIL_PARSE_MAX_LOTS = 12;
export const DETAIL_PARSE_MAX_ROWS = 80;
export const DETAIL_PARSE_MAX_TEXT = 300;

function text(v: unknown, max: number = DETAIL_PARSE_MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function parseRow(v: unknown): LotDetailRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const label = text(o.label, 60);
  const value = text(o.value);
  if (!label || !value) return null;
  const row: LotDetailRow = { label, value };
  const note = text(o.note);
  if (note) row.note = note;
  if (o.tone === "warn" || o.tone === "danger" || o.tone === "ok") row.tone = o.tone;
  return row;
}

function parseLot(v: unknown): LotDetailView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lotId = text(o.lotId, 80);
  const headline = text(o.headline, 120);
  if (!lotId || !headline) return null;
  const sections: LotDetailSection[] = [];
  let rowBudget = DETAIL_PARSE_MAX_ROWS;
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    const title = text(so.title, 60);
    if (!title) continue;
    const rows: LotDetailRow[] = [];
    for (const r of Array.isArray(so.rows) ? so.rows : []) {
      if (rowBudget <= 0) break;
      const row = parseRow(r);
      if (row) {
        rows.push(row);
        rowBudget -= 1;
      }
    }
    if (rows.length > 0) sections.push({ title, rows });
  }
  const terpenes: { name: string; ppm: number }[] = [];
  for (const t of Array.isArray(o.terpenes) ? o.terpenes : []) {
    if (!t || typeof t !== "object") continue;
    const to = t as Record<string, unknown>;
    const name = text(to.name, 60);
    const ppm = typeof to.ppm === "number" && Number.isFinite(to.ppm) && to.ppm > 0 ? to.ppm : null;
    if (name && ppm !== null) terpenes.push({ name, ppm });
    if (terpenes.length >= 12) break;
  }
  const coa = text(o.coaUrl, 500);
  return {
    lotId,
    headline,
    summary: text(o.summary) ?? "",
    sellable: o.sellable === true,
    sections,
    terpenes,
    // Only http(s) links are ever rendered as a link on the register.
    coaUrl: coa && /^https?:\/\//i.test(coa) ? coa : null,
  };
}

/**
 * Parse the endpoint's JSON defensively. Anything malformed is dropped, never
 * thrown: the card must keep showing its offline facts whatever arrives.
 * Returns null when the body is not a details response at all.
 */
export function parseProductDetailsResponse(body: unknown): ProductDetailsResponse | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.lots)) return null;
  const lots: LotDetailView[] = [];
  for (const l of o.lots) {
    const lot = parseLot(l);
    if (lot) lots.push(lot);
    if (lots.length >= DETAIL_PARSE_MAX_LOTS) break;
  }
  const warnings: string[] = [];
  for (const w of Array.isArray(o.warnings) ? o.warnings : []) {
    const t = text(w);
    if (t) warnings.push(t);
    if (warnings.length >= 6) break;
  }
  const lotCount =
    typeof o.lotCount === "number" && Number.isSafeInteger(o.lotCount) && o.lotCount >= lots.length
      ? o.lotCount
      : lots.length;
  return { lots, lotCount, warnings };
}

/** Terpene ppm as the card shows it: "4,210 ppm (0.42%)". */
export function terpeneLabel(ppm: number): string {
  if (!Number.isFinite(ppm) || ppm <= 0) return "—";
  const rounded = Math.round(ppm);
  const pct = Number((ppm / 10000).toFixed(2));
  return `${rounded.toLocaleString("en-US")} ppm (${pct}%)`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runProductDetailViewCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  ok(parseProductDetailsResponse(null) === null, "null body -> null");
  ok(parseProductDetailsResponse({}) === null, "no lots array -> null");
  ok(parseProductDetailsResponse("x") === null, "string body -> null");

  const good = parseProductDetailsResponse({
    lots: [
      {
        lotId: "l1",
        headline: "Vendor lot 4412",
        summary: "12 on hand",
        sellable: true,
        sections: [
          {
            title: "Identity",
            rows: [
              { label: "Vendor lot #", value: "4412", note: "from the WCIA transfer", tone: "ok" },
              { label: "", value: "dropped (no label)" },
              { label: "Blank", value: "   " },
              { label: "Bad tone", value: "x", tone: "purple" },
            ],
          },
          { title: "Empty", rows: [] },
          { title: "", rows: [{ label: "a", value: "b" }] },
        ],
        terpenes: [
          { name: "Myrcene", ppm: 4210 },
          { name: "Zero", ppm: 0 },
          { name: "NaN", ppm: Number.NaN },
          { name: "", ppm: 10 },
        ],
        coaUrl: "https://certs.example.com/a.pdf",
      },
      { lotId: "", headline: "no id" },
      { lotId: "l3", headline: "Lot 3", coaUrl: "javascript:alert(1)" },
    ],
    lotCount: 5,
    warnings: ["Lab results could not be read.", 42, ""],
  });
  ok(good !== null, "good body parses");
  ok(good!.lots.length === 2, "lot without id dropped");
  ok(good!.lotCount === 5, "lotCount carried");
  ok(good!.warnings.length === 1, "non-string / blank warnings dropped");
  const l1 = good!.lots[0];
  ok(l1.sellable === true && l1.summary === "12 on hand", "flags + summary");
  ok(l1.sections.length === 1, "empty and untitled sections dropped");
  ok(l1.sections[0].rows.length === 2, "rows without label/value dropped");
  ok(l1.sections[0].rows[0].tone === "ok" && l1.sections[0].rows[0].note === "from the WCIA transfer", "tone + note kept");
  ok(l1.sections[0].rows[1].tone === undefined, "unknown tone dropped");
  ok(l1.terpenes.length === 1 && l1.terpenes[0].name === "Myrcene", "only positive named terpenes");
  ok(l1.coaUrl === "https://certs.example.com/a.pdf", "https COA link kept");
  ok(good!.lots[1].coaUrl === null, "non-http COA link refused");
  ok(good!.lots[1].sellable === false && good!.lots[1].summary === "", "defaults for missing fields");

  const bogusCount = parseProductDetailsResponse({ lots: [{ lotId: "a", headline: "A" }], lotCount: -3 });
  ok(bogusCount!.lotCount === 1, "bad lotCount falls back to shown count");

  const many = parseProductDetailsResponse({
    lots: Array.from({ length: 40 }, (_, i) => ({ lotId: `l${i}`, headline: `L${i}` })),
  });
  ok(many!.lots.length === DETAIL_PARSE_MAX_LOTS, "lot cap enforced");

  const flood = parseProductDetailsResponse({
    lots: [
      {
        lotId: "x",
        headline: "X",
        sections: [{ title: "Big", rows: Array.from({ length: 500 }, (_, i) => ({ label: `r${i}`, value: "v" })) }],
      },
    ],
  });
  ok(flood!.lots[0].sections[0].rows.length === DETAIL_PARSE_MAX_ROWS, "row cap enforced");

  const long = parseProductDetailsResponse({ lots: [{ lotId: "x", headline: "X", summary: "y".repeat(1000) }] });
  ok(long!.lots[0].summary.length === DETAIL_PARSE_MAX_TEXT && long!.lots[0].summary.endsWith("…"), "long text capped");

  ok(terpeneLabel(4210) === "4,210 ppm (0.42%)", "terpene label");
  ok(terpeneLabel(0) === "—" && terpeneLabel(Number.NaN) === "—", "terpene label blank");

  console.log(`product-detail-view-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`product-detail-view-core self-tests failed: ${failures.join("; ")}`);
  }
}
