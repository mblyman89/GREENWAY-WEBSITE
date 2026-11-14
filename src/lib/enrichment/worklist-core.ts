/**
 * D244 E-1 — Worklist v2: vendor-first, on-hand-first, paged (PURE, no I/O).
 *
 * Owner (D244 request): work the enrichment list one VENDOR at a time and
 * fix what is ON HAND first. Before this, the only vendor filter was the
 * delivery vendor (S22 attribution), which goes blank when the lot/manifest
 * read fails and only offers vendors that have a delivery on file (F-50);
 * sold-out cards were mixed in with sellable ones (F-51); there was no
 * per-vendor progress (F-52) and the list stopped at 300 (F-42).
 *
 * Vendor resolution, first hit wins (never a guess beyond these links):
 *   1. the card's own enrichment row `vendor_id`
 *   2. a lot / delivery vendor (S22 attribution `vendorIds`, first)
 *   3. the brand's vendor (`brands.vendor_id`, brand matched by name)
 *   4. the POS vendor name matched to a vendor (display name or alias)
 */

export type VendorVia = "enrichment" | "delivery" | "brand" | "pos";

export type CardVendorInput = {
  ownVendorId: string | null | undefined;
  attrVendorIds: readonly string[] | null | undefined;
  brandName: string | null | undefined;
  posVendorName: string | null | undefined;
};

export type VendorLookups = {
  /** lower-case vendor ids that exist. */
  known: ReadonlySet<string>;
  /** lower-case brand display name -> vendor id */
  brandVendor: ReadonlyMap<string, string>;
  /** lower-case vendor display name / alias -> vendor id */
  vendorByName: ReadonlyMap<string, string>;
};

const low = (v: string | null | undefined) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function resolveCardVendor(c: CardVendorInput, l: VendorLookups): { vendorId: string | null; via: VendorVia | null } {
  const own = low(c.ownVendorId);
  if (own && l.known.has(own)) return { vendorId: own, via: "enrichment" };
  for (const v of c.attrVendorIds ?? []) {
    const id = low(v);
    if (id && l.known.has(id)) return { vendorId: id, via: "delivery" };
  }
  const b = l.brandVendor.get(low(c.brandName));
  if (b && l.known.has(low(b))) return { vendorId: low(b), via: "brand" };
  const p = l.vendorByName.get(low(c.posVendorName));
  if (p && l.known.has(low(p))) return { vendorId: low(p), via: "pos" };
  return { vendorId: null, via: null };
}

// --- Stock focus ----------------------------------------------------------------

/** "on-hand" (in + low stock) is the DEFAULT; "all" includes sold-out. */
export type WorklistStock = "on-hand" | "all" | "in-stock" | "low-stock" | "unavailable";

export function parseWorklistStock(raw: unknown): WorklistStock {
  if (raw === "all" || raw === "in-stock" || raw === "low-stock" || raw === "unavailable" || raw === "on-hand") return raw;
  return "on-hand";
}

export function isOnHandStatus(status: string | null | undefined): boolean {
  return status === "in-stock" || status === "low-stock";
}

export function matchesWorklistStock(status: string | null | undefined, choice: WorklistStock): boolean {
  if (choice === "all") return true;
  if (choice === "on-hand") return isOnHandStatus(status);
  return (status ?? "") === choice;
}

// --- Vendor filter ----------------------------------------------------------------

/** `?vendor=`: a vendor uuid, "none" (no vendor on file), or "" (any). */
export function parseWorklistVendor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim().toLowerCase();
  if (v === "none") return "none";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : "";
}

export function matchesVendor(cardVendor: string | null, sel: string): boolean {
  if (!sel) return true;
  if (sel === "none") return cardVendor === null;
  return cardVendor === sel;
}

// --- On-hand quantity -----------------------------------------------------------

export type QtyLot = { pos_product_key: string | null; on_hand_qty: number | string | null };

/** Sum lot on-hand quantity per card (a card's lot keys from cardLotKeys). */
export function onHandByCard(
  cards: readonly { posKey: string; lotKeys: readonly string[] }[],
  lots: readonly QtyLot[],
): Map<string, number> {
  const perKey = new Map<string, number>();
  for (const l of lots) {
    const k = typeof l.pos_product_key === "string" ? l.pos_product_key : "";
    const n = Number(l.on_hand_qty);
    if (!k || !Number.isFinite(n) || n <= 0) continue;
    perKey.set(k, (perKey.get(k) ?? 0) + n);
  }
  const out = new Map<string, number>();
  for (const c of cards) {
    let sum = 0;
    const seen = new Set<string>();
    for (const k of c.lotKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      sum += perKey.get(k) ?? 0;
    }
    out.set(c.posKey, Math.round(sum * 1000) / 1000);
  }
  return out;
}

