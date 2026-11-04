/**
 * src/lib/ai/onboarding-batch-send-core.ts  (R74 S53)
 *
 * Owner (Round 34): "when on onboarding and I start a batch lookup, I need it
 * to get sent to google automatically, then it needs to auto update the
 * counter in the Gemini box on onboarding with an estimated time to
 * completion and such. I want these two pieces connected better."
 *
 * PURE (no I/O, no process.env, no clock - `nowMs` is passed in). The server
 * half is onboarding-batch-send-server.ts. Four jobs:
 *
 *   1. autoSendControl  - the Mission Control switch a press on Product
 *      Onboarding writes: resume, release this delivery's hold, put its job
 *      first in line, and (manual mode) allow exactly the batches it needs.
 *      Nothing else changes: Automatic stays Automatic, the cap stays the cap.
 *   2. onboardingBatchStage - where THIS delivery's lookup is right now
 *      (queued -> sent -> Google searching -> saving facts -> done), the
 *      products counter, an honest time to finish and how often the box
 *      re-reads itself.
 *   3. planOnboardingAttach - the confidence screen's three attach buttons,
 *      for one delivery, WITH the strain type (owner: "I want it to actually
 *      attach strain types too if it finds them"). A person's strain pick is
 *      never replaced; a contradiction between sources is never guessed.
 *   4. the plain-English copy (header, vendor button, result banners).
 */
import { BATCH_MAX_FAMILIES } from "@/lib/ai/gemini-batch-core";
import { MAX_BUDGET, batchEtaMin, type BatchControl } from "@/lib/ai/batch-console-core";
import { clockWords, durationWords } from "@/lib/catalog/lookup-progress-core";
import { CULTIVERA_AUTO_ATTACH_MIN, strainForApproval, type AttachMode, type ProductScore, type ScoredValue } from "@/lib/catalog/cultivera-confidence-core";

export const ONBOARDING_SEND_AUDIT = "ai_batch.onboarding_sent";
export const ONBOARDING_VENDOR_AUDIT = "ai_batch.onboarding_vendor_lookup";
export const ONBOARDING_ATTACH_AUDIT = "catalog.onboarding_confidence_attach";
/** Minutes from "Google finished" to "facts saved on the rows" (the every-minute saver). */
export const SAVE_MINUTES = 3;
/** Most deliveries one vendor press queues (each is one job; the rest wait for the next press). */
export const VENDOR_MAX_MANIFESTS = 60;
/** How many jobs stay "first in line" at once (newest presses first). */
export const PRIORITY_MAX = 20;
/** The query parameter that carries a result back to Product Onboarding. */
export const OBL_PARAM = "obl";

// ─── 1. the switch ──────────────────────────────────────────────────────────

/** Upper bound on the batches a set of products needs (lots that share a product family share a question). */
export function batchesFor(items: number): number {
  const n = Math.max(0, Math.floor(Number(items) || 0));
  return n === 0 ? 0 : Math.ceil(n / BATCH_MAX_FAMILIES);
}

export type AutoSendPlan = {
  next: BatchControl;
  /** False = nothing to send (the switch is left exactly as it was). */
  changed: boolean;
  resumed: boolean;
  released: number;
  budgetAdded: number;
  sentence: string;
};

export function autoSendControl(cur: BatchControl, input: { jobIds: readonly string[]; unsentItems: number }): AutoSendPlan {
  const ids = [...new Set(input.jobIds.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()))];
  const need = batchesFor(input.unsentItems);
  if (ids.length === 0 || need === 0) {
    return { next: cur, changed: false, resumed: false, released: 0, budgetAdded: 0, sentence: "Nothing is waiting to go to Google for this lookup." };
  }
  const want = new Set(ids);
  const pausedJobIds = cur.pausedJobIds.filter((j) => !want.has(j.toLowerCase()));
  const released = cur.pausedJobIds.length - pausedJobIds.length;
  const priorityJobIds = [...ids, ...cur.priorityJobIds.filter((j) => !want.has(j.toLowerCase()))].slice(0, PRIORITY_MAX);
  const budget = cur.mode === "manual" ? Math.min(MAX_BUDGET, cur.budget + need) : cur.budget;
  const budgetAdded = budget - cur.budget;
  const next: BatchControl = { ...cur, paused: false, pausedJobIds, priorityJobIds, budget, note: cur.paused ? null : cur.note };
  const parts = [
    `${input.unsentItems} product${input.unsentItems === 1 ? "" : "s"} put first in line for Google`,
    cur.mode === "manual" ? `${budgetAdded} batch${budgetAdded === 1 ? "" : "es"} allowed (One at a time mode)` : "Automatic mode sends it by itself",
  ];
  if (cur.paused) parts.push("the engine was paused and has been resumed by this press");
  if (released) parts.push("this delivery's hold was released");
  return { next, changed: true, resumed: cur.paused, released, budgetAdded, sentence: `${parts.join("; ")}.` };
}

