/**
 * src/lib/products/masters-filter-core.ts — R23 (owner fix 7).
 *
 * "I would like to add a vendor and manifest filter for mastering, so I can
 *  narrow down what masters per vendor we have."
 *
 * Two optional narrowing facets on the Product Mastering page, combined with
 * AND (the faceted-search convention used by every enterprise catalog UI:
 * each facet narrows, facets intersect, an empty facet means "any"):
 *
 *   vendor    the live card's vendor (menu_items.vendor_name, the same field
 *             the Live cards row prints). Matched case/space-insensitively so
 *             "Phat Panda" and "phat  panda" are one vendor.
 *   manifest  an accepted delivery. A card belongs to it when ANY of the
 *             card's keys (its own POS key + every restock "-onboarded" lot
 *             key, i.e. MasteredCard.key + lotKeys) is the pos_product_key or
 *             lot_code of a lot received on that manifest
 *             (inventory_lots.manifest_id). The server reads only that one
 *             manifest's lots, and only when the facet is set.
 *
 * Applied to the Live cards tab and the Masters tab (a manual master is
 * shown when at least one of its members' live cards passes). A filter that
 * matches nothing says so — it never silently falls back to "all".
 *
 * PURE: no I/O. Self-tests registered in scripts/compliance/run-pure-selftests.ts.
 */

import type { MasteredCard, MasterMemberView } from "./mastered-menu-core";

export type MastersFilter = {
  /** Normalised vendor key ("" = any). */
  vendor: string;
  /** Manifest uuid ("" = any). */
  manifest: string;
};

