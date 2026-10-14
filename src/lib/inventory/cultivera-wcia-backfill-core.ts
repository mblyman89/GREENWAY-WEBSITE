/**
 * src/lib/inventory/cultivera-wcia-backfill-core.ts   (R50 S12b)
 *
 * "Attach the vendor's lab results to EVERY Cultivera manifest" in one click.
 *
 * Today the vendor's lab results (the WCIA transfer file Cultivera kept for
 * each transfer, bible §1.5c) are attached only when someone presses Start on
 * ONE rebuilt manifest. With ~700 rebuilt manifests that is ~700 clicks. This
 * backfill walks every rebuilt manifest through the SAME attach
 * (`attachWciaLabResults`: fill-only lab_result_id, never a destroyed lot,
 * never replaces a certificate, exact lab test ids reused, never stock,
 * status, cost, CCRS fields, prices or live cards).
 *
 * Enterprise pattern followed (not invented): a keyset-paginated, resumable,
 * time-boxed batch job (the "checkpoint + resume" shape of Spring Batch /
 * AWS Glue job bookmarks): work in a stable order (manifest id), stop before
 * the request's time limit, hand back the last id finished as the checkpoint,
 * and let "Continue" pick up from there. Re-running from the start is safe:
 * the attach is idempotent (an already-linked lot is "has-lab", kept).
 *
 * Pure: decides the cursor, when to stop, how results add up and the one
 * sentence the page shows. No I/O. Self-tests at the bottom.
 */
import type { WciaAttachResult, WciaLotOutcome } from "@/lib/inventory/cultivera-wcia-core";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Manifests read per page (one small keyset read). */
export const WCIA_BACKFILL_PAGE = 50;
/** Time budget for one click. The drafts page allows 300 s; leave room for the redirect. */
export const WCIA_BACKFILL_BUDGET_MS = 200_000;
/** Never start a manifest with less than this left (one attach measured well under this). */
export const WCIA_BACKFILL_MIN_LEFT_MS = 15_000;
export const WCIA_BACKFILL_AUDIT = "cultivera.wcia_backfill_run";

/** The line beside the button (plain words; what it does and what it never does). */
export const WCIA_BACKFILL_HELP =
  "Reads each vendor's own transfer file kept from Cultivera and links its lab result to lots that have none. " +
  "It never replaces a certificate, never touches stock, price, status or the live menu, and is safe to run again.";

/** A resume cursor from the URL: a manifest uuid (lower-cased) or null = from the start. Anything else = null. */
export function parseBackfillCursor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

/** May another manifest start? Only with at least MIN_LEFT before the budget ends. */
export function canStartNext(elapsedMs: number, budgetMs: number = WCIA_BACKFILL_BUDGET_MS): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return budgetMs - elapsedMs >= WCIA_BACKFILL_MIN_LEFT_MS;
}

export type WciaBackfillTotals = {
  manifests: number;
  attached: number; // manifests whose file was read and planned
  noFile: number; // no transfer id or no stored file (nothing to do, not a problem)
  unreadable: number;
  errored: number;
  linked: number;
  created: number;
  reused: number;
  skippedChanged: number;
  outcomes: Record<WciaLotOutcome, number>;
  /** First few problems, each prefixed with the manifest number. */
  problems: string[];
};

export const WCIA_BACKFILL_MAX_PROBLEMS = 5;

export function emptyBackfillTotals(): WciaBackfillTotals {
  return {
    manifests: 0,
    attached: 0,
    noFile: 0,
    unreadable: 0,
    errored: 0,
    linked: 0,
    created: 0,
    reused: 0,
    skippedChanged: 0,
    outcomes: { link: 0, "has-lab": 0, destroyed: 0, "no-barcode": 0, "not-on-transfer": 0, ambiguous: 0, "no-lab": 0 },
    problems: [],
  };
}