// ─── 2. the stage ───────────────────────────────────────────────────────────

export type StageKey = "waiting" | "sending" | "google" | "saving" | "done";
export const STAGE_STEPS: readonly { key: StageKey; label: string }[] = [
  { key: "waiting", label: "Queued" },
  { key: "sending", label: "Sent to Google" },
  { key: "google", label: "Google is searching" },
  { key: "saving", label: "Saving facts" },
  { key: "done", label: "Done" },
];

export type StageCounts = { total: number; unsent: number; inBatch: number; done: number; failed: number; canceled: number };
export type StageBatch = { state: string; created_at: string; submitted_at: string | null };
export type StageHold = "paused" | "no_budget" | "held_job" | null;

export type OnboardingStage = {
  key: StageKey;
  steps: { key: StageKey; label: string; state: "done" | "current" | "todo" }[];
  headline: string;
  detail: string;
  counter: string;
  percent: number;
  etaMin: number | null;
  etaLine: string | null;
  finishAt: string | null;
  refreshMs: number;
  hold: StageHold;
  /** True while something is still moving (the box keeps re-reading itself). */
  active: boolean;
};

const ORDER: Record<StageKey, number> = { waiting: 0, sending: 1, google: 2, saving: 3, done: 4 };

function batchStage(state: string): StageKey | null {
  if (state === "submitting") return "sending";
  if (state === "pending" || state === "running") return "google";
  if (state === "succeeded" || state === "ingesting") return "saving";
  return null;
}

