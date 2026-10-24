/**
 * src/lib/compliance/ccrs-records-compare-core.ts  (R74 S40, Round 20)
 *
 * PURE. The CCRS Records page's three-way comparison of a CCRS data copy
 * (the LCB Service Desk delivery: Inventory / Product / Strain / Area) with
 * what we hold:
 *
 *   ledger   planReseed (S-15): what a merge would write, and what to review
 *   filings  verifyCopy (S-16): did what we SENT land as we sent it
 *   lots     our live inventory_lots against the copy's Inventory rows
 *            (by the id each lot is filed under): quantity drift, lots CCRS
 *            does not hold (the E52 hold), lots open only in CCRS (Cultivera
 *            ghosts), lots CCRS closed that we still stock
 *
 * Everything is folded into ONE list of CompareItem rows (one CSV, one
 * table, one filter bar) plus a counts summary that is stored on the copy.
 */
import type { SeedEntity, SeedSource } from "./ccrs-ledger-seed-core";
import type { ReseedPlan } from "./ccrs-reseed-core";
import type { VerifyResult } from "./ccrs-copy-verify-core";

export const RECORD_SOURCES: readonly SeedSource[] = ["Inventory", "Product", "Strain", "Area"];
export const RECORDS_BUCKET = "ccrs-records";

/** Which file a CSV is, by its exact header row (null = not a delivery file). */
export function detectSource(firstLine: string, headers: Record<SeedSource, readonly string[]>): SeedSource | null {
  const line = firstLine.replace(/^\uFEFF/, "").replace(/\r?\n?$/, "");
  const cells = line.split(",").map((c) => c.replace(/^"(.*)"$/, "$1"));
  for (const s of RECORD_SOURCES) {
    const want = headers[s];
    if (cells.length === want.length && cells.every((c, i) => c === want[i])) return s;
  }
  return null;
}

export function storageKey(copyId: string, source: SeedSource): string {
  if (!/^[0-9a-f-]{36}$/i.test(copyId)) throw new Error("bad copy id");
  return `copies/${copyId}/${source}.csv`;
}

/* ------------------------------------------------------------------ */

export type LiveLot = {
  id: string;
  externalId: string | null;
  lotCode: string | null;
  productName: string | null;
  onHand: number;
  status: string;
};

export type CompareArea = "ledger" | "filings" | "lots";

export type CompareItem = {
  area: CompareArea;
  bucket: string;
  /** Inventory / Product / Strain / Area */
  t: string;
  id: string;
  label: string;
  ours: string;
  ccrs: string;
  detail: string;
  /** true = needs action (counts toward the problem total) */
  problem: boolean;
};

export type LotBucket = "lotMatched" | "lotQtyDiffers" | "lotNotOnRecord" | "lotNoId" | "lotClosedInCcrs" | "lotCcrsOpenOursEmpty" | "lotCcrsOnlyOpen";

export const LOT_BUCKET_META: Record<LotBucket, { label: string; meaning: string; problem: boolean }> = {
  lotMatched: { label: "Matches CCRS", meaning: "Open with us and in CCRS with the same quantity on hand.", problem: false },
  lotQtyDiffers: { label: "Quantity differs", meaning: "Open in both, but the quantity on hand differs. Sales or adjustments after the copy date explain some; the rest need an adjustment or equalize.", problem: true },
  lotNotOnRecord: { label: "Not on the CCRS record", meaning: "We stock it under an id CCRS does not hold. These are the E52 held-back lots: merge this copy, or correct the id to the barcode Cultivera filed.", problem: true },
  lotNoId: { label: "No CCRS id", meaning: "We stock it but it has no CCRS id yet, so it cannot be compared. Assign or correct the id.", problem: true },
  lotClosedInCcrs: { label: "Closed in CCRS, open with us", meaning: "CCRS shows quantity 0 but we still stock it. A Cultivera close-out or a missed receive.", problem: true },
  lotCcrsOpenOursEmpty: { label: "Open in CCRS, empty with us", meaning: "CCRS still shows stock that we have sold or adjusted to 0. An adjustment or a closing Update is owed.", problem: true },
  lotCcrsOnlyOpen: { label: "Open in CCRS only", meaning: "CCRS shows stock under an id none of our lots carries (Cultivera ghosts). Clean these up with the State.", problem: true },
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""));