/** Most on hand first; unknown (no lots read) last; name breaks ties. */
export function sortByOnHand<T extends { posKey: string; name: string }>(rows: T[], qty: ReadonlyMap<string, number> | null): T[] {
  const q = (r: T) => (qty?.has(r.posKey) ? qty.get(r.posKey)! : -1);
  return [...rows].sort((a, b) => q(b) - q(a) || a.name.localeCompare(b.name));
}

// --- Vendor progress --------------------------------------------------------------

export type ProgressRow = {
  vendorId: string | null;
  inventoryStatus: string | null | undefined;
  enrichmentStatus: string | null;
  hasImage: boolean;
  hasDescription: boolean;
};

export type VendorProgress = {
  id: string; // vendor id, or "none"
  label: string;
  total: number;
  onHand: number;
  /** on-hand cards already published */
  onHandPublished: number;
  /** on-hand drafts with a photo (bulk-publishable) */
  onHandReady: number;
  onHandMissingCopy: number;
  onHandMissingPhoto: number;
};

export const NO_VENDOR_LABEL = "No vendor on file";

export function vendorProgress(rows: readonly ProgressRow[], labels: ReadonlyMap<string, string>): VendorProgress[] {
  const by = new Map<string, VendorProgress>();
  for (const r of rows) {
    const id = r.vendorId ?? "none";
    let p = by.get(id);
    if (!p) {
      p = {
        id,
        label: id === "none" ? NO_VENDOR_LABEL : labels.get(id) ?? "Unnamed vendor",
        total: 0,
        onHand: 0,
        onHandPublished: 0,
        onHandReady: 0,
        onHandMissingCopy: 0,
        onHandMissingPhoto: 0,
      };
      by.set(id, p);
    }
    p.total++;
    if (!isOnHandStatus(r.inventoryStatus)) continue;
    p.onHand++;
    if (r.enrichmentStatus === "published") p.onHandPublished++;
    else if (r.enrichmentStatus === "draft" && r.hasImage) p.onHandReady++;
    if (!r.hasDescription) p.onHandMissingCopy++;
    if (!r.hasImage) p.onHandMissingPhoto++;
  }
  return Array.from(by.values()).sort((a, b) => {
    if ((a.id === "none") !== (b.id === "none")) return a.id === "none" ? 1 : -1;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1);
  });
}

/** Whole percent of a vendor's on-hand cards that are published (0 when none on hand). */
export function vendorPercent(p: VendorProgress): number {
  return p.onHand === 0 ? 0 : Math.floor((p.onHandPublished / p.onHand) * 100);
}

/**
 * The next vendor (A-Z after `currentId`, wrapping) that still has on-hand
 * cards not published. "No vendor on file" is never suggested. null = done.
 */
export function nextVendor(list: readonly VendorProgress[], currentId: string): VendorProgress | null {
  const real = list.filter((p) => p.id !== "none");
  if (real.length === 0) return null;
  const start = real.findIndex((p) => p.id === currentId);
  for (let i = 1; i <= real.length; i++) {
    const p = real[(start + i + real.length) % real.length]!;
    if (p.id === currentId) continue;
    if (p.onHand - p.onHandPublished > 0) return p;
  }
  return null;
}

/** "Phat Panda (63 · 41 on hand)" */
export function vendorOptionLabel(p: VendorProgress): string {
  return `${p.label} (${p.total} \u00b7 ${p.onHand} on hand)`;
}

// --- Paging -------------------------------------------------------------------------

export const WORKLIST_PAGE_SIZE = 300;

