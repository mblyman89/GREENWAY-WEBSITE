/**
 * src/lib/inventory/received-date-bulk-core.ts — R16b (PURE)
 *
 * Owner-entered received dates, in bulk, for the lots one Cultivera import
 * created without one (diagnostic `import_lot_received_date_missing`,
 * import-lot-core.ts). Real export measured for R16: 247 undated lots, every
 * one with stock, spread over a few dozen vendors — one lot page at a time
 * was the only way to fix them.
 *
 * WHY THIS IS NOT bulk-fill-core.ts
 *   BULK_FILLABLE_FIELDS is pinned to exactly three fields (bulk-fill-core
 *   tests + tests/compliance/slice8-bulk-fill.test.ts), and the received date
 *   is a compliance fact with its own provenance columns (0214:
 *   received_on_source / _set_by / _set_at) and its own validation
 *   (parseReceivedDateInput). This module reuses that validation verbatim.
 *
 * WHAT IT NEVER DOES (Rule 3.1 — never auto-commit uncertain data)
 *   - It never derives a date. Measured on the real export: barcode
 *     timestamps do NOT match received dates (0 same-day matches of 1971),
 *     and only 19 undated lots have a dated sibling. A sibling's date is
 *     SHOWN as a reference, never pre-filled or applied.
 *   - It never overwrites a date: the store's update is guarded by
 *     `received_on is null`, so a date set elsewhere in the meantime wins.
 *   - It writes nothing without an explicit attestation tick naming the
 *     source (paper manifest / invoice) — the date is the owner's statement.
 */
import { parseReceivedDateInput } from "@/lib/inventory/received-date-core";

export const RECEIVED_DATE_BULK_AUDIT = "inventory_lot.received_date_bulk_set";

export type UndatedLot = {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  productName: string | null;
  lotCode: string | null;
  posProductKey: string | null;
  onHandQty: number;
  /** A DATED lot of the same product on the same import, if any (reference only). */
  siblingDates: string[];
};

export type UndatedVendorGroup = {
  /** Stable form key: the vendor id, or "none" for lots with no vendor. */
  key: string;
  vendorName: string;
  lots: UndatedLot[];
  onHandTotal: number;
};

const NO_VENDOR = "none";

export function vendorGroupKey(vendorId: string | null | undefined): string {
  const v = String(vendorId ?? "").trim();
  return v || NO_VENDOR;
}

/** Undated lots grouped by vendor (largest group first, then by name). */
export function groupUndatedLots(lots: readonly UndatedLot[]): UndatedVendorGroup[] {
  const by = new Map<string, UndatedVendorGroup>();
  for (const l of lots) {
    const key = vendorGroupKey(l.vendorId);
    const g = by.get(key) ?? {
      key,
      vendorName: key === NO_VENDOR ? "No vendor on the lot" : (l.vendorName ?? "").trim() || "Unnamed vendor",
      lots: [],
      onHandTotal: 0,
    };
    g.lots.push(l);
    g.onHandTotal += Number.isFinite(l.onHandQty) ? l.onHandQty : 0;
    by.set(key, g);
  }
  const out = [...by.values()];
  for (const g of out) g.lots.sort((a, b) => (a.productName ?? "").localeCompare(b.productName ?? "") || a.id.localeCompare(b.id));
  out.sort((a, b) => b.lots.length - a.lots.length || a.vendorName.localeCompare(b.vendorName));
  return out;
}

export type BulkReceivedDateInput = {
  /** Lot ids ticked in the form. */
  selected: readonly string[];
  /** The group's one date (YYYY-MM-DD) — used for every ticked lot without its own. */
  groupDate: string | null | undefined;
  /** Optional per-lot dates (lot id → YYYY-MM-DD); a filled one wins over the group date. */
  perLot: Readonly<Record<string, string | null | undefined>>;
  /** The attestation tick ("1" when checked). */
  attest: string | null | undefined;
};

export type BulkReceivedDatePlan =
  | { ok: true; byDate: { receivedOn: string; lotIds: string[] }[]; lots: number }
  | { ok: false; error: string };

/**
 * Validate a bulk submission against the lots that are STILL undated right now
 * (the server re-reads them — the posted ids are never trusted on their own).
 */
