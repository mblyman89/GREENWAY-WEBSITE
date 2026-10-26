/**
 * src/lib/catalog/vendor-lookup-progress-core.ts  (R74 S44)
 *
 * PURE rules for the "Lookup progress by vendor" table on the Batch Lookups
 * Vendor confidence tab. For every Cultivera onboarding row: did we ask
 * Google, exactly what was asked, did Google come back with anything, how
 * many facts it found, and how many landed on the record. Rolled up per
 * vendor so the owner can see where each vendor stands and work through
 * them one at a time with the attach buttons.
 *
 * No DB here (server half: vendor-lookup-progress-server.ts).
 */

/** One onboarding row as the server reads it. */
export type ProgressDraft = {
  id: string;
  name: string;
  manifestId: string;
  vendor: string;
  brand: string | null;
  /** catalog_product_drafts.status (draft | approved | published | dismissed ...). */
  status: string;
};

/** One lookup_job_items row (only the bits this table needs). */
export type ProgressItem = {
  draftId: string;
  status: string;
  batchId: string | null;
  error: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  outcome: string | null;
  found: number | null;
  attached: number | null;
  queued: number | null;
  model: string | null;
  asked: string | null;
  usedWebSearch: boolean | null;
  sources: number | null;
  answerFound: boolean | null;
  /** R74 S49: open on paper but nothing will ever send it (job closed / batch over). */
  orphan?: boolean;
};

export type AskState =
  | "not_asked"
  | "queued"
  | "at_google"
  | "answered"
  | "nothing_found"
  | "from_memory"
  | "failed"
  | "stuck"
  | "stopped";

export const ASK_STATE_LABEL: Record<AskState, string> = {
  not_asked: "Not asked yet",
  queued: "Waiting in line",
  at_google: "At Google now",
  answered: "Google found info",
  nothing_found: "Asked - nothing found",
  from_memory: "Not asked - already on file",
  failed: "Failed",
  stuck: "Stuck - press Unstick & re-ask",
  stopped: "Stopped / skipped",
};

export const ASK_STATE_TONE: Record<AskState, "neutral" | "green" | "gold" | "orange" | "danger" | "outline"> = {
  not_asked: "outline",
  queued: "neutral",
  at_google: "gold",
  answered: "green",
  nothing_found: "orange",
  from_memory: "green",
  failed: "danger",
  stuck: "danger",
  stopped: "neutral",
};

export const MEMORY_MODEL_PREFIX = "Already on file";

export type ProductProgress = {
  draftId: string;
  name: string;
  manifestId: string;
  approved: boolean;
  state: AskState;
  /** How many times this row was sent to a lookup (every job item). */
  timesAsked: number;
  /** Exactly what was searched, or a rebuild for rows looked up before S44. */
  asked: string;
  askedIsExact: boolean;
  usedWebSearch: boolean;
  sources: number;
  factsFound: number;
  attached: number;
  queuedForReview: number;
  lastAt: string | null;
  note: string | null;
};

export type VendorProgress = {
  vendor: string;
  key: string;
  products: number;
  approved: number;
  asked: number;
  answered: number;
  nothingFound: number;
  fromMemory: number;
  notAsked: number;
  inFlight: number;
  failed: number;
  /** R74 S49: in progress on paper, but nothing will send them */
  stuck: number;
  /** of inFlight: waiting in line (not yet at Google) */
  waiting: number;
  factsFound: number;
  attached: number;
  /** Products with info (answered or on file) / products, 0-100. */
  completeness: number;
  rows: ProductProgress[];
};

