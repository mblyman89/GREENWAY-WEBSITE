/**
 * src/lib/ai/kb/kb-bulk-review-core.ts  (D244 round 6, slice R-19)
 *
 * Owner (verbatim): "I need a way to approve all of the 20,000 records
 * awaiting me in the kb data pipeline. The bronze, silver, gold page. The
 * majority of it is good data, but too much of it to go through one by one
 * with system wait time from thinking and such. We need a more practical way
 * to manage this."
 *
 * Pure rules for "Publish every draft that passes" on the KB pipeline and
 * the review inbox:
 *   - a person presses it (drafts-only rule: the press IS the validation);
 *   - the browser walks every draft in pages (keyset by id), so 20,000
 *     records never hit the request time limit and nothing is read twice;
 *   - each record must pass the chosen quality bar (the same score the
 *     review card shows) AND the WA I-502 compliance scan of its words;
 *   - the source filter can limit it to one kind of intake;
 *   - "Check first" counts what WOULD publish without changing anything;
 *   - skipped records stay drafts for a person, with the reason counted.
 */
import { scoreProduct } from "./quality";

/** Drafts read per server call. */
export const KB_BULK_PAGE = 500;
/** Ids per UPDATE ... in (...) (keeps the request URL short). */
export const KB_BULK_UPDATE_CHUNK = 100;

export const KB_QUALITY_OPTIONS = [
  { value: 0, label: "Any quality" },
  { value: 40, label: "Fair or better (40+)" },
  { value: 65, label: "Good or better (65+)" },
  { value: 85, label: "Excellent only (85+)" },
] as const;
export const KB_DEFAULT_MIN_QUALITY = 65;

export type KbSourceGroup = "all" | "ccrs" | "writeback" | "crawl" | "other";
export const KB_SOURCE_OPTIONS: readonly { value: KbSourceGroup; label: string }[] = [
  { value: "all", label: "Every source" },
  { value: "ccrs", label: "CCRS state data" },
  { value: "writeback", label: "Accepted enrichment / AI drafts" },
  { value: "crawl", label: "Vendor website crawl" },
  { value: "other", label: "Everything else (manual, seed, …)" },
];

/** Which intake a record came from (its `source` column). */
export function sourceGroup(source: string | null | undefined): Exclude<KbSourceGroup, "all"> {
  const s = String(source ?? "").trim().toLowerCase();
  if (s.startsWith("ccrs:") || s === "ccrs") return "ccrs";
  if (s === "enrichment" || s === "suggestion" || s.startsWith("writeback")) return "writeback";
  if (s.startsWith("crawl") || s.startsWith("harvest") || s.startsWith("discovery")) return "crawl";
  return "other";
}

export function cleanMinQuality(raw: unknown): number {
  const n = Number(raw);
  const ok = KB_QUALITY_OPTIONS.map((o) => o.value as number);
  return ok.includes(n) ? n : KB_DEFAULT_MIN_QUALITY;
}

