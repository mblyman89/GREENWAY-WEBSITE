/**
 * src/lib/ai/partner-core.ts   (D184, round slice S7)
 *
 * Greenway Partner AI, the pure half. Owner (2026-11-05): "Set ai to be level
 * 2 to start." The levels, as offered in the strategy and accepted:
 *
 *   Level 1  It only explains.
 *   Level 2  It fixes small, known problems by itself and asks you before
 *            anything that changes money, counts or CCRS.   <- the default
 *   Level 3  Later, once you trust it, more fixes without asking. (Not open
 *            yet: it opens when the tools have a track record.)
 *
 * The safety design, in one breath: the AI NEVER writes. A deterministic
 * engine (buildProposals) turns live database facts into repair proposals,
 * each bound to ONE approved, audited tool. The AI only explains the facts
 * and the proposals. Approving a proposal sends only its id; the server
 * rebuilds the proposals from fresh data and runs the tool only if the same
 * id is still there, so neither the AI nor a stale page can invent or replay
 * a repair. There is no free-form SQL anywhere.
 */
import type { MoveRepair, CountRepair, Shortfall, CompletenessStatus } from "@/lib/compliance/ccrs-completeness-core";
import type { WatchItem } from "@/lib/registers/night-watch-core";
import { healPlan, vitalsLine, type VitalsReport } from "@/lib/platform/db-vitals-core";

// ---------------------------------------------------------------------------
// 1. Levels
// ---------------------------------------------------------------------------

export type PartnerLevel = 1 | 2 | 3;
export type PartnerTurn = { role: "user" | "assistant"; content: string };
export const DEFAULT_PARTNER_LEVEL: PartnerLevel = 2;
/** Levels the owner can choose today. 3 opens later. */
export const SELECTABLE_LEVELS: readonly PartnerLevel[] = [1, 2];
export const PARTNER_LEVEL_KEY = "partner_ai_level";

export function parsePartnerLevel(raw: unknown): PartnerLevel {
  const v = typeof raw === "object" && raw !== null && "level" in raw ? (raw as { level: unknown }).level : raw;
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 ? n : DEFAULT_PARTNER_LEVEL;
}

export const LEVEL_TEXT: Record<PartnerLevel, string> = {
  1: "Level 1: explains only. No fix buttons.",
  2: "Level 2: fixes small, known problems by itself and asks Michael before anything that changes money, counts or CCRS.",
  3: "Level 3: more fixes without asking. Not open yet.",
};

// ---------------------------------------------------------------------------
// 2. The approved tools (the ONLY ways the partner can change anything)
// ---------------------------------------------------------------------------

export type Touches = "nothing" | "money" | "counts" | "ccrs";

export type PartnerToolId = "retry_sale" | "record_as_rung" | "move_sale_line" | "correct_count" | "clear_stuck_sessions";

export type PartnerTool = {
  id: PartnerToolId;
  label: string;
  /** What the tool can change. "nothing" = re-runs the same chain on the same receipt. */
  touches: Touches;
  /** The audited function it calls. */
  calls: string;
};

export const PARTNER_TOOLS: Record<PartnerToolId, PartnerTool> = {
  retry_sale: {
    id: "retry_sale",
    label: "Retry a register sale the system tripped on",
    touches: "nothing",
    calls: "retryPosException(mode retry): the same sync chain, every legal gate on",
  },
  record_as_rung: {
    id: "record_as_rung",
    label: "Record a register sale as rung (the receipt is the truth)",
    touches: "money",
    calls: "retryPosException(mode record_as_rung)",
  },
  move_sale_line: {
    id: "move_sale_line",
    label: "Move one sale line to the lot the register really drew from",
    touches: "ccrs",
    calls: "moveSaleLine (D183)",
  },
  correct_count: {
    id: "correct_count",
    label: "Correct a count that took away units that were sold",
    touches: "counts",
    calls: "correctCount (D183)",
  },
  // D193 (owner 2026-11-06: "help me self heal these issues now. I want a
  // healthy db always."). Ends app connections stuck mid-transaction and stops
  // runaway app queries. No saved row changes: an unfinished step is rolled
  // back, exactly as if the request had crashed. Never the owner's SQL editor.
  clear_stuck_sessions: {
    id: "clear_stuck_sessions",
    label: "Clear stuck database connections",
    touches: "nothing",
    calls: "healStuckSessions -> platform_db_heal_stuck (0345): app sessions only, past the floors",
  },
};