export function pageWindow(total: number, raw: unknown, size = WORKLIST_PAGE_SIZE): { page: number; pages: number; start: number; end: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 1;
  const page = Math.min(Math.max(1, n), pages);
  const start = (page - 1) * size;
  return { page, pages, start, end: Math.min(total, start + size) };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runWorklistCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`worklist-core FAIL: ${label}`);
    }
  };
  const V1 = "11111111-1111-1111-1111-111111111111";
  const V2 = "22222222-2222-2222-2222-222222222222";
  const V3 = "33333333-3333-3333-3333-333333333333";
  const L: VendorLookups = {
    known: new Set([V1, V2, V3]),
    brandVendor: new Map([["phat panda", V2]]),
    vendorByName: new Map([["grow op farms", V3]]),
  };
  const none = { ownVendorId: null, attrVendorIds: [], brandName: null, posVendorName: null };
  ok(resolveCardVendor({ ...none, ownVendorId: V1.toUpperCase(), attrVendorIds: [V2] }, L).via === "enrichment", "own vendor first");
  ok(resolveCardVendor({ ...none, attrVendorIds: ["x", V2] }, L).vendorId === V2, "delivery vendor second, skips unknown ids");
  ok(resolveCardVendor({ ...none, brandName: "Phat Panda " }, L).via === "brand", "brand vendor third");
  ok(resolveCardVendor({ ...none, posVendorName: "Grow Op Farms" }, L).vendorId === V3, "pos vendor name fourth");
  ok(resolveCardVendor({ ...none, ownVendorId: "dead-id" }, L).vendorId === null, "unknown own id ignored → none");
  ok(resolveCardVendor(none, L).via === null, "nothing → null");

  ok(parseWorklistStock(undefined) === "on-hand", "stock default on-hand");
  ok(parseWorklistStock("") === "on-hand", "empty → on-hand");
  ok(parseWorklistStock("all") === "all", "all");
  ok(parseWorklistStock("unavailable") === "unavailable", "sold out");
  ok(parseWorklistStock("junk") === "on-hand", "junk → on-hand");
  ok(matchesWorklistStock("low-stock", "on-hand") && matchesWorklistStock("in-stock", "on-hand"), "on-hand = in + low");
  ok(!matchesWorklistStock("unavailable", "on-hand"), "sold out not on hand");
  ok(matchesWorklistStock("unavailable", "all"), "all includes sold out");
  ok(matchesWorklistStock("in-stock", "in-stock") && !matchesWorklistStock("low-stock", "in-stock"), "exact status");

  ok(parseWorklistVendor(V1.toUpperCase()) === V1, "vendor uuid lower-cased");
  ok(parseWorklistVendor("none") === "none", "vendor none");
  ok(parseWorklistVendor("drop table") === "", "vendor junk");
  ok(parseWorklistVendor(["a"]) === "", "vendor array ignored");
  ok(matchesVendor(V1, V1) && !matchesVendor(V2, V1), "vendor match");
  ok(matchesVendor(null, "none") && !matchesVendor(V1, "none"), "none match");
  ok(matchesVendor(null, ""), "any vendor");

  const qty = onHandByCard(
    [
      { posKey: "A", lotKeys: ["A", "A-v1", "A"] },
      { posKey: "B", lotKeys: ["B"] },
    ],
    [
      { pos_product_key: "A", on_hand_qty: 3 },
      { pos_product_key: "A-v1", on_hand_qty: "2.5" },
      { pos_product_key: "A", on_hand_qty: -4 },
      { pos_product_key: "B", on_hand_qty: null },
      { pos_product_key: null, on_hand_qty: 9 },
    ],
  );
  ok(qty.get("A") === 5.5, "qty sums lot keys once, ignores negatives");
  ok(qty.get("B") === 0, "qty zero when nothing on hand");
  const sorted = sortByOnHand(
    [
      { posKey: "B", name: "b" },
      { posKey: "A", name: "a" },
      { posKey: "C", name: "c" },
    ],
    qty,
  );
  ok(sorted.map((r) => r.posKey).join() === "A,B,C", "on-hand sort, unknown last");

  const labels = new Map([
    [V1, "Zed Farms"],
    [V2, "Phat Panda"],
  ]);
  const prog = vendorProgress(
    [
      { vendorId: V2, inventoryStatus: "in-stock", enrichmentStatus: "published", hasImage: true, hasDescription: true },
      { vendorId: V2, inventoryStatus: "low-stock", enrichmentStatus: "draft", hasImage: true, hasDescription: false },
      { vendorId: V2, inventoryStatus: "unavailable", enrichmentStatus: null, hasImage: false, hasDescription: false },
      { vendorId: V1, inventoryStatus: "in-stock", enrichmentStatus: "published", hasImage: true, hasDescription: true },
      { vendorId: null, inventoryStatus: "in-stock", enrichmentStatus: null, hasImage: false, hasDescription: false },
    ],
    labels,
  );
  ok(prog.map((p) => p.label).join("|") === `Phat Panda|Zed Farms|${NO_VENDOR_LABEL}`, "progress A-Z, none last");
  const pp = prog[0]!;
  ok(pp.total === 3 && pp.onHand === 2 && pp.onHandPublished === 1 && pp.onHandReady === 1, "progress counts");
  ok(pp.onHandMissingCopy === 1 && pp.onHandMissingPhoto === 0, "progress gaps on hand only");
  ok(vendorPercent(pp) === 50 && vendorPercent(prog[1]!) === 100, "percent");
  ok(vendorOptionLabel(pp) === "Phat Panda (3 \u00b7 2 on hand)", "option label");
  ok(nextVendor(prog, V1)?.id === V2, "next vendor wraps to unfinished");
  ok(nextVendor(prog, V2) === null, "only finished others → null");
  ok(nextVendor(prog, "")?.id === V2, "no current → first unfinished");

  const w = pageWindow(650, "3");
  ok(w.page === 3 && w.pages === 3 && w.start === 600 && w.end === 650, "page 3 of 650");
  ok(pageWindow(650, "99").page === 3, "page clamps high");
  ok(pageWindow(650, "x").page === 1 && pageWindow(0, "2").pages === 1, "page junk → 1; empty list one page");

  return { passed, failed };
}