export function cleanSourceGroup(raw: unknown): KbSourceGroup {
  const v = String(raw ?? "");
  return (KB_SOURCE_OPTIONS.find((o) => o.value === v)?.value ?? "all") as KbSourceGroup;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The keyset cursor ("" = start). */
export function cleanCursor(raw: unknown): string {
  const v = String(raw ?? "").trim();
  return UUID_RE.test(v) ? v.toLowerCase() : "";
}

export type KbDraftLite = {
  id: string;
  display_name?: string | null;
  category?: string | null;
  aroma_notes?: string[] | null;
  flavor_notes?: string[] | null;
  terpenes?: string[] | null;
  effects?: string[] | null;
  description?: string | null;
  short_description?: string | null;
  summary?: string | null;
  source?: string | null;
  sources?: string[] | null;
  confidence?: number | null;
};

/** The words a shopper could read, for the compliance scan. */
export function kbScanText(r: KbDraftLite): string {
  return [r.display_name, r.description, r.short_description, r.summary, (r.effects ?? []).join(", ")]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

export type KbDecision = { publish: true } | { publish: false; reason: "source" | "quality" | "compliance" | "empty" };

/**
 * One record: publish when it is from the chosen source, has a name, meets
 * the quality bar and its words pass compliance (`complianceOk`).
 */
export function kbBulkDecide(r: KbDraftLite, o: { minQuality: number; source: KbSourceGroup }, complianceOk: boolean): KbDecision {
  if (o.source !== "all" && sourceGroup(r.source) !== o.source) return { publish: false, reason: "source" };
  if (!String(r.display_name ?? "").trim()) return { publish: false, reason: "empty" };
  const q = scoreProduct(r as unknown as Record<string, unknown>).quality;
  if (q < o.minQuality) return { publish: false, reason: "quality" };
  if (!complianceOk) return { publish: false, reason: "compliance" };
  return { publish: true };
}

export type KbBulkTotals = { scanned: number; published: number; quality: number; compliance: number; source: number; empty: number; failed: number };
export const emptyKbTotals = (): KbBulkTotals => ({ scanned: 0, published: 0, quality: 0, compliance: 0, source: 0, empty: 0, failed: 0 });

export function addKbTotals(a: KbBulkTotals, b: Partial<KbBulkTotals>): KbBulkTotals {
  return {
    scanned: a.scanned + (b.scanned ?? 0),
    published: a.published + (b.published ?? 0),
    quality: a.quality + (b.quality ?? 0),
    compliance: a.compliance + (b.compliance ?? 0),
    source: a.source + (b.source ?? 0),
    empty: a.empty + (b.empty ?? 0),
    failed: a.failed + (b.failed ?? 0),
  };
}

const n = (x: number) => x.toLocaleString("en-US");
const s = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

/** The line after a run (or a "Check first"). */
export function kbBulkSummary(t: KbBulkTotals, dryRun: boolean): string {
  const head = dryRun
    ? `Checked ${s(t.scanned, "draft")}: ${s(t.published, "record")} would publish.`
    : `Published ${s(t.published, "record")} into the KB (checked ${s(t.scanned, "draft")}).`;
  const kept: string[] = [];
  if (t.quality) kept.push(`${n(t.quality)} below the quality bar`);
  if (t.compliance) kept.push(`${n(t.compliance)} with a compliance flag`);
  if (t.empty) kept.push(`${n(t.empty)} without a name`);
  if (t.source) kept.push(`${n(t.source)} from another source`);
  if (t.failed) kept.push(`${n(t.failed)} that could not be saved (press again)`);
  const tail = kept.length ? ` ${dryRun ? "Would stay" : "Stayed"} drafts for you: ${kept.join(", ")}.` : "";
  return head + tail;
}

export function kbBulkConfirm(drafts: number, minQuality: number, source: KbSourceGroup): string {
  const q = KB_QUALITY_OPTIONS.find((o) => o.value === minQuality)?.label ?? `${minQuality}+`;
  const src = KB_SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source;
  return `Publish every KB draft that passes? Up to ${s(drafts, "draft")} will be checked (${q}; ${src}). Each must also pass the compliance scan; the rest stay drafts. Published records become trusted facts for the menu and the AI. You can archive any later.`;
}

export function kbBulkProgress(t: KbBulkTotals, total: number, dryRun: boolean): string {
  return `${dryRun ? "Checking" : "Publishing"}… ${n(t.scanned)} of about ${n(Math.max(total, t.scanned))} checked, ${n(t.published)} ${dryRun ? "would publish" : "published"}.`;
}

export function chunkIds<T>(list: readonly T[], size = KB_BULK_UPDATE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)));
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runKbBulkReviewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`kb-bulk-review-core FAIL: ${name}`);
    }
  };
  const full: KbDraftLite = { id: "a", display_name: "Avitas Blue Dream 1g", category: "vape", aroma_notes: ["berry"], flavor_notes: ["sweet"], description: "A berry-forward cart.", sources: ["CCRS dataset"], confidence: 0.9, source: "ccrs:1" };
  const thin: KbDraftLite = { id: "b", display_name: "Thin", category: "flower", source: "enrichment" };
  ok(sourceGroup("ccrs:abc") === "ccrs" && sourceGroup("enrichment") === "writeback" && sourceGroup("writeback:suggestion") === "writeback", "source groups");
  ok(sourceGroup("crawl:https://x") === "crawl" && sourceGroup(null) === "other" && sourceGroup("manual") === "other", "crawl / other");
  ok(cleanMinQuality("85") === 85 && cleanMinQuality("13") === 65 && cleanMinQuality(undefined) === 65, "quality bar cleaned");
  ok(cleanSourceGroup("ccrs") === "ccrs" && cleanSourceGroup("x") === "all", "source cleaned");
  ok(cleanCursor("6F9619FF-8B86-D011-B42D-00C04FC964FF") === "6f9619ff-8b86-d011-b42d-00c04fc964ff" && cleanCursor("x' or 1=1") === "", "cursor is a uuid or start");
  ok(kbBulkDecide(full, { minQuality: 85, source: "all" }, true).publish === true, "a complete record publishes at 85");
  const t1 = kbBulkDecide(thin, { minQuality: 65, source: "all" }, true);
  ok(!t1.publish && t1.reason === "quality", "a thin record stays (quality)");
  ok(kbBulkDecide(thin, { minQuality: 0, source: "all" }, true).publish === true, "any quality publishes it");
  const t2 = kbBulkDecide(full, { minQuality: 0, source: "all" }, false);
  ok(!t2.publish && t2.reason === "compliance", "a compliance flag always stays");
  const t3 = kbBulkDecide(full, { minQuality: 0, source: "writeback" }, true);
  ok(!t3.publish && t3.reason === "source", "other source stays");
  const t4 = kbBulkDecide({ ...full, display_name: " " }, { minQuality: 0, source: "all" }, true);
  ok(!t4.publish && t4.reason === "empty", "no name stays");
  ok(kbScanText({ id: "x", display_name: "N", description: "D", effects: ["calm", "happy"] }) === "N\nD\ncalm, happy", "scan text");
  const tot = addKbTotals(emptyKbTotals(), { scanned: 500, published: 480, quality: 15, compliance: 5 });
  ok(kbBulkSummary(tot, false) === "Published 480 records into the KB (checked 500 drafts). Stayed drafts for you: 15 below the quality bar, 5 with a compliance flag.", "summary");
  ok(kbBulkSummary(addKbTotals(emptyKbTotals(), { scanned: 20000, published: 19000 }), true).startsWith("Checked 20,000 drafts: 19,000 records would publish."), "dry-run summary with thousands");
  ok(kbBulkConfirm(20000, 65, "all").includes("Up to 20,000 drafts") && kbBulkConfirm(1, 85, "ccrs").includes("CCRS state data"), "confirm text");
  ok(chunkIds([1, 2, 3, 4, 5], 2).length === 3 && chunkIds([], 2).length === 0, "id chunks");
  ok(Math.ceil(20000 / KB_BULK_PAGE) === 40, "20,000 drafts take 40 presses of the server, not 20,000");
  return { passed, failed };
}