export function onboardingBatchStage(input: {
  counts: StageCounts;
  batches: readonly StageBatch[];
  control: Pick<BatchControl, "paused" | "mode" | "budget" | "pausedJobIds">;
  jobId: string;
  jobOpen: boolean;
  turnaroundMin: number;
  measured: boolean;
  nowMs: number;
  timeZone?: string;
}): OnboardingStage {
  const c = input.counts;
  const tz = input.timeZone ?? "America/Los_Angeles";
  const settled = c.done + c.failed + c.canceled;
  const total = Math.max(0, c.total);
  const percent = total === 0 ? 100 : settled >= total ? 100 : Math.min(99, Math.floor((settled / total) * 100));
  const counter = `${settled} of ${total} product${total === 1 ? "" : "s"} finished${c.inBatch ? ` \u00b7 ${c.inBatch} at Google` : ""}${c.unsent ? ` \u00b7 ${c.unsent} waiting to be sent` : ""}${c.failed ? ` \u00b7 ${c.failed} could not be looked up` : ""}`;
  // The earliest stage any of this delivery's work is still in.
  let key: StageKey = "done";
  if (c.unsent > 0 && input.jobOpen) key = "waiting";
  for (const b of input.batches) {
    const s = batchStage(b.state);
    if (s && ORDER[s] < ORDER[key]) key = s;
  }
  if (key === "done" && c.inBatch > 0 && input.jobOpen) key = "saving";
  const held = input.control.pausedJobIds.some((j) => j.toLowerCase() === input.jobId.toLowerCase());
  const hold: StageHold =
    key !== "waiting" ? null : input.control.paused ? "paused" : held ? "held_job" : input.control.mode === "manual" && input.control.budget <= 0 && !input.batches.some((b) => batchStage(b.state) === "sending") ? "no_budget" : null;

  // Time left: the slowest piece still moving.
  const turn = Math.max(5, Math.round(input.turnaroundMin));
  let eta: number | null = 0;
  if (hold) eta = null;
  else {
    if (c.unsent > 0 && input.jobOpen) eta = Math.max(eta ?? 0, batchesFor(c.unsent) + turn + SAVE_MINUTES);
    for (const b of input.batches) {
      const s = batchStage(b.state);
      if (s === "sending" || s === "google") eta = Math.max(eta ?? 0, (batchEtaMin(b, turn, input.nowMs) ?? 1) + SAVE_MINUTES);
      else if (s === "saving") eta = Math.max(eta ?? 0, SAVE_MINUTES);
    }
  }
  const active = key !== "done";
  const finishAt = active && eta !== null ? new Date(input.nowMs + eta * 60_000).toISOString() : null;
  const basis = input.measured ? "from how long recent batches really took" : "a typical first batch; it becomes a measured figure after one finishes";
  const etaLine = !active
    ? null
    : eta === null
      ? "Time left: not counting - nothing goes to Google until the hold below is cleared."
      : `Estimated time left: ${durationWords(eta * 60_000)}${finishAt ? `, done around ${clockWords(finishAt, tz)}` : ""} (${basis}).`;

  const headline =
    key === "done"
      ? "Done - every product of this delivery has been looked up."
      : hold === "paused"
        ? "Waiting - the batch engine is paused in Mission Control."
        : hold === "held_job"
          ? "Waiting - this delivery is on hold in Batch Lookups."
          : hold === "no_budget"
            ? "Waiting - not sent to Google yet."
            : key === "waiting"
              ? "Queued - going to Google within about a minute."
              : key === "sending"
                ? "Sending to Google now."
                : key === "google"
                  ? "At Google - Gemini is searching the web for these products."
                  : "Google finished - saving the facts onto the products below.";
  const detail =
    key === "done"
      ? "Open each product to review what was found, or use the attach buttons below."
      : hold === "paused"
        ? "Press \"Send to Google now\" to resume and send this delivery first, or resume in Mission Control."
        : hold === "held_job"
          ? "Press \"Send to Google now\" to release the hold and send it first."
          : hold === "no_budget"
            ? "Press \"Send to Google now\" - this delivery goes first."
            : key === "google"
              ? "Google answers batches in minutes to a few hours. This box updates by itself; you can close the tab."
              : "This box updates by itself; you can close the tab and come back.";
  const steps = STAGE_STEPS.map((s) => ({ ...s, state: (ORDER[s.key] < ORDER[key] || key === "done" ? "done" : s.key === key ? "current" : "todo") as "done" | "current" | "todo" }));
  const refreshMs = !active ? 0 : key === "google" ? 60_000 : 15_000;
  return { key, steps, headline, detail, counter, percent, etaMin: active ? eta : 0, etaLine, finishAt, refreshMs, hold, active };
}

// ─── 3. attach (with the strain type) ───────────────────────────────────────

const STRAINS = new Set(["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd"]);

export type AttachPlan = { attach: ScoredValue[]; strain: string | null; strainFrom: "lookup" | "record" | null };

/**
 * One product, one press. "confident" lands the facts at the bar and the
 * strain type only when it clears the same bar (or the records agree);
 * "all" / "selected" is a person accepting every fact found, so the strain
 * type the lookup found is taken at any confidence - but never over a
 * person's pick and never when the strain library / manifest disagrees.
 */
export function planOnboardingAttach(p: ProductScore, mode: AttachMode, ev: { chosen: string | null; kb: string | null; manifest: string | null }, min = CULTIVERA_AUTO_ATTACH_MIN): AttachPlan {
  const pool = mode === "confident" ? p.confident : p.facts;
  const attach = pool.filter((f) => f.field !== "strain_type");
  const chosen = ev.chosen && STRAINS.has(ev.chosen.toLowerCase()) ? ev.chosen.toLowerCase() : null;
  if (chosen) return { attach, strain: null, strainFrom: null };
  const st = p.facts.find((f) => f.field === "strain_type");
  const r = strainForApproval({
    chosen: null,
    lookup: st ? String(st.value) : null,
    lookupConfidence: st?.confidence ?? null,
    kb: ev.kb,
    manifest: ev.manifest,
    min: mode === "confident" ? min : 0,
  });
  return { attach, strain: r.value, strainFrom: r.from === "lookup" || r.from === "record" ? r.from : null };
}