export type Gate = "auto" | "owner_approves" | "explain_only";

/**
 * What the partner may do with a tool at a level.
 *   Level 1: explain only, always.
 *   Level 2: a tool that touches nothing may run without asking; anything
 *            touching money, counts or CCRS waits for Michael.
 *   Level 3: treated as Level 2 until it opens (never silently wider).
 */
export function gateFor(tool: PartnerToolId, level: PartnerLevel): Gate {
  if (level === 1) return "explain_only";
  return PARTNER_TOOLS[tool].touches === "nothing" ? "auto" : "owner_approves";
}

/** Who may press the button for a gate. The owner always may; a manager only for "auto" tools. */
export function mayApply(gate: Gate, isOwner: boolean): boolean {
  if (gate === "explain_only") return false;
  if (gate === "owner_approves") return isOwner;
  return true;
}

// ---------------------------------------------------------------------------
// 3. Facts the engine reads (gathered server-side from the live database)
// ---------------------------------------------------------------------------

export type ExceptionFact = {
  id: string;
  eventType: string;
  occurredAt: string;
  reason: string;
  /** From exception-retry-core.classifyExceptionReason. */
  kind: "system_fault" | "receipt_drift" | "legal_block" | "needs_review";
  plain: string;
  managerRetry: boolean;
  ownerRecordAsRung: boolean;
  hasOrder: boolean;
};

export type WeekFact = { label: string; env: string; status: CompletenessStatus; headline: string };

export type PartnerFacts = {
  todayIso: string;
  exceptions: ExceptionFact[];
  shortfalls: Shortfall[];
  weeks: WeekFact[];
  morning: { headline: string; items: WatchItem[] } | null;
  readErrors: string[];
  /** D193: the database's vital signs right now (null = not read). */
  database?: VitalsReport | null;
};

// ---------------------------------------------------------------------------
// 4. Proposals
// ---------------------------------------------------------------------------

export type ProposalPayload =
  | { tool: "retry_sale"; exceptionId: string }
  | { tool: "record_as_rung"; exceptionId: string }
  | { tool: "move_sale_line"; repair: MoveRepair }
  | { tool: "correct_count"; repair: CountRepair }
  | { tool: "clear_stuck_sessions"; pids: number[] };

export type Proposal = {
  /** Deterministic: same facts, same id. */
  id: string;
  tool: PartnerToolId;
  gate: Gate;
  title: string;
  /** Plain English: what happened and why this fixes it. */
  why: string;
  /** Plain English: exactly what pressing the button changes. */
  changes: string;
  payload: ProposalPayload;
};

/** Small stable hash (FNV-1a 32) for proposal ids. */
export function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `P-${h.toString(16).padStart(8, "0")}`;
}

export function payloadKey(p: ProposalPayload): string {
  switch (p.tool) {
    case "retry_sale":
    case "record_as_rung":
      return `${p.tool}|${p.exceptionId}`;
    case "move_sale_line":
      return `${p.tool}|${p.repair.lineId}|${p.repair.fromExt}|${p.repair.toExt}|${p.repair.quantity}`;
    case "correct_count":
      return `${p.tool}|${p.repair.lotId}|${p.repair.ext}|${p.repair.quantity}`;
    case "clear_stuck_sessions":
      return `${p.tool}|${[...p.pids].sort((a, b) => a - b).join(",")}`;
  }
}

const short = (id: string) => id.slice(0, 8);