export function planBulkReceivedDates(
  input: BulkReceivedDateInput,
  eligibleIds: ReadonlySet<string>,
  today?: string,
): BulkReceivedDatePlan {
  if (String(input.attest ?? "") !== "1") {
    return { ok: false, error: "Tick the box confirming these dates come from the paper manifest or invoice." };
  }
  const selected = [...new Set(input.selected.map((s) => String(s).trim()).filter(Boolean))];
  if (selected.length === 0) return { ok: false, error: "Tick at least one lot." };
  const stale = selected.filter((id) => !eligibleIds.has(id));
  if (stale.length === selected.length) {
    return { ok: false, error: "None of the ticked lots is still missing a received date — reload the page." };
  }
  const groupRaw = String(input.groupDate ?? "").trim();
  let groupDate: string | null = null;
  if (groupRaw) {
    const g = today ? parseReceivedDateInput(groupRaw, today) : parseReceivedDateInput(groupRaw);
    if (!g.ok) return { ok: false, error: g.error };
    groupDate = g.receivedOn;
  }
  const by = new Map<string, string[]>();
  for (const id of selected) {
    if (!eligibleIds.has(id)) continue; // dated meanwhile — skipped, never overwritten
    const own = String(input.perLot[id] ?? "").trim();
    let date = groupDate;
    if (own) {
      const p = today ? parseReceivedDateInput(own, today) : parseReceivedDateInput(own);
      if (!p.ok) return { ok: false, error: p.error };
      date = p.receivedOn;
    }
    if (!date) return { ok: false, error: "Enter the date for the group, or a date on every ticked lot." };
    const list = by.get(date) ?? [];
    list.push(id);
    by.set(date, list);
  }
  const byDate = [...by.entries()]
    .map(([receivedOn, lotIds]) => ({ receivedOn, lotIds }))
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
  return { ok: true, byDate, lots: byDate.reduce((n, d) => n + d.lotIds.length, 0) };
}

export function receivedDatesHref(importId: string, msg?: string, isError = false): string {
  const base = `/admin/menu-imports/${encodeURIComponent(importId)}/received-dates`;
  return msg ? `${base}?${isError ? "error" : "done"}=${encodeURIComponent(msg)}` : base;
}

/** Distinct sibling dates, oldest first (reference text only). */
export function siblingDateNote(dates: readonly string[]): string | null {
  const d = [...new Set(dates.filter(Boolean))].sort();
  if (d.length === 0) return null;
  return d.length === 1
    ? `Another lot of this product on the same import was received ${d[0]}.`
    : `Other lots of this product on the same import were received ${d.join(", ")}.`;
}

// ── self-tests ───────────────────────────────────────────────────────────────
export function __runReceivedDateBulkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL received-date-bulk-core: " + m);
    passed += 1;
  };
  const lot = (id: string, vendorId: string | null, vendorName: string | null, qty = 1): UndatedLot => ({
    id, vendorId, vendorName, productName: `P ${id}`, lotCode: null, posProductKey: null, onHandQty: qty, siblingDates: [],
  });
  const groups = groupUndatedLots([lot("a", "v1", "Cultivar"), lot("b", "v1", "Cultivar", 2), lot("c", null, null), lot("d", "v2", "Mama")]);
  ok(groups[0].key === "v1" && groups[0].lots.length === 2 && groups[0].onHandTotal === 3, "groups by vendor, biggest first");
  ok(groups.some((g) => g.key === "none" && g.vendorName === "No vendor on the lot"), "lots without a vendor get their own group");

  const TODAY = "2026-03-01";
  const elig = new Set(["a", "b", "c"]);
  ok(!planBulkReceivedDates({ selected: ["a"], groupDate: "2026-01-02", perLot: {}, attest: "" }, elig, TODAY).ok, "attestation required");
  ok(!planBulkReceivedDates({ selected: [], groupDate: "2026-01-02", perLot: {}, attest: "1" }, elig, TODAY).ok, "nothing ticked refused");
  ok(!planBulkReceivedDates({ selected: ["a"], groupDate: "2026-03-02", perLot: {}, attest: "1" }, elig, TODAY).ok, "future date refused");
  ok(!planBulkReceivedDates({ selected: ["a"], groupDate: "2013-01-01", perLot: {}, attest: "1" }, elig, TODAY).ok, "pre-2014 date refused");
  ok(!planBulkReceivedDates({ selected: ["a"], groupDate: "", perLot: {}, attest: "1" }, elig, TODAY).ok, "no date at all refused");
  ok(!planBulkReceivedDates({ selected: ["zz"], groupDate: "2026-01-02", perLot: {}, attest: "1" }, elig, TODAY).ok, "only stale ids refused");
  const p = planBulkReceivedDates(
    { selected: ["a", "b", "c", "zz", "a"], groupDate: "2026-01-02", perLot: { b: "2026-01-05", c: "" }, attest: "1" },
    elig,
    TODAY,
  );
  ok(p.ok && p.lots === 3, "dedupes, skips a lot dated meanwhile");
  ok(p.ok && p.byDate.length === 2 && p.byDate[0].receivedOn === "2026-01-02" && p.byDate[0].lotIds.join() === "a,c", "group date for lots without their own");
  ok(p.ok && p.byDate[1].receivedOn === "2026-01-05" && p.byDate[1].lotIds.join() === "b", "a per-lot date wins");
  ok(!planBulkReceivedDates({ selected: ["a"], groupDate: "2026-01-02", perLot: { a: "2026-02-30" }, attest: "1" }, elig, TODAY).ok, "bad per-lot date refused");
  ok(receivedDatesHref("a b", "x y", true) === "/admin/menu-imports/a%20b/received-dates?error=x%20y", "href");
  ok(siblingDateNote([]) === null && siblingDateNote(["2026-01-03", "2026-01-01", "2026-01-03"])!.includes("2026-01-01, 2026-01-03"), "sibling note");
  return { passed, failed: 0 };
}