export type AttachTally = { products: number; facts: number; strains: number; skipped: number; left: number; errors: string[] };

export function attachSentence(t: AttachTally): string {
  const parts = [
    `${t.products} product${t.products === 1 ? "" : "s"} updated`,
    `${t.facts} fact${t.facts === 1 ? "" : "s"} attached`,
    `${t.strains} strain type${t.strains === 1 ? "" : "s"} set`,
  ];
  if (t.skipped) parts.push(`${t.skipped} had nothing new to attach`);
  let s = `${parts.join(" \u00b7 ")}.`;
  if (t.left) s += ` ${t.left} left - press the button again to continue.`;
  if (t.errors.length) s += ` Problems: ${t.errors.slice(0, 3).join("; ")}`;
  s += " Nothing was approved - check each row and press Approve.";
  return s;
}

// ─── 4. copy ────────────────────────────────────────────────────────────────

export function deliveryLookupHeader(vendor: string | null, manifestNumber: string | null): string {
  const v = (vendor ?? "").trim();
  const m = (manifestNumber ?? "").trim();
  const what = [v, m ? `manifest ${m}` : ""].filter(Boolean).join(" \u00b7 ");
  return what ? `Batch lookup for this delivery: ${what}` : "Batch lookup for this delivery";
}

export function vendorButtonLabel(vendor: string, manifests: number, products: number): string {
  return `Look up all ${products} product${products === 1 ? "" : "s"} from ${vendor} (${manifests} deliver${manifests === 1 ? "y" : "ies"} in review)`;
}

export const OBL_CODES = ["vendor_started", "vendor_nothing", "vendor_error", "sent", "send_nothing", "send_error", "attach_done", "attach_error"] as const;
export type OblCode = (typeof OBL_CODES)[number];

export function onboardingLookupBanner(code: unknown, msg: unknown): { tone: "ok" | "info" | "error"; text: string } | null {
  if (typeof code !== "string" || !(OBL_CODES as readonly string[]).includes(code)) return null;
  const m = typeof msg === "string" ? msg.trim().slice(0, 400) : "";
  switch (code as OblCode) {
    case "vendor_started":
      return { tone: "ok", text: m || "The vendor's products were queued and sent to Google." };
    case "vendor_nothing":
      return { tone: "info", text: m || "Nothing from this vendor is waiting to be looked up." };
    case "sent":
      return { tone: "ok", text: m || "Sent to Google. This box shows each step as it happens." };
    case "send_nothing":
      return { tone: "info", text: m || "Nothing from this delivery is waiting to go to Google." };
    case "attach_done":
      return { tone: "ok", text: m || "Facts attached." };
    case "vendor_error":
    case "send_error":
    case "attach_error":
    default:
      return { tone: "error", text: m || "That did not work just now. Try again." };
  }
}

// ─── self-tests ─────────────────────────────────────────────────────────────