export const NO_MASTERS_FILTER: MastersFilter = Object.freeze({ vendor: "", manifest: "" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Case/space-insensitive vendor key. "" for blank. */
export function vendorKey(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function first(raw: unknown): string {
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : "";
  return typeof raw === "string" ? raw : "";
}

/** Parse ?vendor=&manifest= (unknown shapes → "any"; a manifest must be a uuid). */
export function parseMastersFilter(sp: { vendor?: unknown; manifest?: unknown }): MastersFilter {
  const vendor = vendorKey(first(sp.vendor)).slice(0, 120);
  const m = first(sp.manifest).trim();
  return { vendor, manifest: UUID_RE.test(m) ? m.toLowerCase() : "" };
}

export function isFiltered(f: MastersFilter): boolean {
  return f.vendor !== "" || f.manifest !== "";
}

export type VendorOption = { key: string; label: string; count: number };

/**
 * One option per distinct vendor on the live menu, label = the most common
 * spelling, count = live cards. Sorted by label. Cards with no vendor are
 * not an option (they can't be "a vendor's masters").
 */
export function vendorOptions(cards: readonly Pick<MasteredCard, "vendor">[]): VendorOption[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const c of cards) {
    const k = vendorKey(c.vendor);
    if (!k) continue;
    const e = byKey.get(k) ?? { count: 0, spellings: new Map<string, number>() };
    e.count += 1;
    const label = String(c.vendor).trim().replace(/\s+/g, " ");
    e.spellings.set(label, (e.spellings.get(label) ?? 0) + 1);
    byKey.set(k, e);
  }
  const out: VendorOption[] = [];
  for (const [key, e] of byKey) {
    // Most common spelling; on a tie the one with more capitals ("Phat Panda"
    // over "phat panda"), then code-point order so the choice is deterministic.
    const caps = (t: string) => (t.match(/\p{Lu}/gu) ?? []).length;
    const label = [...e.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || caps(b[0]) - caps(a[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )[0]![0];
    out.push({ key, label, count: e.count });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));
}

/** Every key a card can be received under: its own POS key + restock lot keys. */
export function cardKeys(card: Pick<MasteredCard, "key" | "lotKeys">): string[] {
  const out: string[] = [];
  for (const k of [card.key, ...card.lotKeys]) {
    const t = String(k ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** The lot keys a manifest's lots carry (pos_product_key, then lot_code), de-duplicated. */
export function manifestKeySet(lots: readonly { pos_product_key: string | null; lot_code: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const l of lots) {
    for (const v of [l.pos_product_key, l.lot_code]) {
      const t = String(v ?? "").trim();
      if (t) out.add(t);
    }
  }
  return out;
}

/**
 * Apply both facets. `manifestKeys` is the key set of the selected manifest
 * (null = the facet is off OR the lots could not be read; the caller reports
 * a read failure separately and passes an EMPTY set so nothing is shown
 * rather than everything).
 */
export function applyMastersFilter<T extends Pick<MasteredCard, "key" | "lotKeys" | "vendor">>(
  cards: readonly T[],
  f: MastersFilter,
  manifestKeys: ReadonlySet<string> | null,
): T[] {
  return cards.filter((c) => {
    if (f.vendor && vendorKey(c.vendor) !== f.vendor) return false;
    if (f.manifest) {
      if (!manifestKeys) return false;
      if (!cardKeys(c).some((k) => manifestKeys.has(k))) return false;
    }
    return true;
  });
}

/** A manual master passes when any member's live card is in the passing set. */
export function masterPasses(members: readonly MasterMemberView[], passingKeys: ReadonlySet<string>): boolean {
  return members.some((m) => m.card !== null && passingKeys.has(m.card.key));
}

export type ManifestOptionInput = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  invoice_number_override?: string | null;
  status: string;
};

/** Only deliveries that put product on the menu are offered. */
export function isMasterableManifest(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "accepted" || s === "partially_accepted";
}

/** "2026-04-02 · Phat Panda · #INV-77" — never an empty label. */
export function manifestOptionLabel(m: ManifestOptionInput): string {
  const parts: string[] = [];
  const d = String(m.transfer_date ?? "").trim().slice(0, 10);
  if (d) parts.push(d);
  const v = String(m.vendor_label ?? "").trim();
  if (v) parts.push(v);
  const n = String(m.invoice_number_override ?? "").trim() || String(m.manifest_number ?? "").trim();
  if (n) parts.push(`#${n}`);
  return parts.length ? parts.join(" · ") : `Manifest ${m.id.slice(0, 8)}`;
}

/** Options for the manifest select, filtered to the vendor facet when set. */
export function manifestOptions(
  manifests: readonly ManifestOptionInput[],
  vendor: string,
): { id: string; label: string }[] {
  return manifests
    .filter((m) => isMasterableManifest(m.status))
    .filter((m) => !vendor || vendorKey(m.vendor_label) === vendor)
    .map((m) => ({ id: m.id.toLowerCase(), label: manifestOptionLabel(m) }));
}

/** Query-string pairs for the facets (only the set ones). */
export function filterParams(f: MastersFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.vendor) out.vendor = f.vendor;
  if (f.manifest) out.manifest = f.manifest;
  return out;
}

/** Append the set facets to an href that already has a query (pager / tab / filter links). */
export function withMastersFilter(href: string, f: MastersFilter): string {
  const extra = new URLSearchParams(filterParams(f)).toString();
  if (!extra) return href;
  return href + (href.includes("?") ? "&" : "?") + extra;
}

/** "Showing 12 of 340 live cards for Phat Panda on 2026-04-02 · …" */
export function filterSummary(
  shown: number,
  total: number,
  vendorLabel: string | null,
  manifestLabel: string | null,
): string {
  const noun = total === 1 ? "live card" : "live cards";
  const bits: string[] = [];
  if (vendorLabel) bits.push(`from ${vendorLabel}`);
  if (manifestLabel) bits.push(`received on ${manifestLabel}`);
  return `Showing ${shown} of ${total} ${noun}${bits.length ? ` ${bits.join(" ")}` : ""}.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runMastersFilterCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL masters-filter-core: " + msg);
    passed += 1;
  };
  const U = "0f8fad5b-d9cb-469f-a165-70867728950e";

  // vendorKey
  ok(vendorKey("  Phat   Panda ") === "phat panda", "vendorKey trims, collapses, lowercases");
  ok(vendorKey(null) === "" && vendorKey(undefined) === "", "vendorKey blank");

  // parse
  ok(parseMastersFilter({}).vendor === "" && parseMastersFilter({}).manifest === "", "parse empty → any");
  ok(parseMastersFilter({ vendor: "Phat Panda" }).vendor === "phat panda", "parse vendor normalised");
  ok(parseMastersFilter({ vendor: ["A", "B"] }).vendor === "a", "parse array → first");
  ok(parseMastersFilter({ manifest: U.toUpperCase() }).manifest === U, "parse manifest uuid lowercased");
  ok(parseMastersFilter({ manifest: "x'; drop" }).manifest === "", "non-uuid manifest refused");
  ok(parseMastersFilter({ vendor: 5 as unknown }).vendor === "", "non-string vendor refused");
  ok(parseMastersFilter({ vendor: "v".repeat(500) }).vendor.length === 120, "vendor capped at 120");
  ok(!isFiltered(NO_MASTERS_FILTER) && isFiltered({ vendor: "a", manifest: "" }) && isFiltered({ vendor: "", manifest: U }), "isFiltered");

  // vendorOptions
  const opts = vendorOptions([{ vendor: "Phat Panda" }, { vendor: "phat panda" }, { vendor: "Phat Panda" }, { vendor: "Agro" }, { vendor: null }, { vendor: "  " }]);
  ok(opts.length === 2, "two distinct vendors, blanks dropped");
  ok(opts[0]!.label === "Agro" && opts[1]!.label === "Phat Panda", "sorted by label, most common spelling wins");
  ok(opts[1]!.count === 3 && opts[1]!.key === "phat panda", "count merges spellings");
  const tie = vendorOptions([{ vendor: "phat  panda" }, { vendor: "Phat Panda" }]);
  ok(tie.length === 1 && tie[0]!.label === "Phat Panda", "tie \u2192 the properly-cased spelling");

  // cardKeys / manifestKeySet
  ok(JSON.stringify(cardKeys({ key: "K1", lotKeys: ["L1", "K1", " ", "L2"] })) === '["K1","L1","L2"]', "cardKeys de-dupes and drops blanks");
  const mk = manifestKeySet([{ pos_product_key: "L1", lot_code: "C1" }, { pos_product_key: null, lot_code: " C2 " }, { pos_product_key: "", lot_code: null }]);
  ok(mk.size === 3 && mk.has("L1") && mk.has("C1") && mk.has("C2"), "manifestKeySet keeps pos key and lot code");

  // applyMastersFilter
  const cards = [
    { key: "A", lotKeys: [], vendor: "Phat Panda" },
    { key: "B", lotKeys: ["L1"], vendor: "Agro" },
    { key: "C", lotKeys: [], vendor: "phat panda" },
    { key: "D", lotKeys: [], vendor: null },
  ];
  ok(applyMastersFilter(cards, NO_MASTERS_FILTER, null).length === 4, "no facet → all");
  ok(applyMastersFilter(cards, { vendor: "phat panda", manifest: "" }, null).map((c) => c.key).join() === "A,C", "vendor facet");
  ok(applyMastersFilter(cards, { vendor: "", manifest: U }, new Set(["L1"])).map((c) => c.key).join() === "B", "manifest facet via restock lot key");
  ok(applyMastersFilter(cards, { vendor: "", manifest: U }, new Set(["A"])).map((c) => c.key).join() === "A", "manifest facet via the card's own key");
  ok(applyMastersFilter(cards, { vendor: "phat panda", manifest: U }, new Set(["L1"])).length === 0, "facets intersect (AND)");
  ok(applyMastersFilter(cards, { vendor: "", manifest: U }, null).length === 0, "manifest set but unread → nothing, never everything");
  ok(applyMastersFilter(cards, { vendor: "nobody", manifest: "" }, null).length === 0, "unknown vendor → nothing");

  // masterPasses
  const card = (key: string) => ({ key } as unknown as MasteredCard);
  ok(masterPasses([{ key: "A", variantLabel: null, card: card("A") }], new Set(["A"])), "master passes via member card");
  ok(!masterPasses([{ key: "A", variantLabel: null, card: null }], new Set(["A"])), "member not on menu never passes");
  ok(!masterPasses([], new Set(["A"])), "empty master never passes a filter");

  // withMastersFilter
  ok(withMastersFilter("/b?tab=live", NO_MASTERS_FILTER) === "/b?tab=live", "no facet \u2192 href unchanged");
  ok(withMastersFilter("/b?tab=live", { vendor: "phat panda", manifest: U }) === `/b?tab=live&vendor=phat+panda&manifest=${U}`, "facets appended with &");
  ok(withMastersFilter("/b", { vendor: "a&b", manifest: "" }) === "/b?vendor=a%26b", "no query \u2192 ?, value encoded");

  // manifests
  ok(isMasterableManifest("accepted") && isMasterableManifest(" Partially_Accepted ") && !isMasterableManifest("pending") && !isMasterableManifest("rejected") && !isMasterableManifest(null), "only accepted deliveries");
  const man = { id: U, manifest_number: "M-1", vendor_label: "Phat Panda", transfer_date: "2026-04-02T00:00:00Z", status: "accepted" };
  ok(manifestOptionLabel(man) === "2026-04-02 · Phat Panda · #M-1", "label shape");
  ok(manifestOptionLabel({ ...man, invoice_number_override: "INV-9" }) === "2026-04-02 · Phat Panda · #INV-9", "invoice override wins");
  ok(manifestOptionLabel({ id: U, manifest_number: null, vendor_label: null, transfer_date: null, status: "accepted" }) === "Manifest 0f8fad5b", "never empty");
  const mo = manifestOptions([man, { ...man, id: "11111111-1111-1111-1111-111111111111", vendor_label: "Agro" }, { ...man, id: "22222222-2222-2222-2222-222222222222", status: "pending" }], "");
  ok(mo.length === 2, "pending manifests not offered");
  ok(manifestOptions([man, { ...man, id: "11111111-1111-1111-1111-111111111111", vendor_label: "Agro" }], "phat panda").length === 1, "manifest options follow the vendor facet");

  // params + summary
  ok(JSON.stringify(filterParams(NO_MASTERS_FILTER)) === "{}", "no params when unfiltered");
  ok(JSON.stringify(filterParams({ vendor: "agro", manifest: U })) === JSON.stringify({ vendor: "agro", manifest: U }), "both params");
  ok(filterSummary(2, 10, "Agro", null) === "Showing 2 of 10 live cards from Agro.", "summary vendor");
  ok(filterSummary(1, 1, null, "2026-04-02 · Agro") === "Showing 1 of 1 live card received on 2026-04-02 · Agro.", "summary manifest singular");

  return { passed, failed: 0 };
}