export function buildProposals(f: PartnerFacts, level: PartnerLevel): Proposal[] {
  const out: Proposal[] = [];
  const add = (tool: PartnerToolId, payload: ProposalPayload, title: string, why: string, changes: string) =>
    out.push({ id: stableId(payloadKey(payload)), tool, gate: gateFor(tool, level), title, why, changes, payload });

  for (const e of f.exceptions) {
    if (e.hasOrder || e.kind === "legal_block") continue; // never forced; a person handles it
    if (e.kind === "system_fault" && e.managerRetry) {
      add(
        "retry_sale",
        { tool: "retry_sale", exceptionId: e.id },
        `Retry register ${e.eventType} ${short(e.id)}`,
        `It failed because the system tripped, not the staff: "${e.reason.slice(0, 160)}".`,
        "Re-runs the same sale through the same checks. Nothing about the sale changes; if the law says no, it stays on Exceptions.",
      );
    } else if (e.ownerRecordAsRung && e.eventType === "sale") {
      add(
        "record_as_rung",
        { tool: "record_as_rung", exceptionId: e.id },
        `Record sale ${short(e.id)} as rung`,
        `${e.plain} Reason saved: "${e.reason.slice(0, 160)}".`,
        "Records the sale exactly as the receipt shows (what the customer paid), with an audit flag. Legal checks still run.",
      );
    }
  }

  for (const s of f.shortfalls) {
    const r = s.repair;
    if (!r) continue;
    const name = s.lot.productName ?? "a product";
    if (r.kind === "move") {
      add(
        "move_sale_line",
        { tool: "move_sale_line", repair: r },
        `Move sale ${r.detailId} to lot ${r.toLotCode ?? r.toExt}`,
        `${name}: ${s.sentence}`,
        `Changes which lot CCRS is told that one sale came from. Stock on the shelf and the money are not touched.`,
      );
    } else {
      add(
        "correct_count",
        { tool: "correct_count", repair: r },
        `Correct the count on lot ${s.lot.lotCode ?? r.ext} by +${r.quantity}`,
        `${name}: ${s.sentence}`,
        `Adds one count correction of +${r.quantity} so the record matches what was sold. The shelf count is not touched; CCRS gets it as a Reconciliation.`,
      );
    }
  }

  // D193: stuck database connections (the same pids = the same id, so a
  // stale approval for connections that already cleared finds nothing).
  const heal = healPlan(f.database?.vitals ?? null);
  if (heal) {
    add(
      "clear_stuck_sessions",
      { tool: "clear_stuck_sessions", pids: heal.pids },
      `Clear ${heal.pids.length} stuck database connection(s)`,
      "A request stopped half way and kept its hold on the database. Left alone, these pile up until the back office cannot connect.",
      heal.sentence,
    );
  }

  // Owner approvals first (they need Michael), then the auto kind.
  return out.sort((a, b) => (a.gate === b.gate ? a.id.localeCompare(b.id) : a.gate === "owner_approves" ? -1 : 1));
}

