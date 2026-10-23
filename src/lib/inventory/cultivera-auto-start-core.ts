/**
 * src/lib/inventory/cultivera-auto-start-core.ts   (R74 S13, round 8)
 *
 * Owner (round 1): "the new manifests we recreate from the originals need to
 * move automatically into onboarding, every manifest should be seen and
 * workable on the onboarding page."  Owner (round 8): "Please begin working on
 * the four remaining pieces to build" - piece 1: start rebuilt manifests
 * automatically.
 *
 * PURE. What the automatic Start decides. The Start itself is the SAME
 * per-manifest Start every button runs (startCultiveraManifestOnboarding:
 * vendor lab results, onboarding rows, certificate archive + read, KB
 * write-back + link, lab facts, Cultivera potency fact). This file only
 * decides WHEN and ON WHICH manifests:
 *
 *   armAutoStart          Apply rebuild / Apply the email step succeeded for
 *                         an import -> queue a fresh pass over that import's
 *                         rebuilt manifests (a new generation)
 *   pauseAutoStart        the owner pressed Pause -> a running pass stops
 *                         after the manifest it is on (generation changes)
 *   autoStartDecision     idle (nothing armed / paused / pass finished),
 *                         leased (another run holds it), or go
 *   takeAutoStartLease    the run's lease (token + expiry); a run killed
 *                         mid-way is overtaken when the lease expires
 *   pickAutoStartTargets  manifests with NO onboarding row yet (not
 *                         started), uuid order, after the pass cursor - so a
 *                         manifest that seeds nothing (every product already
 *                         has a row elsewhere) is passed once, never looped
 *   recordAutoStartOutcome / finishAutoStartPass / releaseAutoStartLease
 *   autoStartStatus       the one sentence on the rebuild / coverage pages
 *
 * The state lives in ONE site_settings row (key AUTO_START_KEY); every write
 * is a compare-and-swap on the row's updated_at (the store), so two runs, or a
 * run and a button press, never overwrite each other.
 *
 * Fail loud, never guess: an unreadable state is reported (never "nothing to
 * do"), a failed Start is counted and named, and a pass whose onboarding
 * counts cannot be read does not run (it never re-runs everything blind).
 *
 * No I/O. Self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */
import { VENDOR_START_BUDGET_MS } from "@/lib/inventory/cultivera-vendor-core";

export const AUTO_START_KEY = "cultivera_auto_start";
export const AUTO_START_LABEL = "Cultivera rebuilt manifests: automatic onboarding start (R74 S13)";
export const AUTO_START_AUDIT = {
  armed: "cultivera_onboarding.auto_start_armed",
  paused: "cultivera_onboarding.auto_start_paused",
  ran: "cultivera_onboarding.auto_started",
} as const;

/** The every-minute worker's share when it has nothing else to do (its route allows 800 s). */
export const AUTO_START_CRON_BUDGET_MS = 600_000;
/** A button press (the pages allow 300 s): the same budget as the by-vendor Start. */
export const AUTO_START_PRESS_BUDGET_MS = VENDOR_START_BUDGET_MS;
/** The lease outlives the budget by this much (one Start can take ~60-100 s). */
export const AUTO_START_LEASE_SLACK_MS = 150_000;
export const AUTO_START_MAX_ERRORS = 20;
export const AUTO_START_MAX_IMPORTS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AutoStartState = {
  v: 1;
  /** Bumped by every arm / pause: a run that sees a new generation stops. */
  generation: number;
  importIds: string[];
  armedAt: string | null;
  armedBy: string | null;
  paused: boolean;
  /** Last manifest id the pass finished (uuid, lower case), or null = from the start. */
  cursor: string | null;
  started: number;
  seeded: number;
  failed: number;
  errors: string[];
  done: boolean;
  lastRunAt: string | null;
  lastNote: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
};