/** Add one manifest's attach result to the totals (returns a new object). */
export function addBackfillResult(t: WciaBackfillTotals, label: string, r: WciaAttachResult): WciaBackfillTotals {
  const out: WciaBackfillTotals = { ...t, outcomes: { ...t.outcomes }, problems: [...t.problems] };
  out.manifests += 1;
  if (r.status === "attached") out.attached += 1;
  else if (r.status === "no-transfer" || r.status === "no-document") out.noFile += 1;
  else if (r.status === "unreadable") out.unreadable += 1;
  else out.errored += 1;
  out.linked += r.linked;
  out.created += r.created;
  out.reused += r.reused;
  out.skippedChanged += r.skippedChanged;
  for (const k of Object.keys(out.outcomes) as WciaLotOutcome[]) out.outcomes[k] += r.outcomes[k] ?? 0;
  for (const e of r.errors) {
    if (out.problems.length >= WCIA_BACKFILL_MAX_PROBLEMS) break;
    out.problems.push(`${label}: ${e}`.slice(0, 200));
  }
  return out;
}

export type WciaBackfillRun =
  | { ok: true; done: boolean; next: string | null; totals: WciaBackfillTotals; elapsedMs: number }
  | { ok: false; error: string; next: string | null; totals: WciaBackfillTotals };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The one sentence the page shows after a click. Honest: an error or a partial run is never "done". */
export function backfillNote(run: WciaBackfillRun): string {
  const t = run.totals;
  const lines = [
    `${plural(t.manifests, "Cultivera manifest")} checked`,
    `${plural(t.linked, "lot")} newly linked to the vendor's lab result`,
    t.created > 0 ? `${plural(t.created, "new lab result")}` : "",
    t.reused > 0 ? `${t.reused} already on file (reused)` : "",
    t.outcomes["has-lab"] > 0 ? `${t.outcomes["has-lab"]} lots already had one (kept)` : "",
    t.outcomes["not-on-transfer"] + t.outcomes["no-lab"] > 0
      ? `${t.outcomes["not-on-transfer"] + t.outcomes["no-lab"]} lots without lab data on their transfer`
      : "",
    t.outcomes.ambiguous > 0 ? `${t.outcomes.ambiguous} left alone (two different lab results on one transfer)` : "",
    t.noFile > 0 ? `${plural(t.noFile, "manifest")} without a vendor file` : "",
    t.unreadable > 0 ? `${t.unreadable} with an unreadable file` : "",
    t.skippedChanged > 0 ? `${t.skippedChanged} changed meanwhile (not touched)` : "",
  ].filter(Boolean);
  const probs = t.problems.length > 0 ? ` Problems: ${t.problems.slice(0, 3).join("; ")}.` : "";
  if (!run.ok) return `Stopped: ${run.error}. So far: ${lines.join(", ")}.${probs} Press Continue to resume.`;
  const head = run.done ? "Done - every Cultivera manifest was checked" : "Paused at the time limit";
  const tail = run.done ? "" : " Press Continue to carry on from where it stopped.";
  return `${head}: ${lines.join(", ")}.${probs}${tail}`;
}

/** Tone for the banner: problems or a stop = warn; paused = info; done clean = ok. */
export function backfillTone(run: WciaBackfillRun): "ok" | "info" | "warn" {
  if (!run.ok) return "warn";
  if (run.totals.errored > 0 || run.totals.unreadable > 0 || run.totals.problems.length > 0) return "warn";
  return run.done ? "ok" : "info";
}

// --- self-tests --------------------------------------------------------------------

export function __runCultiveraWciaBackfillCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL cultivera-wcia-backfill-core: " + m);
    passed += 1;
  };
  const U = "0F8FAD5B-D9CB-469F-A165-70867728950E";
  const res = (status: WciaAttachResult["status"], extra: Partial<WciaAttachResult> = {}): WciaAttachResult => ({
    status,
    linked: 0,
    created: 0,
    reused: 0,
    skippedChanged: 0,
    outcomes: { link: 0, "has-lab": 0, destroyed: 0, "no-barcode": 0, "not-on-transfer": 0, ambiguous: 0, "no-lab": 0 },
    errors: [],
    ...extra,
  });

  // Cursor.
  ok(parseBackfillCursor(U) === U.toLowerCase(), "cursor lower-cased");
  ok(parseBackfillCursor(` ${U} `) === U.toLowerCase(), "cursor trimmed");
  ok(parseBackfillCursor("") === null && parseBackfillCursor(null) === null && parseBackfillCursor(5) === null, "blank cursor = start");
  ok(parseBackfillCursor("x' or 1=1") === null && parseBackfillCursor(`${U}x`) === null, "unsafe cursor refused");

  // Budget.
  ok(canStartNext(0) === true, "fresh run may start");
  ok(canStartNext(WCIA_BACKFILL_BUDGET_MS - WCIA_BACKFILL_MIN_LEFT_MS) === true, "exactly MIN_LEFT left may start");
  ok(canStartNext(WCIA_BACKFILL_BUDGET_MS - WCIA_BACKFILL_MIN_LEFT_MS + 1) === false, "less than MIN_LEFT stops");
  ok(canStartNext(-1) === false && canStartNext(NaN) === false, "bad clock stops");
  ok(canStartNext(10, 15_009) === false && canStartNext(10, 15_010) === true, "custom budget boundary");

  // Totals.
  let t = emptyBackfillTotals();
  t = addBackfillResult(t, "CV-1", res("attached", { linked: 3, created: 2, reused: 1, outcomes: { ...res("attached").outcomes, link: 3, "has-lab": 2 } }));
  t = addBackfillResult(t, "CV-2", res("no-document"));
  t = addBackfillResult(t, "CV-3", res("no-transfer"));
  t = addBackfillResult(t, "CV-4", res("unreadable", { errors: ["vendor transfer file: bad json"] }));
  t = addBackfillResult(t, "CV-5", res("error", { errors: ["lab results could not be read: timeout"] }));
  ok(t.manifests === 5 && t.attached === 1 && t.noFile === 2 && t.unreadable === 1 && t.errored === 1, "status buckets");
  ok(t.linked === 3 && t.created === 2 && t.reused === 1, "sums");
  ok(t.outcomes.link === 3 && t.outcomes["has-lab"] === 2, "outcome sums");
  ok(t.problems[0] === "CV-4: vendor transfer file: bad json" && t.problems.length === 2, "problems labelled");
  const before = emptyBackfillTotals();
  addBackfillResult(before, "X", res("attached", { linked: 9 }));
  ok(before.linked === 0 && before.manifests === 0, "add is pure (input not mutated)");
  let many = emptyBackfillTotals();
  for (let i = 0; i < 9; i++) many = addBackfillResult(many, `M${i}`, res("error", { errors: ["a", "b"] }));
  ok(many.problems.length === WCIA_BACKFILL_MAX_PROBLEMS, "problems capped");

  // Note + tone.
  const done = backfillNote({ ok: true, done: true, next: null, totals: t, elapsedMs: 5 });
  ok(done.startsWith("Done - every Cultivera manifest was checked: 5 Cultivera manifests checked, 3 lots newly linked"), "done note");
  ok(done.includes("2 new lab results") && done.includes("1 already on file") && done.includes("2 manifests without a vendor file"), "done details");
  ok(done.includes("Problems: CV-4"), "problems shown");
  const paused = backfillNote({ ok: true, done: false, next: U, totals: emptyBackfillTotals(), elapsedMs: 5 });
  ok(paused.startsWith("Paused at the time limit") && paused.endsWith("carry on from where it stopped."), "paused note");
  const stopped = backfillNote({ ok: false, error: "the manifests could not be read", next: U, totals: emptyBackfillTotals() });
  ok(stopped.startsWith("Stopped: the manifests could not be read.") && stopped.endsWith("Press Continue to resume."), "stopped note");
  ok(!stopped.startsWith("Done") && !paused.startsWith("Done"), "never 'Done' unless done");
  ok(backfillTone({ ok: true, done: true, next: null, totals: emptyBackfillTotals(), elapsedMs: 1 }) === "ok", "clean done = ok");
  ok(backfillTone({ ok: true, done: false, next: U, totals: emptyBackfillTotals(), elapsedMs: 1 }) === "info", "paused = info");
  ok(backfillTone({ ok: true, done: true, next: null, totals: t, elapsedMs: 1 }) === "warn", "done with problems = warn");
  ok(backfillTone({ ok: false, error: "x", next: null, totals: emptyBackfillTotals() }) === "warn", "stopped = warn");
  ok(/never replaces a certificate/.test(WCIA_BACKFILL_HELP) && /safe to run again/.test(WCIA_BACKFILL_HELP), "help copy");
  ok(plural(1, "lot") === "1 lot" && plural(2, "lot") === "2 lots", "plural");

  return { passed, failed: 0 };
}