/** Lots vs the copy's Inventory rows. */
export function compareLots(copy: readonly SeedEntity[], lots: readonly LiveLot[]): { items: CompareItem[]; counts: Record<LotBucket, number> } {
  const inv = new Map<string, SeedEntity>();
  for (const e of copy) if (e.fileType === "Inventory") inv.set(e.externalId, e);
  const counts = Object.fromEntries(Object.keys(LOT_BUCKET_META).map((k) => [k, 0])) as Record<LotBucket, number>;
  const items: CompareItem[] = [];
  const seen = new Set<string>();
  const push = (bucket: LotBucket, t: Omit<CompareItem, "area" | "bucket" | "problem" | "t">) => {
    counts[bucket] += 1;
    if (bucket === "lotMatched") return;
    items.push({ area: "lots", bucket, t: "Inventory", problem: LOT_BUCKET_META[bucket].problem, ...t });
  };
  for (const l of lots) {
    const ext = l.externalId && l.externalId.trim() !== "" ? l.externalId.trim() : null;
    const label = l.productName || l.lotCode || l.id;
    const stocked = l.onHand > 0;
    if (!ext) {
      if (stocked) push("lotNoId", { id: l.lotCode || l.id, label, ours: `${fmtQty(l.onHand)} on hand`, ccrs: "-", detail: "no CCRS id assigned" });
      continue;
    }
    seen.add(ext);
    const c = inv.get(ext);
    const q = c ? Number(c.seedPayload["Quantity on Hand"]) : NaN;
    const ccrsName = c ? c.seedPayload["Product Name"] || c.seedPayload["Name"] || "" : "";
    if (!c) {
      if (stocked) push("lotNotOnRecord", { id: ext, label, ours: `${fmtQty(l.onHand)} on hand`, ccrs: "not held", detail: l.lotCode && l.lotCode !== ext ? `lot code ${l.lotCode}` : "" });
      continue;
    }
    const ccrsOpen = Number.isFinite(q) && q > 0;
    if (stocked && !ccrsOpen) push("lotClosedInCcrs", { id: ext, label, ours: `${fmtQty(l.onHand)} on hand`, ccrs: "0 on hand", detail: ccrsName });
    else if (!stocked && ccrsOpen) push("lotCcrsOpenOursEmpty", { id: ext, label, ours: "0 on hand", ccrs: `${fmtQty(q)} on hand`, detail: ccrsName });
    else if (stocked && ccrsOpen) {
      if (Math.abs(q - l.onHand) > 1e-6) push("lotQtyDiffers", { id: ext, label, ours: `${fmtQty(l.onHand)} on hand`, ccrs: `${fmtQty(q)} on hand`, detail: `difference ${fmtQty(l.onHand - q)}` });
      else push("lotMatched", { id: ext, label, ours: "", ccrs: "", detail: "" });
    }
  }
  for (const [id, c] of inv) {
    if (seen.has(id)) continue;
    const q = Number(c.seedPayload["Quantity on Hand"]);
    if (Number.isFinite(q) && q > 0) {
      push("lotCcrsOnlyOpen", { id, label: c.seedPayload["Product Name"] || c.seedPayload["Name"] || id, ours: "no lot", ccrs: `${fmtQty(q)} on hand`, detail: c.seedPayload["CreatedDate"] ? `created ${c.seedPayload["CreatedDate"]}` : "" });
    }
  }
  return { items, counts };
}

/* ------------------------------------------------------------------ */

export const PLAN_BUCKET_META: Record<string, { label: string; meaning: string; problem: boolean }> = {
  add: { label: "Merge: new to our ledger", meaning: "On the CCRS record but not in our ledger. The merge adds them so we never re-Insert an id CCRS already has.", problem: false },
  refresh: { label: "Merge: refreshed", meaning: "Untouched seed rows where the copy differs (open/closed, name, product).", problem: false },
  settleLink: { label: "Merge: migration lot now filed", meaning: "Cultivera lots held as unknown that CCRS now holds. Merging releases them for upload.", problem: false },
  settleUncertain: { label: "Merge: uncertain settled", meaning: "Rows a file left uncertain that this copy proves landed.", problem: false },
  seedMissing: { label: "Seeded, missing from copy", meaning: "A full copy should hold every earlier record: the copy may be partial. The merge refuses unless you accept this exact count.", problem: true },
  uncertainAbsent: { label: "Uncertain, not in copy", meaning: "CCRS does not seem to hold these. Decide whether to send them again.", problem: true },
  uncertainNotProven: { label: "Uncertain, not proven", meaning: "Uploaded on or after the copy date, so this copy cannot settle them. Ask for a later copy.", problem: false },
  oursDiffers: { label: "Our filing differs", meaning: "One of our files touched these and the copy says otherwise. Our later filing may just be newer than the copy.", problem: true },
  deletedPresent: { label: "Deleted with us, still in CCRS", meaning: "We deleted the id but CCRS still holds it. Ask the examiner.", problem: true },
  oursMissing: { label: "Our filing not in copy", meaning: "Filed by us but not in the copy: normal when uploaded after the copy date.", problem: false },
};