export function findProposal(list: readonly Proposal[], id: string): Proposal | null {
  return list.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// 5. Grounding for the AI (read-only facts, size-capped)
// ---------------------------------------------------------------------------

export const FACTS_MAX_CHARS = 9000;

function clean(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

export function factsBlock(f: PartnerFacts, proposals: readonly Proposal[], level: PartnerLevel): string {
  const lines: string[] = [];
  lines.push(`TODAY (Pacific): ${f.todayIso}`);
  lines.push(`PARTNER LEVEL: ${LEVEL_TEXT[level]}`);
  if (f.readErrors.length) lines.push(`COULD NOT READ (say so, never guess): ${f.readErrors.map(clean).join(" | ")}`);
  if (f.database) {
    lines.push(vitalsLine(f.database));
    for (const x of f.database.findings.slice(0, 6)) lines.push(`- [${x.severity}] ${clean(x.what)} To do: ${clean(x.todo)}`);
  }
  if (f.morning) {
    lines.push(`MORNING REPORT: ${clean(f.morning.headline)}`);
    for (const i of f.morning.items.slice(0, 20)) lines.push(`- [${i.severity}/${i.who}] ${clean(i.sentence)} (page ${i.href})`);
  }
  lines.push(`CCRS SALE WEEKS:`);
  for (const w of f.weeks) lines.push(`- ${w.label} (${w.env}): ${w.status}. ${clean(w.headline)}`);
  lines.push(`REGISTER EXCEPTIONS OPEN: ${f.exceptions.length}`);
  for (const e of f.exceptions.slice(0, 15)) lines.push(`- ${short(e.id)} ${e.eventType} ${e.occurredAt.slice(0, 16)} kind=${e.kind}: ${clean(e.reason).slice(0, 200)}`);
  lines.push(`LOTS THAT SOLD MORE THAN THEY HAD: ${f.shortfalls.length}`);
  for (const s of f.shortfalls.slice(0, 15)) lines.push(`- ${clean(s.lot.productName ?? "?")} lot ${s.lot.lotCode ?? s.lot.ext}: cause=${s.cause}. ${clean(s.sentence)} Fix: ${clean(s.fix)}`);
  lines.push(`PROPOSED FIXES (only these exist; cite them by id):`);
  if (!proposals.length) lines.push("- none");
  for (const p of proposals) lines.push(`- ${p.id} [${p.gate}] ${clean(p.title)}. Changes: ${clean(p.changes)}`);
  const text = lines.join("\n");
  return text.length > FACTS_MAX_CHARS ? `${text.slice(0, FACTS_MAX_CHARS)}\n(…cut for length)` : text;
}

export const PARTNER_SYSTEM = [
  "You are Greenway Partner, the owner's data partner inside the Greenway Marijuana back office (a licensed Washington I-502 cannabis retailer). The owner is not technical: answer in plain English, short sentences, no jargon.",
  "You can SEE the live facts below. You can NOT change anything yourself. The only changes possible are the PROPOSED FIXES listed, each run by an approved, audited tool after the right person presses its button.",
  "Never invent a number, a sale, a lot, a fix or a page. Use only the facts. If a fact says it could not be read, say you could not check it.",
  "When a fix applies, name it by its id (for example P-1a2b3c4d), say what it changes, and say who presses it: [auto] fixes any manager may run; [owner_approves] fixes only Michael may run.",
  "Never suggest changing a price, a tax rate, a sale amount, a date or a count to make a report look right. Taxes and CCRS come from the actual sales. If something cannot be fixed by a listed tool, say what page to open and what a person must check.",
  "If the DATABASE line is not OK, say so first in plain words: what happened, whether the back office is affected, and the fix (a listed fix id, or the To do). A restart means it was briefly unreachable and is back; repeated restarts mean the database computer is too small (Micro) and the owner should move it to Small in Supabase.",
  "No legal, medical or financial advice. Keep answers under about 180 words unless asked for more.",
].join("\n");

/** Ids the answer cites that really exist (the UI shows only these as buttons). */
export function citedProposals(answer: string, list: readonly Proposal[]): Proposal[] {
  const ids = new Set((answer.match(/P-[0-9a-f]{8}/g) ?? []).map((s) => s));
  return list.filter((p) => ids.has(p.id));
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runPartnerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`partner-core FAIL: ${m}`);
    }
  };

  ok(DEFAULT_PARTNER_LEVEL === 2, "default level is 2 (owner)");
  ok(parsePartnerLevel(null) === 2, "missing setting is level 2");
  ok(parsePartnerLevel({ level: 1 }) === 1, "level 1 parses");
  ok(parsePartnerLevel({ level: 3 }) === 2, "level 3 is not open: falls back to 2");
  ok(parsePartnerLevel("1") === 1, "string 1 parses");
  ok(!SELECTABLE_LEVELS.includes(3), "3 not selectable");

  ok(gateFor("retry_sale", 2) === "auto", "retry touches nothing: auto at 2");
  ok(gateFor("record_as_rung", 2) === "owner_approves", "money waits for owner");
  ok(gateFor("move_sale_line", 2) === "owner_approves", "ccrs waits for owner");
  ok(gateFor("correct_count", 2) === "owner_approves", "counts wait for owner");
  ok(gateFor("retry_sale", 1) === "explain_only", "level 1 explains only");
  ok(gateFor("correct_count", 3) === "owner_approves", "level 3 never silently wider");
  ok(mayApply("auto", false) && mayApply("auto", true), "anyone may run auto");
  ok(!mayApply("owner_approves", false) && mayApply("owner_approves", true), "only owner approves");
  ok(!mayApply("explain_only", true), "nobody applies at level 1");
  for (const t of Object.values(PARTNER_TOOLS)) ok(t.touches === "nothing" || gateFor(t.id, 2) === "owner_approves", `${t.id}: anything touching money/counts/ccrs needs the owner`);

  const ex = (over: Partial<ExceptionFact>): ExceptionFact => ({
    id: "aaaaaaaa-1111",
    eventType: "sale",
    occurredAt: "2026-11-04T20:00:00Z",
    reason: "Order lines insert failed: x",
    kind: "system_fault",
    plain: "p",
    managerRetry: true,
    ownerRecordAsRung: false,
    hasOrder: false,
    ...over,
  });
  const lot = { id: "L1", lotCode: "LC1", ext: "E1", productKey: "k", productName: "Blue Dream 3.5g", status: "active", received: 10, onHand: 0, adjustments: -1, countRemoved: -1, sold: 10, record: -1 };
  const facts: PartnerFacts = {
    todayIso: "2026-11-05",
    exceptions: [
      ex({}),
      ex({ id: "bbbbbbbb-2222", kind: "receipt_drift", managerRetry: false, ownerRecordAsRung: true, reason: "discount rate changed" }),
      ex({ id: "cccccccc-3333", kind: "legal_block", managerRetry: false, ownerRecordAsRung: false, reason: "outside sales hours" }),
      ex({ id: "dddddddd-4444", hasOrder: true }),
    ],
    shortfalls: [
      { lot, short: 1, cause: "count", repair: { kind: "count", lotId: "L1", ext: "E1", quantity: 1 }, lockedLines: 0, sentence: "sold 1 more", fix: "correct" },
      {
        lot: { ...lot, id: "L2", ext: "E2" },
        short: 1,
        cause: "wrong_lot",
        repair: { kind: "move", lineId: "ln", detailId: "d-1", quantity: 1, fromLotId: "L2", fromExt: "E2", toLotId: "L3", toExt: "E3", toLotCode: "LC3", sameProductKey: true },
        lockedLines: 0,
        sentence: "s",
        fix: "f",
      },
      { lot: { ...lot, id: "L4" }, short: 1, cause: "unknown", repair: null, lockedLines: 0, sentence: "s", fix: "f" },
    ],
    weeks: [{ label: "W", env: "prod", status: "pending", headline: "h" }],
    morning: null,
    readErrors: [],
  };
  const ps = buildProposals(facts, 2);
  ok(ps.length === 4, `4 proposals (retry, rung, count, move): ${ps.length}`);
  ok(!ps.some((p) => (p.payload.tool === "retry_sale" || p.payload.tool === "record_as_rung") && p.payload.exceptionId.startsWith("cccc")), "legal block never proposed");
  ok(!ps.some((p) => (p.payload.tool === "retry_sale" || p.payload.tool === "record_as_rung") && p.payload.exceptionId.startsWith("dddd")), "a sale with an order is never proposed");
  ok(ps[ps.length - 1]!.gate === "auto", "owner approvals listed first, auto last");
  ok(ps.filter((p) => p.gate === "owner_approves").length === 3, "three owner approvals");
  const again = buildProposals(facts, 2);
  ok(again.map((p) => p.id).join() === ps.map((p) => p.id).join(), "ids are deterministic");
  ok(new Set(ps.map((p) => p.id)).size === ps.length, "ids are unique");
  const changed = buildProposals({ ...facts, shortfalls: [{ ...facts.shortfalls[0]!, repair: { kind: "count", lotId: "L1", ext: "E1", quantity: 2 } }] }, 2);
  ok(!changed.some((p) => p.id === ps.find((q) => q.tool === "correct_count")!.id), "a different quantity is a different id (stale approval refused)");
  ok(buildProposals(facts, 1).every((p) => p.gate === "explain_only"), "level 1: every proposal explain-only");
  ok(findProposal(ps, ps[0]!.id) === ps[0], "find by id");
  ok(findProposal(ps, "P-00000000") === null, "unknown id not found");

  const fb = factsBlock({ ...facts, readErrors: ["orders: boom"] }, ps, 2);
  ok(fb.includes("COULD NOT READ"), "read errors are in the grounding");
  ok(ps.every((p) => fb.includes(p.id)), "every proposal id is in the grounding");
  ok(!fb.includes("\u0000"), "control chars stripped");
  const big = factsBlock({ ...facts, exceptions: Array.from({ length: 15 }, (_, i) => ex({ id: `e${i}`, reason: "x".repeat(5000) })) }, ps, 2);
  ok(big.length <= FACTS_MAX_CHARS + 30, "grounding is capped");
  const cited = citedProposals(`Press ${ps[0]!.id} and also P-deadbeef`, ps);
  ok(cited.length === 1 && cited[0]!.id === ps[0]!.id, "only real ids become buttons");
  ok(stableId("a") !== stableId("b") && /^P-[0-9a-f]{8}$/.test(stableId("a")), "stable id format");
  ok(PARTNER_SYSTEM.includes("can NOT change anything"), "system prompt: AI never writes");
  ok(PARTNER_SYSTEM.includes("Never invent"), "system prompt: no invention");

  // D193 database self-heal
  ok(gateFor("clear_stuck_sessions", 2) === "auto", "clearing stuck connections touches nothing: auto at 2");
  ok(gateFor("clear_stuck_sessions", 1) === "explain_only", "level 1 still explains only");
  const dbStuck: VitalsReport = {
    status: "warn",
    summary: "s",
    restarted: false,
    findings: [{ code: "stuck_sessions", severity: "warn", what: "2 stuck", todo: "clear", healable: true }],
    vitals: {
      startedAt: "2026-11-06T02:28:36Z", checkedAt: "2026-11-06T04:00:00Z", maxConnections: 60, connections: 20, active: 2, idle: 16, idleInTx: 2,
      appConnections: 18, oldestIdleInTxSecs: 900, longestActiveSecs: 1, waitingOnLock: 0, cacheHitRatio: 0.999, blocksRead: 1, deadlocks: 0, tempBytes: 0, dbBytes: 5e8,
      stuck: [
        { pid: 9, role: "authenticator", state: "idle in transaction", secs: 900, query: "q" },
        { pid: 7, role: "postgres", state: "idle in transaction", secs: 900, query: "owner" },
      ],
    },
  };
  const withDb = buildProposals({ ...facts, database: dbStuck }, 2);
  const heal = withDb.find((p) => p.tool === "clear_stuck_sessions");
  ok(heal !== undefined && heal.gate === "auto", "stuck connections become an auto fix");
  ok(heal !== undefined && heal.payload.tool === "clear_stuck_sessions" && heal.payload.pids.join() === "9", "only the app session, never the owner's editor");
  ok(buildProposals({ ...facts, database: { ...dbStuck, vitals: { ...dbStuck.vitals!, stuck: [] } } }, 2).every((p) => p.tool !== "clear_stuck_sessions"), "nothing stuck: no heal proposal");
  ok(buildProposals({ ...facts, database: null }, 2).length === 4, "no database facts: the old proposals only");
  const fbDb = factsBlock({ ...facts, database: dbStuck }, withDb, 2);
  ok(fbDb.includes("DATABASE: WARN") && fbDb.includes("2 stuck"), "database vitals are in the grounding");
  ok(PARTNER_SYSTEM.includes("DATABASE line"), "system prompt: explain database trouble first");

  return { passed, failed };
}