export function emptyAutoStartState(): AutoStartState {
  return {
    v: 1,
    generation: 0,
    importIds: [],
    armedAt: null,
    armedBy: null,
    paused: false,
    cursor: null,
    started: 0,
    seeded: 0,
    failed: 0,
    errors: [],
    done: false,
    lastRunAt: null,
    lastNote: null,
    leaseToken: null,
    leaseUntil: null,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The saved row's value -> a state. Anything malformed falls back to the safe default field by field. */
export function parseAutoStartState(raw: unknown): AutoStartState {
  const e = emptyAutoStartState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e;
  const r = raw as Record<string, unknown>;
  const ids = Array.isArray(r.importIds) ? r.importIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).map((x) => x.toLowerCase()) : [];
  const cursor = str(r.cursor);
  return {
    v: 1,
    generation: nat(r.generation),
    importIds: [...new Set(ids)].slice(0, AUTO_START_MAX_IMPORTS),
    armedAt: str(r.armedAt),
    armedBy: str(r.armedBy),
    paused: r.paused === true,
    cursor: cursor && UUID_RE.test(cursor) ? cursor.toLowerCase() : null,
    started: nat(r.started),
    seeded: nat(r.seeded),
    failed: nat(r.failed),
    errors: Array.isArray(r.errors) ? r.errors.filter((x): x is string => typeof x === "string").slice(0, AUTO_START_MAX_ERRORS) : [],
    done: r.done === true,
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
  };
}

/**
 * Queue a fresh pass that includes this import. The pass restarts from the
 * beginning (already-started manifests are skipped by the target rule, so
 * nothing is redone); counters start again; a running pass stops at its next
 * manifest because the generation changed. The lease is kept as it is.
 */
export function armAutoStart(s: AutoStartState, importId: string, actorId: string | null, nowIso: string): AutoStartState {
  if (!UUID_RE.test(importId)) throw new Error("armAutoStart: the import id is not a uuid");
  const id = importId.toLowerCase();
  const importIds = [id, ...s.importIds.filter((x) => x !== id)].slice(0, AUTO_START_MAX_IMPORTS);
  return {
    ...s,
    generation: s.generation + 1,
    importIds,
    armedAt: nowIso,
    armedBy: actorId,
    paused: false,
    cursor: null,
    started: 0,
    seeded: 0,
    failed: 0,
    errors: [],
    done: false,
    lastNote: null,
  };
}

export function pauseAutoStart(s: AutoStartState): AutoStartState {
  return { ...s, generation: s.generation + 1, paused: true };
}

export type AutoStartDecision = "idle" | "paused" | "finished" | "leased" | "go";

export function leaseLive(s: Pick<AutoStartState, "leaseToken" | "leaseUntil">, nowMs: number): boolean {
  if (!s.leaseToken || !s.leaseUntil) return false;
  const until = Date.parse(s.leaseUntil);
  return Number.isFinite(until) && until > nowMs;
}

export function autoStartDecision(s: AutoStartState, nowMs: number): AutoStartDecision {
  if (s.importIds.length === 0) return "idle";
  if (s.paused) return "paused";
  if (s.done) return "finished";
  if (leaseLive(s, nowMs)) return "leased";
  return "go";
}

export function takeAutoStartLease(s: AutoStartState, token: string, nowMs: number, budgetMs: number): AutoStartState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + budgetMs + AUTO_START_LEASE_SLACK_MS).toISOString() };
}

export function releaseAutoStartLease(s: AutoStartState, token: string): AutoStartState {
  return s.leaseToken === token ? { ...s, leaseToken: null, leaseUntil: null } : s;
}

/** Does this run still own the pass it started (same lease, same generation)? */
export function ownsPass(s: AutoStartState, token: string, generation: number): boolean {
  return s.leaseToken === token && s.generation === generation;
}

/**
 * The manifests a pass works: rebuilt manifests of the armed imports that have
 * NO onboarding row yet (not started), uuid order, after the cursor. A
 * manifest already started (by hand, by vendor, or by an earlier pass) is
 * skipped - Start would only redo its certificate reads.
 */
