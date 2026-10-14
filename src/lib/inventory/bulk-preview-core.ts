/**
 * src/lib/inventory/bulk-preview-core.ts   (R50 A3)
 *
 * "Preview first (writes nothing)" for the bulk buttons of the Cultivera
 * cutover that had no preview:
 *
 *   - Attach vendor lab results to every Cultivera manifest (S12b): the SAME
 *     walk and the SAME link plan (attachWciaLabResults with dryRun), stopped
 *     before any lab result, lot, timeline or audit write.
 *   - Save a copy of every lab certificate (S13): the SAME candidate query
 *     (coa_url set, no stored copy) and the SAME URL safety check; nothing is
 *     downloaded, uploaded or recorded.
 *   - Fill received dates & cannabinoids from the spreadsheet (R15a): the
 *     SAME re-read and planLotFactFill, stopped before the guarded updates.
 *
 * Pure copy + counting only. Every sentence says it is a preview, that
 * nothing was written, and (where a real run can do less) why the real run
 * may do fewer: every real write is guarded fill-only, so anything filled in
 * the meantime is skipped, never overwritten.
 */
import type { WciaBackfillRun } from "@/lib/inventory/cultivera-wcia-backfill-core";
import { checkCoaUrl, type CoaUrlCheck } from "@/lib/inventory/coa-archive-backfill-core";

export const PREVIEW_PREFIX = "Preview - nothing was written.";
export const PREVIEW_GUARD_NOTE = "The real run fills blanks only, so anything filled in the meantime is skipped (never overwritten).";

const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

// --- WCIA lab results ---------------------------------------------------------------

/** What the S12b button would do, from a dry run of the same walk. */
export function wciaPreviewNote(run: WciaBackfillRun): string {
  const t = run.totals;
  if (!run.ok) return `${PREVIEW_PREFIX} The preview stopped: ${run.error}. So far ${plural(t.manifests, "manifest")} checked. Press Preview again to retry.`;
  const parts = [
    `${plural(t.manifests, "Cultivera manifest")} checked`,
    `would link ${plural(t.linked, "lot")} to the vendor's lab result`,
    `would add ${plural(t.created, "new lab result")}`,
    t.reused > 0 ? `would reuse ${t.reused.toLocaleString("en-US")} already on file` : "",
    t.outcomes["has-lab"] > 0 ? `${t.outcomes["has-lab"].toLocaleString("en-US")} lots already have one (kept)` : "",
    t.outcomes["not-on-transfer"] + t.outcomes["no-lab"] > 0
      ? `${(t.outcomes["not-on-transfer"] + t.outcomes["no-lab"]).toLocaleString("en-US")} lots have no lab data on their transfer`
      : "",
    t.outcomes.ambiguous > 0 ? `${t.outcomes.ambiguous.toLocaleString("en-US")} would be left alone (two different lab results on one transfer)` : "",
    t.noFile > 0 ? `${plural(t.noFile, "manifest")} without a vendor file` : "",
    t.unreadable > 0 ? `${t.unreadable.toLocaleString("en-US")} with an unreadable file` : "",
    t.errored > 0 ? `${t.errored.toLocaleString("en-US")} could not be checked` : "",
  ].filter(Boolean);
  const probs = t.problems.length > 0 ? ` Problems: ${t.problems.slice(0, 3).join("; ")}.` : "";
  const scope = run.done ? "" : " This preview reached the time limit, so it covers only the manifests above; press Continue preview for the rest.";
  return `${PREVIEW_PREFIX} ${parts.join(", ")}.${probs}${scope} ${PREVIEW_GUARD_NOTE}`;
}

export function wciaPreviewTone(run: WciaBackfillRun): "info" | "warn" {
  if (!run.ok) return "warn";
  return run.totals.errored > 0 || run.totals.unreadable > 0 || run.totals.problems.length > 0 ? "warn" : "info";
}

// --- COA certificate copies ------------------------------------------------------------