export function planItems(plan: ReseedPlan): CompareItem[] {
  const out: CompareItem[] = [];
  for (const w of plan.writes) {
    out.push({ area: "ledger", bucket: w.op, t: w.t, id: w.id, label: w.name ?? "", ours: w.expectState ?? "not in ledger", ccrs: w.state, detail: w.why, problem: false });
  }
  for (const [k, list] of Object.entries(plan.review)) {
    for (const r of list) out.push({ area: "ledger", bucket: k, t: r.t, id: r.id, label: "", ours: r.ledgerState ?? "-", ccrs: k === "seedMissing" || k === "uncertainAbsent" || k === "oursMissing" ? "not held" : "held", detail: r.why, problem: PLAN_BUCKET_META[k]?.problem ?? true });
  }
  return out;
}

const PROBLEM_VERIFY = new Set(["mismatched", "zeroedNotZero", "missing", "deletedPresent"]);

export function verifyItems(v: VerifyResult): CompareItem[] {
  return v.items
    .filter((i) => i.bucket !== "verified")
    .map((i) => ({
      area: "filings" as const,
      bucket: i.bucket,
      t: i.t,
      id: i.id,
      label: "",
      ours: i.diffs.map((d) => `${d.field}=${d.sent}`).join("; ") || `${i.op} in ${i.file}`,
      ccrs: i.diffs.map((d) => `${d.field}=${d.stored}`).join("; ") || (i.bucket === "missing" ? "not held" : ""),
      detail: [i.file, ...i.notes].filter(Boolean).join(" · "),
      problem: PROBLEM_VERIFY.has(i.bucket),
    }));
}

/* ------------------------------------------------------------------ */

export type CompareSummary = {
  asOf: string;
  copy: { entities: Record<string, number>; sourceRows: Record<string, number>; inventoryOpen: number; inventoryClosed: number };
  ledger: { ok: boolean; error: string | null; counts: ReseedPlan["counts"] | null };
  filings: { ok: boolean; error: string | null; total: Record<string, number> | null; sentRecords: number };
  lots: { ok: boolean; error: string | null; counts: Record<LotBucket, number> | null; liveLots: number };
  /** % of our stocked, comparable lots that match CCRS exactly (null when none). */
  syncScore: number | null;
  problems: number;
  buckets: Record<string, number>;
  /** per-bucket count of items left out of `items` (cap). */
  truncated: Record<string, number>;
  items: CompareItem[];
};

export const ITEM_CAP_PER_BUCKET = 5000;

export function summarize(input: {
  asOf: string;
  copyCounts: CompareSummary["copy"];
  plan: ReseedPlan | null;
  planError: string | null;
  verify: VerifyResult | null;
  verifyError: string | null;
  lots: { items: CompareItem[]; counts: Record<LotBucket, number> } | null;
  lotsError: string | null;
  liveLots: number;
}): CompareSummary {
  const all = [...(input.plan ? planItems(input.plan) : []), ...(input.verify ? verifyItems(input.verify) : []), ...(input.lots?.items ?? [])];
  const buckets: Record<string, number> = {};
  const truncated: Record<string, number> = {};
  const items: CompareItem[] = [];
  for (const it of all) {
    const k = `${it.area}:${it.bucket}`;
    buckets[k] = (buckets[k] ?? 0) + 1;
    if (buckets[k] > ITEM_CAP_PER_BUCKET) truncated[k] = (truncated[k] ?? 0) + 1;
    else items.push(it);
  }
  const lc = input.lots?.counts;
  const comparable = lc ? lc.lotMatched + lc.lotQtyDiffers + lc.lotNotOnRecord + lc.lotClosedInCcrs + lc.lotNoId : 0;
  return {
    asOf: input.asOf,
    copy: input.copyCounts,
    ledger: { ok: !!input.plan, error: input.planError, counts: input.plan?.counts ?? null },
    filings: { ok: !!input.verify, error: input.verifyError, total: input.verify?.counts.total ?? null, sentRecords: input.verify?.counts.sentRecords ?? 0 },
    lots: { ok: !!input.lots, error: input.lotsError, counts: lc ?? null, liveLots: input.liveLots },
    syncScore: lc && comparable > 0 ? Math.round((lc.lotMatched / comparable) * 1000) / 10 : null,
    problems: all.filter((i) => i.problem).length,
    buckets,
    truncated,
    items,
  };
}

/** Bucket key -> label/meaning for the UI. */
export function bucketMeta(area: CompareArea, bucket: string, verifyMeaning?: Record<string, string>): { label: string; meaning: string } {
  if (area === "lots") return LOT_BUCKET_META[bucket as LotBucket] ?? { label: bucket, meaning: "" };
  if (area === "ledger") return PLAN_BUCKET_META[bucket] ?? { label: bucket, meaning: "" };
  const labels: Record<string, string> = {
    mismatched: "Landed differently", zeroedNotZero: "Zeroed, CCRS still shows stock", missing: "Sent, not in copy", deletedPresent: "Deleted, still in copy",
    copyConflict: "Copy conflict", notJudgedUncertain: "Not judged: uncertain", notJudgedUnanswered: "Not judged: unanswered", notJudgedTooNew: "Not judged: too new",
  };
  return { label: labels[bucket] ?? bucket, meaning: verifyMeaning?.[bucket] ?? "" };
}