export function pickAutoStartTargets(rows: readonly { id: string; drafts: number }[], cursor: string | null): string[] {
  const after = cursor ? cursor.toLowerCase() : null;
  return rows
    .filter((r) => typeof r.id === "string" && UUID_RE.test(r.id) && r.drafts === 0)
    .map((r) => r.id.toLowerCase())
    .filter((id, i, all) => all.indexOf(id) === i)
    .sort()
    .filter((id) => after === null || id > after);
}

export type AutoStartOutcome = { ok: true; seeded: number } | { ok: false; error: string };

export function recordAutoStartOutcome(s: AutoStartState, manifestId: string, outcome: AutoStartOutcome, label: string): AutoStartState {
  const next: AutoStartState = { ...s, cursor: manifestId.toLowerCase() };
  if (outcome.ok) {
    next.started = s.started + 1;
    next.seeded = s.seeded + nat(outcome.seeded);
  } else {
    next.failed = s.failed + 1;
    next.errors = [...s.errors, `${label}: ${outcome.error}`.slice(0, 200)].slice(-AUTO_START_MAX_ERRORS);
  }
  return next;
}

export function finishAutoStartPass(s: AutoStartState, remaining: number, nowIso: string, note: string): AutoStartState {
  return { ...s, done: remaining === 0, lastRunAt: nowIso, lastNote: note.slice(0, 400) };
}

export type AutoStartRun = {
  ran: number;
  started: number;
  seeded: number;
  failed: number;
  remaining: number;
  stoppedBy: "done" | "budget" | "paused_or_rearmed" | "lost_lease" | null;
};

export function autoStartRunNote(r: AutoStartRun): string {
  if (r.ran === 0 && r.remaining === 0) return "Every rebuilt manifest already has its onboarding rows. Nothing to start.";
  const head = `Started ${r.started} rebuilt manifest${r.started === 1 ? "" : "s"} (${r.seeded} new onboarding row${r.seeded === 1 ? "" : "s"})`;
  const fail = r.failed > 0 ? `; ${r.failed} could not start (listed below)` : "";
  const tail =
    r.stoppedBy === "paused_or_rearmed"
      ? ". Stopped: the automatic start was paused or queued again."
      : r.stoppedBy === "lost_lease"
        ? ". Stopped: another run took over."
        : r.remaining === 0
          ? ". Every rebuilt manifest has now been started."
          : `. ${r.remaining} left: the every-minute worker carries on by itself.`;
  return `${head}${fail}${tail}`;
}

export type AutoStartTone = "good" | "warn" | "bad" | "muted";

/**
 * The status sentence for one import. `remaining` = not-started manifests of
 * THIS import (null = could not be read: said so, never 0).
 */
export function autoStartStatus(
  s: AutoStartState,
  importId: string,
  remaining: number | null,
  nowMs: number,
): { tone: AutoStartTone; text: string; armed: boolean; running: boolean } {
  const armed = s.importIds.includes(importId.toLowerCase());
  const running = armed && leaseLive(s, nowMs);
  const left = remaining === null ? "an unknown number of (the onboarding counts could not be read)" : String(remaining);
  if (!armed) {
    if (remaining === 0) return { tone: "good", text: "Every rebuilt manifest of this import has its onboarding rows.", armed, running };
    return {
      tone: "muted",
      text: `Automatic start is not queued for this import. ${left} rebuilt manifest(s) have no onboarding rows yet. It queues itself after Apply rebuild or Apply the email step, or press Start onboarding below.`,
      armed,
      running,
    };
  }
  const counts = `${s.started} started, ${s.seeded} new onboarding row(s)${s.failed > 0 ? `, ${s.failed} could not start` : ""}`;
  if (s.paused) return { tone: "warn", text: `Automatic start is paused (${counts}). ${left} not started yet. Press Start again to resume.`, armed, running };
  if (s.done) {
    return remaining === 0
      ? { tone: s.failed > 0 ? "warn" : "good", text: `Automatic start finished: ${counts}. Every rebuilt manifest has its onboarding rows.`, armed, running }
      : { tone: "warn", text: `Automatic start finished its pass (${counts}), but ${left} manifest(s) still have no onboarding rows (a Start failed or seeded nothing). Press Start again for another pass.`, armed, running };
  }
  return {
    tone: s.failed > 0 ? "warn" : "good",
    text: `${running ? "Starting now" : "Queued"}: ${counts}; ${left} left. The every-minute worker keeps going after you close this page.`,
    armed,
    running,
  };
}