export type CoaPreviewRow = { id: string; coa_url: string | null };
export type CoaBadReason = Exclude<CoaUrlCheck, { ok: true }>["reason"];
export type CoaPreview = {
  candidates: number;
  fetchable: number;
  bad: Record<CoaBadReason, number>;
  /** Top hosts the real run would download from (count desc, then name). */
  hosts: { host: string; n: number }[];
};

export const COA_PREVIEW_HOSTS = 5;

/** Classify the candidate rows exactly as the real run's first step does (checkCoaUrl). */
export function planCoaPreview(rows: readonly CoaPreviewRow[]): CoaPreview {
  const bad: Record<CoaBadReason, number> = { blank: 0, malformed: 0, "not-https": 0, "private-host": 0 };
  const hosts = new Map<string, number>();
  let fetchable = 0;
  for (const r of rows) {
    const c = checkCoaUrl(r.coa_url);
    if (!c.ok) {
      bad[c.reason] += 1;
      continue;
    }
    fetchable += 1;
    const h = new URL(c.url).hostname.toLowerCase();
    hosts.set(h, (hosts.get(h) ?? 0) + 1);
  }
  const top = [...hosts].map(([host, n]) => ({ host, n })).sort((a, b) => b.n - a.n || a.host.localeCompare(b.host)).slice(0, COA_PREVIEW_HOSTS);
  return { candidates: rows.length, fetchable, bad, hosts: top };
}

const BAD_COPY: Record<CoaBadReason, string> = {
  blank: "blank",
  malformed: "not a valid link",
  "not-https": "not https",
  "private-host": "an internal address (never fetched)",
};

export type CoaPreviewRun = { ok: true; preview: CoaPreview; capped: boolean } | { ok: false; error: string };

export function coaPreviewNote(run: CoaPreviewRun): string {
  if (!run.ok) return `${PREVIEW_PREFIX} The preview stopped: ${run.error}. Press Preview again to retry.`;
  const p = run.preview;
  if (p.candidates === 0) return `${PREVIEW_PREFIX} Every lab result with a certificate link already has its private copy. Nothing to save.`;
  const badN = Object.values(p.bad).reduce((s, n) => s + n, 0);
  const badWhy = (Object.keys(p.bad) as CoaBadReason[]).filter((k) => p.bad[k] > 0).map((k) => `${p.bad[k]} ${BAD_COPY[k]}`);
  const hosts = p.hosts.length > 0 ? ` From: ${p.hosts.map((h) => `${h.host} (${h.n.toLocaleString("en-US")})`).join(", ")}.` : "";
  const cap = run.capped ? " (the first ones only - there are more)" : "";
  return (
    `${PREVIEW_PREFIX} ${plural(p.candidates, "lab result")} with a certificate link and no saved copy${cap}: ` +
    `would try to download ${p.fetchable.toLocaleString("en-US")}` +
    (badN > 0 ? `, would skip ${badN.toLocaleString("en-US")} with an unusable link (${badWhy.join(", ")})` : "") +
    `.${hosts} Each download must really be a PDF of at most 25 MB or it is skipped. Nothing about a lot, stock, price or the menu changes.`
  );
}

export function coaPreviewTone(run: CoaPreviewRun): "info" | "warn" {
  if (!run.ok) return "warn";
  return Object.values(run.preview.bad).some((n) => n > 0) ? "warn" : "info";
}

// --- Lot facts fill ---------------------------------------------------------------------

export type FactFillPreview = { matched: number; datesWould: number; potencyWould: number; potencyColumnsPresent: boolean };

export function factFillPreviewNote(p: FactFillPreview): string {
  if (p.matched === 0) return `${PREVIEW_PREFIX} No lot of this import was found to fill.`;
  if (p.datesWould === 0 && p.potencyWould === 0) return `${PREVIEW_PREFIX} Matched ${plural(p.matched, "lot")}; every received date and cannabinoid is already filled. Pressing Fill would change nothing.`;
  return (
    `${PREVIEW_PREFIX} Matched ${plural(p.matched, "lot")}: would fill ${plural(p.datesWould, "received date")} and cannabinoids on ${plural(p.potencyWould, "lot")}. ` +
    PREVIEW_GUARD_NOTE +
    (p.potencyColumnsPresent ? "" : " THC/CBD columns need migration 0241 applied; until then only dates and CBN/CBC would be filled.")
  );
}