export function __runOnboardingBatchSendCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL onboarding-batch-send-core: ${m}`);
    }
  };
  const J = "aaaaaaaa-0000-4000-8000-000000000001";
  const J2 = "aaaaaaaa-0000-4000-8000-000000000002";
  const base: BatchControl = { paused: false, pausedJobIds: [], priorityJobIds: [], note: null, at: null, by: null, mode: "manual", budget: 0 };

  // 1. switch
  ok(batchesFor(0) === 0 && batchesFor(1) === 1 && batchesFor(200) === 1 && batchesFor(201) === 2 && batchesFor(-4) === 0, "batches needed");
  const a = autoSendControl(base, { jobIds: [J], unsentItems: 250 });
  ok(a.changed && a.next.budget === 2 && a.budgetAdded === 2 && a.next.paused === false, "manual: allows exactly the batches it needs");
  ok(a.next.priorityJobIds[0] === J, "the job goes first in line");
  const b = autoSendControl({ ...base, budget: 1 }, { jobIds: [J], unsentItems: 10 });
  ok(b.next.budget === 2, "adds to an allowance already given (never takes one away)");
  ok(autoSendControl({ ...base, budget: MAX_BUDGET }, { jobIds: [J], unsentItems: 900 }).next.budget === MAX_BUDGET, "never above the cap");
  const auto = autoSendControl({ ...base, mode: "auto", budget: 0 }, { jobIds: [J], unsentItems: 5 });
  ok(auto.next.mode === "auto" && auto.next.budget === 0 && auto.budgetAdded === 0, "Automatic stays Automatic");
  const p = autoSendControl({ ...base, paused: true, note: "Stop everything", pausedJobIds: [J, J2] }, { jobIds: [J.toUpperCase()], unsentItems: 5 });
  ok(p.resumed && !p.next.paused && p.next.note === null, "a press resumes a paused engine and clears the note");
  ok(p.released === 1 && p.next.pausedJobIds.length === 1 && p.next.pausedJobIds[0] === J2, "only this delivery's hold is released");
  const none = autoSendControl(base, { jobIds: [J], unsentItems: 0 });
  ok(!none.changed && none.next === base, "nothing to send = switch untouched");
  ok(!autoSendControl(base, { jobIds: ["x"], unsentItems: 5 }).changed, "bad ids = nothing");
  const many = autoSendControl({ ...base, priorityJobIds: Array.from({ length: 25 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`) }, { jobIds: [J2], unsentItems: 1 });
  ok(many.next.priorityJobIds.length === PRIORITY_MAX && many.next.priorityJobIds[0] === J2, "priority list capped, newest first");

  // 2. stage
  const T = Date.parse("2026-10-01T19:00:00.000Z");
  const counts = (o: Partial<StageCounts>): StageCounts => ({ total: 10, unsent: 0, inBatch: 0, done: 0, failed: 0, canceled: 0, ...o });
  const ctl = { paused: false, mode: "manual" as const, budget: 1, pausedJobIds: [] as string[] };
  const S = (o: Partial<Parameters<typeof onboardingBatchStage>[0]>) =>
    onboardingBatchStage({ counts: counts({ unsent: 10 }), batches: [], control: ctl, jobId: J, jobOpen: true, turnaroundMin: 60, measured: true, nowMs: T, ...o });
  const q = S({});
  ok(q.key === "waiting" && q.hold === null && q.etaMin === 1 + 60 + SAVE_MINUTES && q.refreshMs === 15_000, "queued: send + turnaround + save");
  ok(q.steps[0].state === "current" && q.steps[4].state === "todo", "stepper marks the current step");
  ok(S({ control: { ...ctl, budget: 0 } }).hold === "no_budget" && S({ control: { ...ctl, budget: 0 } }).etaMin === null, "manual with no allowance = held, no fake ETA");
  ok(S({ control: { ...ctl, paused: true } }).hold === "paused", "paused engine = held");
  ok(S({ control: { ...ctl, pausedJobIds: [J] } }).hold === "held_job", "held delivery = held");
  ok(S({ control: { ...ctl, mode: "auto", budget: 0 } }).hold === null, "automatic never needs an allowance");
  const g = S({ counts: counts({ inBatch: 10 }), batches: [{ state: "running", created_at: new Date(T - 20 * 60_000).toISOString(), submitted_at: new Date(T - 20 * 60_000).toISOString() }] });
  ok(g.key === "google" && g.etaMin === 40 + SAVE_MINUTES && g.refreshMs === 60_000, "at Google: turnaround minus elapsed, slow refresh");
  ok(g.steps[1].state === "done" && g.steps[2].state === "current", "earlier steps done");
  ok(g.etaLine !== null && g.etaLine.includes("about 43 min") && g.etaLine.includes("recent batches"), "ETA line says the basis");
  const mixed = S({ counts: counts({ unsent: 3, inBatch: 7 }), batches: [{ state: "succeeded", created_at: new Date(T).toISOString(), submitted_at: null }] });
  ok(mixed.key === "waiting" && (mixed.etaMin ?? 0) >= 60, "earliest stage wins; slowest piece sets the ETA");
  const sv = S({ counts: counts({ inBatch: 4, done: 6 }), batches: [{ state: "ingesting", created_at: new Date(T).toISOString(), submitted_at: null }] });
  ok(sv.key === "saving" && sv.etaMin === SAVE_MINUTES && sv.percent === 60, "saving: a few minutes; percent from settled");
  const d = S({ counts: counts({ done: 9, failed: 1 }), jobOpen: false });
  ok(d.key === "done" && !d.active && d.refreshMs === 0 && d.percent === 100 && d.etaLine === null, "done: no refresh, no ETA");
  ok(d.steps.every((s) => s.state === "done"), "done: every step ticked");
  ok(S({ measured: false }).etaLine!.includes("typical"), "assumed turnaround is said");
  ok(S({}).counter === "0 of 10 products finished \u00b7 10 waiting to be sent", "counter copy");

  // 3. attach plan
  const score = (facts: ScoredValue[], strain: string | null = null): ProductScore => ({
    draftId: "d", name: "N", manifestId: "m", scored: facts.length > 0, facts,
    score: facts.length ? Math.min(...facts.map((f) => f.confidence ?? 0)) : null,
    confident: facts.filter((f) => (f.confidence ?? -1) >= 85), unsure: facts.filter((f) => (f.confidence ?? -1) < 85),
    strain, strainFrom: strain ? "lookup" : null,
  });
  const facts: ScoredValue[] = [
    { field: "description", value: "D", confidence: 95 },
    { field: "aroma", value: ["pine"], confidence: 60 },
    { field: "strain_type", value: "indica", confidence: 70 },
  ];
  const ev = { chosen: null, kb: null, manifest: null };
  const pc = planOnboardingAttach(score(facts), "confident", ev);
  ok(pc.attach.length === 1 && pc.strain === null, "confident: bar facts only; a 70% strain is not taken");
  const pa = planOnboardingAttach(score(facts), "all", ev);
  ok(pa.attach.length === 2 && pa.strain === "indica" && pa.strainFrom === "lookup", "all: every fact + the strain type it found");
  ok(planOnboardingAttach(score(facts), "selected", ev).strain === "indica", "ticked = all for those products");
  ok(planOnboardingAttach(score(facts), "all", { ...ev, chosen: "sativa" }).strain === null, "a person's pick is never replaced");
  ok(planOnboardingAttach(score(facts), "all", { ...ev, kb: "sativa" }).strain === null, "library disagrees = a person decides");
  const hi = [{ field: "strain_type" as const, value: "hybrid", confidence: 90 }];
  ok(planOnboardingAttach(score(hi), "confident", ev).strain === "hybrid", "confident: a strain at the bar is set");
  ok(planOnboardingAttach(score([]), "confident", { ...ev, kb: "indica", manifest: "indica" }).strain === "indica", "records that agree are used");
  ok(attachSentence({ products: 2, facts: 5, strains: 1, skipped: 0, left: 0, errors: [] }).includes("1 strain type set") && attachSentence({ products: 0, facts: 0, strains: 0, skipped: 0, left: 0, errors: [] }).includes("Nothing was approved"), "attach sentence");

  // 4. copy
  ok(deliveryLookupHeader("Ace Farms", "0042") === "Batch lookup for this delivery: Ace Farms \u00b7 manifest 0042", "header names vendor + manifest");
  ok(deliveryLookupHeader(null, null) === "Batch lookup for this delivery", "header without names");
  ok(vendorButtonLabel("Ace", 3, 120) === "Look up all 120 products from Ace (3 deliveries in review)" && vendorButtonLabel("Ace", 1, 1).includes("1 delivery"), "vendor button copy");
  ok(onboardingLookupBanner("sent", "")!.tone === "ok" && onboardingLookupBanner("attach_error", "x")!.text === "x" && onboardingLookupBanner("nope", "") === null, "banner closed set");
  return { passed, failed };
}