export type AutoStartPage = "manifests" | "coverage";

/** Which page the buttons return to (anything else = the rebuild page). */
export function autoStartReturnPage(v: unknown): AutoStartPage {
  return v === "coverage" ? "coverage" : "manifests";
}

/** The rebuild / coverage page with the result banner (done / error). */
export function autoStartHref(importId: string, page: AutoStartPage, q: { done?: string; error?: string } = {}): string {
  const base = `/admin/menu-imports/${encodeURIComponent(importId)}/${page}`;
  const p = new URLSearchParams();
  if (q.done) p.set("done", q.done.slice(0, 700));
  if (q.error) p.set("error", q.error.slice(0, 700));
  const s = p.toString();
  return `${s ? `${base}?${s}` : base}#auto-start`;
}

export function __runCultiveraAutoStartCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-auto-start-core: " + m);
    }
  };
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "bbbbbbbb-0000-4000-8000-000000000002";
  const M1 = "10000000-0000-4000-8000-000000000001";
  const M2 = "20000000-0000-4000-8000-000000000002";
  const M3 = "30000000-0000-4000-8000-000000000003";
  const NOW = Date.parse("2026-10-25T12:00:00Z");

  // parse
  const e = parseAutoStartState(null);
  ok(e.importIds.length === 0 && e.generation === 0 && !e.done && !e.paused, "null = empty state");
  ok(parseAutoStartState([1, 2]).importIds.length === 0 && parseAutoStartState("x").generation === 0, "array / string = empty");
  const p = parseAutoStartState({ generation: 3.7, importIds: [A, "nope", A.toUpperCase(), B], cursor: "bad", started: -1, failed: 2, errors: ["x", 5], paused: "yes", done: true });
  ok(p.generation === 3 && p.importIds.join(",") === `${A},${B}`, "ids kept as lower-case uuids, deduped; generation floored");
  ok(p.cursor === null && p.started === 0 && p.failed === 2 && p.errors.join() === "x", "bad cursor dropped, negatives = 0, non-string errors dropped");
  ok(p.paused === false && p.done === true, "only literal true counts");
  ok(parseAutoStartState({ cursor: M2.toUpperCase() }).cursor === M2, "cursor lower-cased");

  // arm
  const a1 = armAutoStart(e, A, "u1", "2026-10-25T11:00:00Z");
  ok(a1.importIds.join() === A && a1.generation === 1 && a1.armedBy === "u1" && !a1.done && a1.cursor === null, "arm queues the import, new generation");
  const mid = { ...a1, cursor: M2, started: 4, failed: 1, errors: ["e"], done: true, paused: true, leaseToken: "t", leaseUntil: "2026-10-25T12:05:00Z" };
  const a2 = armAutoStart(mid, B, "u2", "2026-10-25T11:30:00Z");
  ok(a2.importIds.join() === `${B},${A}` && a2.generation === 2, "second import first, first kept");
  ok(a2.cursor === null && a2.started === 0 && a2.failed === 0 && a2.errors.length === 0 && !a2.done && !a2.paused, "re-arm restarts the pass and un-pauses");
  ok(a2.leaseToken === "t" && a2.leaseUntil === mid.leaseUntil, "arm never touches the lease");
  ok(armAutoStart(a2, A.toUpperCase(), null, "x").importIds.join() === `${A},${B}`, "re-arming an import moves it first, no duplicate");
  let threw = false;
  try {
    armAutoStart(e, "not-a-uuid", null, "x");
  } catch {
    threw = true;
  }
  ok(threw, "arm refuses a non-uuid import id");
  let many = e;
  for (let i = 0; i < 25; i += 1) many = armAutoStart(many, `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, null, "x");
  ok(many.importIds.length === AUTO_START_MAX_IMPORTS, "at most 20 imports kept");

  // pause
  const pz = pauseAutoStart(a1);
  ok(pz.paused && pz.generation === a1.generation + 1, "pause bumps the generation");

  // decision
  ok(autoStartDecision(e, NOW) === "idle", "nothing armed = idle");
  ok(autoStartDecision(pz, NOW) === "paused", "paused");
  ok(autoStartDecision({ ...a1, done: true }, NOW) === "finished", "finished");
  ok(autoStartDecision({ ...a1, leaseToken: "t", leaseUntil: new Date(NOW + 1000).toISOString() }, NOW) === "leased", "live lease = leased");
  ok(autoStartDecision({ ...a1, leaseToken: "t", leaseUntil: new Date(NOW - 1).toISOString() }, NOW) === "go", "expired lease = go (a killed run is overtaken)");
  ok(autoStartDecision({ ...a1, leaseToken: null, leaseUntil: new Date(NOW + 1000).toISOString() }, NOW) === "go", "expiry without a token = go");
  ok(autoStartDecision({ ...a1, leaseToken: "t", leaseUntil: "garbage" }, NOW) === "go", "unreadable expiry = go");
  ok(autoStartDecision(a1, NOW) === "go", "armed = go");

  // lease
  const L = takeAutoStartLease(a1, "tok", NOW, 600_000);
  ok(L.leaseToken === "tok" && Date.parse(L.leaseUntil!) === NOW + 600_000 + AUTO_START_LEASE_SLACK_MS, "lease = budget + slack");
  ok(ownsPass(L, "tok", L.generation) && !ownsPass(L, "other", L.generation) && !ownsPass(armAutoStart(L, B, null, "x"), "tok", L.generation), "owns = same token and generation");
  ok(releaseAutoStartLease(L, "tok").leaseToken === null && releaseAutoStartLease(L, "tok").leaseUntil === null, "release by owner");
  ok(releaseAutoStartLease(L, "other").leaseToken === "tok", "release by someone else changes nothing");

  // targets
  const rows = [
    { id: M3, drafts: 0 },
    { id: M1, drafts: 0 },
    { id: M2, drafts: 4 },
    { id: "nope", drafts: 0 },
    { id: M1.toUpperCase(), drafts: 0 },
  ];
  ok(pickAutoStartTargets(rows, null).join() === `${M1},${M3}`, "not-started only, uuid order, deduped, bad ids dropped");
  ok(pickAutoStartTargets(rows, M1).join() === M3, "after the cursor");
  ok(pickAutoStartTargets(rows, M3).length === 0, "pass over");
  ok(pickAutoStartTargets(rows, M1.toUpperCase()).join() === M3, "cursor compared lower-case");

  // outcomes
  const o1 = recordAutoStartOutcome(L, M1.toUpperCase(), { ok: true, seeded: 5 }, "CV-1");
  ok(o1.cursor === M1 && o1.started === 1 && o1.seeded === 5 && o1.failed === 0, "success advances cursor + counts");
  const o2 = recordAutoStartOutcome(o1, M3, { ok: false, error: "boom" }, "CV-3");
  ok(o2.cursor === M3 && o2.failed === 1 && o2.errors[0] === "CV-3: boom" && o2.started === 1, "failure advances cursor (passed once) and is named");
  let er = o2;
  for (let i = 0; i < 30; i += 1) er = recordAutoStartOutcome(er, M3, { ok: false, error: `e${i}` }, "X");
  ok(er.errors.length === AUTO_START_MAX_ERRORS && er.errors[er.errors.length - 1] === "X: e29", "errors capped, newest kept");
  ok(recordAutoStartOutcome(L, M1, { ok: true, seeded: -3 }, "x").seeded === 0, "negative seeded = 0");
  const f0 = finishAutoStartPass(o2, 0, "2026-10-25T12:03:00Z", "n");
  const f1 = finishAutoStartPass(o2, 2, "2026-10-25T12:03:00Z", "n");
  ok(f0.done && !f1.done && f0.lastRunAt === "2026-10-25T12:03:00Z" && f0.lastNote === "n", "finished only when nothing remains");

  // notes
  const n = (x: Partial<AutoStartRun>) => autoStartRunNote({ ran: 0, started: 0, seeded: 0, failed: 0, remaining: 0, stoppedBy: null, ...x });
  ok(n({}).includes("Nothing to start"), "nothing note");
  ok(n({ ran: 2, started: 2, seeded: 9, remaining: 0, stoppedBy: "done" }).includes("Every rebuilt manifest has now been started"), "done note");
  ok(n({ ran: 1, started: 1, seeded: 1, remaining: 7, stoppedBy: "budget" }).includes("7 left"), "budget note");
  ok(n({ ran: 1, started: 0, failed: 1, remaining: 3, stoppedBy: "budget" }).includes("1 could not start"), "failure note");
  ok(n({ ran: 1, started: 1, remaining: 3, stoppedBy: "paused_or_rearmed" }).includes("paused or queued again"), "paused note");
  ok(n({ ran: 1, started: 1, remaining: 3, stoppedBy: "lost_lease" }).includes("another run"), "lost lease note");
  ok(n({ ran: 1, started: 1, seeded: 1, remaining: 2 }).startsWith("Started 1 rebuilt manifest (1 new onboarding row)"), "singular wording");

  // status
  const st = (s: AutoStartState, rem: number | null) => autoStartStatus(s, A, rem, NOW);
  ok(st(e, 0).tone === "good" && !st(e, 0).armed, "not armed, all started = good");
  ok(st(e, 5).tone === "muted" && st(e, 5).text.includes("5 rebuilt manifest(s)"), "not armed, some left = muted with count");
  ok(st(e, null).text.includes("could not be read"), "unknown remaining said so, never 0");
  ok(st(pz, 3).tone === "warn" && st(pz, 3).text.includes("paused"), "paused");
  ok(st({ ...a1, done: true }, 0).tone === "good" && st({ ...a1, done: true, failed: 1 }, 0).tone === "warn", "finished good / warn with failures");
  ok(st({ ...a1, done: true }, 2).text.includes("Start again"), "finished with leftovers asks for another pass");
  ok(st(L, 4).running && st(L, 4).text.startsWith("Starting now"), "running");
  ok(!st(a1, 4).running && st(a1, 4).text.startsWith("Queued"), "queued");
  ok(autoStartStatus(a1, B, 4, NOW).armed === false, "armed is per import");
  ok(autoStartStatus(a1, A.toUpperCase(), 4, NOW).armed === true, "import compared lower-case");
  // hrefs
  ok(autoStartReturnPage("coverage") === "coverage" && autoStartReturnPage("x") === "manifests" && autoStartReturnPage(null) === "manifests", "return page");
  ok(autoStartHref(A, "coverage", { done: "a b" }) === `/admin/menu-imports/${A}/coverage?done=a+b#auto-start`, "href with done");
  ok(autoStartHref(A, "manifests") === `/admin/menu-imports/${A}/manifests#auto-start`, "bare href");
  ok(autoStartHref(A, "manifests", { error: "x".repeat(900) }).length < 800, "banner text capped");
  ok(AUTO_START_PRESS_BUDGET_MS === 200_000 && AUTO_START_CRON_BUDGET_MS + AUTO_START_LEASE_SLACK_MS < 800_000, "budgets fit the 300 s page and the 800 s worker");

  return { passed, failed };
}