/** Lots the planned date writes cover (a date group = one guarded update). */
export function datesInPlan(groups: ReadonlyMap<string, readonly string[]>): number {
  let n = 0;
  for (const ids of groups.values()) n += ids.length;
  return n;
}

// --- self-tests ---------------------------------------------------------------------------

export function __runBulkPreviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`bulk-preview-core FAIL: ${name}`);
    }
  };
  const outcomes = { link: 0, "has-lab": 0, destroyed: 0, "no-barcode": 0, "not-on-transfer": 0, ambiguous: 0, "no-lab": 0 };
  const totals = { manifests: 3, attached: 3, noFile: 0, unreadable: 0, errored: 0, linked: 6, created: 2, reused: 1, skippedChanged: 0, outcomes: { ...outcomes }, problems: [] as string[] };

  const done: WciaBackfillRun = { ok: true, done: true, next: null, totals, elapsedMs: 10 };
  const n1 = wciaPreviewNote(done);
  ok(n1.startsWith(PREVIEW_PREFIX), "wcia: says preview first");
  ok(n1.includes("3 Cultivera manifests checked") && n1.includes("would link 6 lots") && n1.includes("would add 2 new lab results") && n1.includes("would reuse 1"), "wcia: counts in would-words");
  ok(n1.includes(PREVIEW_GUARD_NOTE), "wcia: guard note");
  ok(!n1.includes("time limit"), "wcia: done preview has no time-limit line");
  ok(wciaPreviewTone(done) === "info", "wcia: clean = info (never ok: nothing was done)");
  const paused: WciaBackfillRun = { ...done, done: false, next: "x" };
  ok(wciaPreviewNote(paused).includes("Continue preview"), "wcia: paused preview says it is partial");
  const probs: WciaBackfillRun = { ok: true, done: true, next: null, totals: { ...totals, unreadable: 1, problems: ["CV-1: bad json"] }, elapsedMs: 1 };
  ok(wciaPreviewTone(probs) === "warn" && wciaPreviewNote(probs).includes("CV-1: bad json") && wciaPreviewNote(probs).includes("1 with an unreadable file"), "wcia: problems warn + named");
  const probOnly: WciaBackfillRun = { ok: true, done: true, next: null, totals: { ...totals, problems: ["CV-2: a lot could not be linked"] }, elapsedMs: 1 };
  ok(wciaPreviewTone(probOnly) === "warn", "wcia: a problem alone warns");
  const stop: WciaBackfillRun = { ok: false, error: "the Cultivera manifests could not be read (boom)", next: null, totals };
  ok(wciaPreviewTone(stop) === "warn" && wciaPreviewNote(stop).includes("stopped: the Cultivera manifests could not be read"), "wcia: failed read honest");
  const one: WciaBackfillRun = { ...done, totals: { ...totals, manifests: 1, linked: 1, created: 1, reused: 0 } };
  ok(wciaPreviewNote(one).includes("1 Cultivera manifest checked") && wciaPreviewNote(one).includes("would link 1 lot to") && !wciaPreviewNote(one).includes("reuse"), "wcia: singular, no zero reuse");
  const amb: WciaBackfillRun = { ...done, totals: { ...totals, outcomes: { ...outcomes, ambiguous: 2, "has-lab": 4, "no-lab": 1, "not-on-transfer": 2 } } };
  const na = wciaPreviewNote(amb);
  ok(na.includes("2 would be left alone") && na.includes("4 lots already have one (kept)") && na.includes("3 lots have no lab data"), "wcia: outcome lines");
  ok(wciaPreviewNote({ ...done, totals: { ...totals, linked: 1234, manifests: 1 } }).includes("1,234 lots"), "wcia: thousands separator");

  // COA
  const rows: CoaPreviewRow[] = [
    { id: "1", coa_url: "https://certs.conflabs.com/a.pdf" },
    { id: "2", coa_url: "https://certs.conflabs.com/b.pdf" },
    { id: "3", coa_url: "https://files.cultivera.com/https://lab.example.com/c.pdf" },
    { id: "4", coa_url: "http://insecure.example.com/d.pdf" },
    { id: "5", coa_url: "https://127.0.0.1/e.pdf" },
    { id: "6", coa_url: "not a url" },
    { id: "7", coa_url: "  " },
  ];
  const pv = planCoaPreview(rows);
  ok(pv.candidates === 7 && pv.fetchable === 3, "coa: fetchable = the real run's url check");
  ok(pv.bad["not-https"] === 1 && pv.bad["private-host"] === 1 && pv.bad.malformed === 1 && pv.bad.blank === 1, "coa: each bad reason counted");
  ok(pv.hosts[0].host === "certs.conflabs.com" && pv.hosts[0].n === 2 && pv.hosts[1].host === "lab.example.com", "coa: doubled host repaired, hosts ranked");
  const many = planCoaPreview(Array.from({ length: 8 }, (_, i) => ({ id: String(i), coa_url: `https://h${i}.example.com/x.pdf` })));
  ok(many.hosts.length === COA_PREVIEW_HOSTS && many.hosts[0].host === "h0.example.com", "coa: top hosts capped, tie by name");
  const cn = coaPreviewNote({ ok: true, preview: pv, capped: false });
  ok(cn.startsWith(PREVIEW_PREFIX) && cn.includes("7 lab results with a certificate link") && cn.includes("would try to download 3") && cn.includes("would skip 4"), "coa: note counts");
  ok(cn.includes("1 an internal address (never fetched)") && cn.includes("certs.conflabs.com (2)"), "coa: reasons + hosts named");
  ok(coaPreviewTone({ ok: true, preview: pv, capped: false }) === "warn", "coa: bad links warn");
  const clean = planCoaPreview(rows.slice(0, 2));
  ok(coaPreviewTone({ ok: true, preview: clean, capped: false }) === "info" && !coaPreviewNote({ ok: true, preview: clean, capped: false }).includes("would skip"), "coa: clean info, no skip line");
  ok(coaPreviewNote({ ok: true, preview: planCoaPreview([]), capped: false }).includes("Nothing to save"), "coa: nothing to do");
  ok(coaPreviewNote({ ok: true, preview: clean, capped: true }).includes("there are more"), "coa: capped says so");
  ok(coaPreviewNote({ ok: false, error: "the lab results could not be read (x)" }).includes("stopped: the lab results could not be read") && coaPreviewTone({ ok: false, error: "x" }) === "warn", "coa: failed read honest");

  // Facts
  ok(factFillPreviewNote({ matched: 0, datesWould: 0, potencyWould: 0, potencyColumnsPresent: true }).includes("No lot"), "facts: none matched");
  ok(factFillPreviewNote({ matched: 5, datesWould: 0, potencyWould: 0, potencyColumnsPresent: true }).includes("would change nothing"), "facts: all filled");
  const fn = factFillPreviewNote({ matched: 10, datesWould: 4, potencyWould: 7, potencyColumnsPresent: true });
  ok(fn.startsWith(PREVIEW_PREFIX) && fn.includes("Matched 10 lots") && fn.includes("would fill 4 received dates") && fn.includes("on 7 lots") && fn.includes(PREVIEW_GUARD_NOTE) && !fn.includes("0241"), "facts: counts + guard");
  ok(factFillPreviewNote({ matched: 1, datesWould: 1, potencyWould: 0, potencyColumnsPresent: false }).includes("0241"), "facts: missing columns said");
  ok(datesInPlan(new Map([["2026-01-01", ["a", "b"]], ["2026-01-02", ["c"]]])) === 3 && datesInPlan(new Map()) === 0, "facts: dates in plan");
  return { passed, failed };
}
