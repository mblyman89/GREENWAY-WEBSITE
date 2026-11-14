/**
 * src/lib/enrichment/bulk-approve-core.ts  (D244 round 4, slice R-12)
 *
 * Owner (verbatim): "another thing I would like to add is on the bulk draft
 * ai feature, to be able to select one or all drafts waiting for me to
 * approve. I want this page to auto approve the ones that are over 80%. all
 * 250 I am seeing in the list are 85%. so it should be safe to approve these."
 *
 * Pure rules for the Bulk AI "select and approve" bar:
 *   - a ticked PRODUCT accepts its drafts at 80%+ (and best guesses, flagged)
 *     - the same rule as the per-product "Accept all >= 80%" button;
 *   - a ticked DRAFT is accepted as it is (a person chose it);
 *   - "Approve every draft at 80%+" ticks every product that has one;
 *   - the work goes to the server in small chunks so 250 products never hit
 *     the request time limit, with a running total on screen.
 * Accepting saves the facts; it never publishes (a photo still does that).
 */

/** Products per server call (each does up to 7 accepts + a KB write-back). */
export const BULK_APPROVE_CHUNK = 8;
/** Single drafts per server call. */
export const BULK_APPROVE_IDS_CHUNK = 40;
/** Most products one press works through. */
export const BULK_APPROVE_MAX = 600;

const KEY_RE = /^[^\u0000-\u001f]{1,300}$/;
const ID_RE = /^[0-9a-f-]{8,64}$/i;

/** Trimmed, de-duplicated, capped product keys. */
export function cleanApproveKeys(raw: unknown, cap = BULK_APPROVE_MAX): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const k = typeof v === "string" ? v.trim() : "";
    if (!k || !KEY_RE.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

/** Trimmed, de-duplicated, capped draft ids (uuid-like). */
export function cleanApproveIds(raw: unknown, cap = BULK_APPROVE_IDS_CHUNK): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of arr) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!ID_RE.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** Split into chunks of `size` (last one shorter). */
export function chunkList<T>(list: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** The products "Approve every draft at 80%+" works through: those with at least one eligible draft. */
export function autoApproveKeys(groups: readonly { key: string; eligible: number }[]): string[] {
  return cleanApproveKeys(groups.filter((g) => g.eligible > 0).map((g) => g.key));
}

/** A ticked draft whose product is also ticked is covered by the product (no double accept). */
export function draftsNotCovered(ids: readonly { id: string; key: string }[], keys: readonly string[]): string[] {
  const k = new Set(keys);
  return ids.filter((d) => !k.has(d.key)).map((d) => d.id);
}

export type ApproveTotals = { products: number; accepted: number; blocked: number; flagged: number; failed: number };
export const emptyTotals = (): ApproveTotals => ({ products: 0, accepted: 0, blocked: 0, flagged: 0, failed: 0 });

export function addTotals(a: ApproveTotals, b: Partial<ApproveTotals>): ApproveTotals {
  return {
    products: a.products + (b.products ?? 0),
    accepted: a.accepted + (b.accepted ?? 0),
    blocked: a.blocked + (b.blocked ?? 0),
    flagged: a.flagged + (b.flagged ?? 0),
    failed: a.failed + (b.failed ?? 0),
  };
}

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Accepted 1,204 drafts on 250 products. 3 best guesses flagged. Skipped 2 (compliance) - review those by hand." */
export function approveSummary(t: ApproveTotals): string {
  const parts = [`Accepted ${s(t.accepted, "draft")} on ${s(t.products, "product")}.`];
  if (t.flagged) parts.push(`${s(t.flagged, "best guess", "best guesses")} flagged for a closer look.`);
  if (t.blocked) parts.push(`Skipped ${t.blocked} (compliance re-scan or unreadable) \u2014 review those by hand.`);
  if (t.failed) parts.push(`${s(t.failed, "product")} could not be read; press again to retry.`);
  parts.push("Nothing was published: a product still goes live when it gets a photo.");
  return parts.join(" ");
}

/** "Approving… 40 of 250 products" */
export function approveProgress(done: number, total: number): string {
  return `Approving\u2026 ${done} of ${s(total, "product")}`;
}

/** The confirm text before "Approve every draft at 80%+". */
export function autoApproveConfirm(products: number, threshold: number): string {
  return `Accept every draft at ${threshold}% or better (best guesses too, flagged) on ${s(products, "product")}? Each one goes through the compliance re-scan. Nothing is published.`;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runBulkApproveCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`bulk-approve-core FAIL: ${name}`);
    }
  };
  ok(cleanApproveKeys([" a ", "a", "", 5, "b"]).join(",") === "a,b", "keys trimmed, de-duplicated, junk dropped");
  ok(cleanApproveKeys("a").length === 0, "keys: not a list");
  ok(cleanApproveKeys(Array.from({ length: 700 }, (_, i) => `k${i}`)).length === BULK_APPROVE_MAX, "keys capped");
  ok(cleanApproveKeys(["bad\u0001key"]).length === 0, "control characters refused");
  ok(cleanApproveIds(["0a1b2c3d-0000-4000-8000-000000000001", "nope", "0a1b2c3d-0000-4000-8000-000000000001"]).length === 1, "ids: uuid-like, de-duplicated");
  ok(cleanApproveIds(Array.from({ length: 50 }, (_, i) => `0a1b2c3d-0000-4000-8000-${String(i).padStart(12, "0")}`)).length === BULK_APPROVE_IDS_CHUNK, "ids capped");
  ok(chunkList([1, 2, 3, 4, 5], 2).map((c) => c.length).join(",") === "2,2,1", "chunks");
  ok(chunkList([], 8).length === 0 && chunkList([1], 0).length === 1, "chunks: empty and zero size");
  ok(chunkList(Array.from({ length: 250 }, (_, i) => i), BULK_APPROVE_CHUNK).length === 32, "250 products in 32 calls");
  ok(autoApproveKeys([{ key: "a", eligible: 3 }, { key: "b", eligible: 0 }, { key: "c", eligible: 1 }]).join(",") === "a,c", "auto: only products with an eligible draft");
  ok(draftsNotCovered([{ id: "1", key: "a" }, { id: "2", key: "b" }], ["a"]).join(",") === "2", "a ticked product covers its ticked drafts");
  const t = addTotals(addTotals(emptyTotals(), { products: 8, accepted: 50, flagged: 1 }), { products: 2, accepted: 10, blocked: 2 });
  ok(t.products === 10 && t.accepted === 60 && t.blocked === 2 && t.flagged === 1 && t.failed === 0, "totals add up");
  ok(approveSummary(t).startsWith("Accepted 60 drafts on 10 products.") && approveSummary(t).includes("1 best guess flagged") && approveSummary(t).includes("Skipped 2"), "summary");
  ok(approveSummary(emptyTotals()).includes("Nothing was published"), "summary says nothing published");
  ok(approveSummary({ ...emptyTotals(), failed: 1, products: 1, accepted: 1 }).includes("1 product could not be read"), "summary failed");
  ok(approveProgress(40, 250) === "Approving\u2026 40 of 250 products", "progress");
  ok(autoApproveConfirm(250, 80).includes("80% or better") && autoApproveConfirm(250, 80).includes("250 products"), "confirm text");
  return { passed, failed };
}