const csvCell = (s: string) => {
  const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** The full comparison as one CSV (formula-injection safe). */
export function itemsCsv(items: readonly CompareItem[]): string {
  const head = ["Area", "Finding", "Needs action", "Type", "Id", "Name", "Ours", "CCRS", "Detail"];
  const lines = [head.join(",")];
  for (const i of items) {
    const label = bucketMeta(i.area, i.bucket).label;
    lines.push([i.area, label, i.problem ? "yes" : "no", i.t, i.id, i.label, i.ours, i.ccrs, i.detail].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */

export function __runCcrsRecordsCompareTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (name: string, fn: () => boolean) => {
    try {
      if (fn()) passed += 1;
      else { failed += 1; console.error(`  x ${name}`); }
    } catch (e) { failed += 1; console.error(`  x ${name}: ${(e as Error).message}`); }
  };
  const inv = (id: string, qoh: string): SeedEntity => ({
    env: "prod", fileType: "Inventory", externalId: id, filedName: null, productExternalId: "P1", state: qoh === "0" ? "closed" : "seed",
    source: "seed:x", seedPayload: { "Quantity on Hand": qoh, "Product Name": `N-${id}` }, seedConflicts: null,
  });
  const lot = (id: string, ext: string | null, onHand: number): LiveLot => ({ id, externalId: ext, lotCode: id, productName: `lot ${id}`, onHand, status: "active" });
  const copy = [inv("A", "5"), inv("B", "3"), inv("C", "0"), inv("D", "2"), inv("G", "7"), inv("H", "0")];
  const lots = [lot("1", "A", 5), lot("2", "B", 4), lot("3", "C", 1), lot("4", "D", 0), lot("5", "X", 2), lot("6", null, 1), lot("7", null, 0), lot("8", "Y", 0)];
  const r = compareLots(copy, lots);

  t("matched counts but is not listed", () => r.counts.lotMatched === 1 && !r.items.some((i) => i.id === "A"));
  t("quantity differs", () => r.counts.lotQtyDiffers === 1 && r.items.some((i) => i.id === "B" && i.bucket === "lotQtyDiffers"));
  t("closed in CCRS, open with us", () => r.counts.lotClosedInCcrs === 1 && r.items.some((i) => i.id === "C"));
  t("open in CCRS, empty with us", () => r.counts.lotCcrsOpenOursEmpty === 1 && r.items.some((i) => i.id === "D"));
  t("not on record (E52)", () => r.counts.lotNotOnRecord === 1 && r.items.some((i) => i.id === "X"));
  t("no id only when stocked", () => r.counts.lotNoId === 1);
  t("ccrs-only open, closed ghosts ignored", () => r.counts.lotCcrsOnlyOpen === 1 && r.items.some((i) => i.id === "G") && !r.items.some((i) => i.id === "H"));
  t("empty lot not on record is ignored", () => !r.items.some((i) => i.id === "Y"));

  const s = summarize({ asOf: "2026-10-20", copyCounts: { entities: {}, sourceRows: {}, inventoryOpen: 0, inventoryClosed: 0 }, plan: null, planError: "x", verify: null, verifyError: null, lots: r, lotsError: null, liveLots: lots.length });
  t("sync score over comparable lots", () => s.syncScore === 20);
  t("problems counted", () => s.problems === 6 && s.buckets["lots:lotQtyDiffers"] === 1);

  const headers = { Inventory: ["a", "b"], Product: ["Name", "X"], Strain: ["StrainType", "Name"], Area: ["Q"] } as unknown as Record<SeedSource, readonly string[]>;
  t("detect by header (BOM + quotes)", () => detectSource('\uFEFF"StrainType",Name\r\n', headers) === "Strain" && detectSource("x,y", headers) === null);
  t("csv neutralises formulas", () => itemsCsv([{ area: "lots", bucket: "lotNoId", t: "Inventory", id: "=1+1", label: "a,b", ours: "", ccrs: "", detail: "", problem: true }]).includes(`'=1+1,"a,b"`));
  t("storage key guarded", () => storageKey("00000000-0000-0000-0000-000000000000", "Area") === "copies/00000000-0000-0000-0000-000000000000/Area.csv" && (() => { try { storageKey("../x", "Area"); return false; } catch { return true; } })());
  return { passed, failed };
}