const ms = (s: string | null): number => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const vkey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/** The query a row WOULD have sent (name + brand + vendor), for pre-S44 rows. */
export function rebuiltQuery(d: Pick<ProgressDraft, "name" | "brand" | "vendor">): string {
  const parts = [d.name, d.brand ?? "", d.vendor].map((s) => (s ?? "").trim()).filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function stateOf(it: ProgressItem): AskState {
  const s = (it.status ?? "").toLowerCase();
  if ((s === "queued" || s === "running") && it.orphan) return "stuck";
  if (s === "queued") return "queued";
  if (s === "running") return it.batchId ? "at_google" : "queued";
  if (s === "failed") return "failed";
  if (s === "canceled") return "stopped";
  if (s !== "done") return "stopped";
  if ((it.model ?? "").startsWith(MEMORY_MODEL_PREFIX) || it.outcome === "known") return "from_memory";
  if (it.outcome === "not_found") return "nothing_found";
  if (n(it.found) === 0 && it.answerFound === false) return "nothing_found";
  return "answered";
}

/** One product's lookup story from all of its job items. */
export function productProgress(d: ProgressDraft, items: readonly ProgressItem[]): ProductProgress {
  const mine = [...items].sort((a, b) => ms(b.finishedAt ?? b.updatedAt) - ms(a.finishedAt ?? a.updatedAt));
  // The open item (if any) is the live state; otherwise the newest finished one.
  const open = mine.find((i) => i.status === "queued" || i.status === "running");
  const lastDone = mine.find((i) => i.status === "done");
  const head = open ?? lastDone ?? mine[0] ?? null;
  const approved = d.status !== "draft";
  const base = { draftId: d.id, name: d.name, manifestId: d.manifestId, approved, timesAsked: mine.length };
  if (!head) {
    return { ...base, state: "not_asked", asked: rebuiltQuery(d), askedIsExact: false, usedWebSearch: false, sources: 0, factsFound: 0, attached: 0, queuedForReview: 0, lastAt: null, note: null };
  }
  const facts = lastDone ?? head;
  const exact = (facts.asked ?? head.asked ?? "").trim();
  return {
    ...base,
    state: stateOf(head),
    asked: exact || rebuiltQuery(d),
    askedIsExact: Boolean(exact),
    usedWebSearch: facts.usedWebSearch === true,
    sources: n(facts.sources),
    factsFound: n(facts.found),
    attached: n(facts.attached),
    queuedForReview: n(facts.queued),
    lastAt: head.finishedAt ?? head.updatedAt,
    note:
      head.status === "failed" || head.status === "canceled"
        ? (head.error ?? "").slice(0, 200) || null
        : stateOf(head) === "stuck"
          ? "Nothing is sending this one (its lookup was closed or its batch ended without an answer). Press Unstick & re-ask."
          : null,
  };
}

/** Roll every product up per vendor (A to Z), rows weakest first. */
export function vendorProgress(drafts: readonly ProgressDraft[], items: readonly ProgressItem[]): VendorProgress[] {
  const byDraft = new Map<string, ProgressItem[]>();
  for (const it of items) {
    const k = String(it.draftId).toLowerCase();
    const list = byDraft.get(k) ?? [];
    list.push(it);
    byDraft.set(k, list);
  }
  const byVendor = new Map<string, VendorProgress>();
  for (const d of drafts) {
    if ((d.status ?? "").toLowerCase() === "dismissed") continue;
    const key = vkey(d.vendor || "Unknown vendor");
    let v = byVendor.get(key);
    if (!v) {
      v = { vendor: d.vendor || "Unknown vendor", key, products: 0, approved: 0, asked: 0, answered: 0, nothingFound: 0, fromMemory: 0, notAsked: 0, inFlight: 0, failed: 0, stuck: 0, waiting: 0, factsFound: 0, attached: 0, completeness: 0, rows: [] };
      byVendor.set(key, v);
    }
    const p = productProgress(d, byDraft.get(d.id.toLowerCase()) ?? []);
    v.rows.push(p);
    v.products += 1;
    if (p.approved) v.approved += 1;
    if (p.timesAsked > 0 && p.state !== "from_memory") v.asked += 1;
    if (p.state === "answered") v.answered += 1;
    if (p.state === "nothing_found") v.nothingFound += 1;
    if (p.state === "from_memory") v.fromMemory += 1;
    if (p.state === "not_asked") v.notAsked += 1;
    if (p.state === "queued" || p.state === "at_google") v.inFlight += 1;
    if (p.state === "queued") v.waiting += 1;
    if (p.state === "failed") v.failed += 1;
    if (p.state === "stuck") v.stuck += 1;
    v.factsFound += p.factsFound;
    v.attached += p.attached;
  }
  const order: Record<AskState, number> = { stuck: 0, failed: 0, not_asked: 1, nothing_found: 2, stopped: 3, queued: 4, at_google: 5, answered: 6, from_memory: 7 };
  const out = [...byVendor.values()];
  for (const v of out) {
    v.completeness = v.products === 0 ? 0 : Math.round(((v.answered + v.fromMemory) / v.products) * 100);
    v.rows.sort((a, b) => order[a.state] - order[b.state] || a.factsFound - b.factsFound || a.name.localeCompare(b.name));
  }
  return out.sort((a, b) => a.vendor.localeCompare(b.vendor));
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runVendorLookupProgressTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.log("FAIL:", m);
    }
  };
  const d = (id: string, over: Partial<ProgressDraft> = {}): ProgressDraft => ({ id, name: `P ${id}`, manifestId: "m1", vendor: "Phat Panda", brand: "Phat Panda", status: "draft", ...over });
  const it = (draftId: string, over: Partial<ProgressItem> = {}): ProgressItem => ({ draftId, status: "done", batchId: null, error: null, finishedAt: "2026-01-02T00:00:00Z", updatedAt: null, outcome: "attached", found: 6, attached: 3, queued: 2, model: "gemini", asked: "P a Phat Panda", usedWebSearch: true, sources: 4, answerFound: true, ...over });

  const none = productProgress(d("a"), []);
  ok(none.state === "not_asked" && none.timesAsked === 0, "no items -> not asked");
  ok(none.asked === "P a Phat Panda" && !none.askedIsExact, "rebuilt query dedupes brand = vendor");

  const ans = productProgress(d("a"), [it("a")]);
  ok(ans.state === "answered" && ans.factsFound === 6 && ans.sources === 4 && ans.askedIsExact, "answered row carries facts + exact query");

  ok(productProgress(d("a"), [it("a", { outcome: "not_found", found: 0 })]).state === "nothing_found", "not_found -> nothing found");
  ok(productProgress(d("a"), [it("a", { model: "Already on file (knowledge base) - no web lookup", outcome: "known" })]).state === "from_memory", "memory -> not asked, on file");
  ok(productProgress(d("a"), [it("a", { status: "running", batchId: "b1" })]).state === "at_google", "running in a batch -> at Google");
  const failedRow = productProgress(d("a"), [it("a", { status: "failed", error: "Gemini batch: boom" })]);
  ok(failedRow.state === "failed" && failedRow.note === "Gemini batch: boom", "failed carries its note");
  ok(productProgress(d("a"), [it("a", { status: "running", batchId: "b0", orphan: true })]).state === "stuck", "orphaned running -> stuck");
  ok(vendorProgress([d("a")], [it("a", { status: "queued", orphan: true })])[0].stuck === 1, "stuck counted per vendor");

  const reask = productProgress(d("a"), [it("a"), it("a", { status: "queued", finishedAt: null, updatedAt: "2026-01-03T00:00:00Z" })]);
  ok(reask.state === "queued" && reask.timesAsked === 2 && reask.factsFound === 6, "re-queued keeps last facts, shows live state");

  const vs = vendorProgress(
    [d("a"), d("b"), d("c", { status: "approved" }), d("x", { vendor: "Zoo", status: "dismissed" }), d("y", { vendor: "Agro" })],
    [it("a"), it("b", { outcome: "not_found", found: 0 }), it("c", { model: "Already on file x", outcome: "known", found: 5 })],
  );
  ok(vs.length === 2 && vs[0].vendor === "Agro", "vendors A-Z, dismissed rows dropped");
  const pp = vs[1];
  ok(pp.products === 3 && pp.answered === 1 && pp.nothingFound === 1 && pp.fromMemory === 1, "rollup counts");
  ok(pp.asked === 2 && pp.approved === 1, "asked excludes memory; approved counted");
  ok(pp.completeness === 67, "completeness = (answered + on file) / products");
  ok(pp.rows[0].state === "nothing_found", "weakest rows first");
  ok(vs[0].notAsked === 1 && vs[0].completeness === 0, "never-asked vendor is 0%");
  return { passed, failed };
}
