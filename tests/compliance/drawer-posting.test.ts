/**
 * tests/compliance/drawer-posting.test.ts
 *
 * books-94 / D-39 — closing a shift now reaches the ledger.
 *
 * books-93 built the entries and said plainly that nothing posted them. This
 * asserts the door is open, that it opens at the RIGHT moment (reconcile, not
 * blind close), that it cannot be walked through twice, and that an employee's
 * tips are never swept into company cash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* ── the store this service reads from ──────────────────────────────────── */
const session = vi.fn();
const register = vi.fn();
const drops = vi.fn();

vi.mock("@/lib/registers/store", () => ({
  getSession: (...a: unknown[]) => session(...a),
  getRegister: (...a: unknown[]) => register(...a),
  totalDropsMinor: (...a: unknown[]) => drops(...a),
}));

/* ── the ledger it writes to ────────────────────────────────────────────── */
const submit = vi.fn(async (input: { sourceRef: string | null }) => ({
  ok: true,
  journalId: "j-1",
  journalNo: 77,
  status: "posted" as const,
  // A ref naming the already-posted session comes back as a duplicate, so one
  // mock exercises both the fresh and the replayed path.
  outcome: (input.sourceRef ?? "").includes("already") ? "duplicate" : "created",
  code: "GL_AUTOPOST_OK",
  message: "Posted.",
}));

vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: (...a: unknown[]) => submit(...(a as [{ sourceRef: string | null }])),
}));

import {
  postDrawerCloseForSession,
  describeDrawerPostOutcome,
  tillCloseSourceRef,
  TILL_CLOSE_SOURCE_PREFIX,
  type DrawerPostOutcome,
} from "@/lib/registers/drawer-posting-service";
import {
  TILLS_ACCOUNT,
  UNDEPOSITED_ACCOUNT,
  OVER_SHORT_ACCOUNT,
} from "@/lib/accounting/register-cash-journal-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SERVICE = "src/lib/registers/drawer-posting-service.ts";
const ACTIONS = "src/app/admin/registers/actions.ts";
const PAGE = "src/app/admin/registers/page.tsx";

/** Strip comments so a doc-block cannot satisfy a source assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const FLOAT = 16_750;
const SALES = 50_000;

/** A reconciled session. `over` shifts the counted cash off expectation. */
function reconciled(over = 0, extra: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    register_id: "r-1",
    business_day: "2026-11-02",
    status: "reconciled",
    opening_count_minor: FLOAT,
    closing_count_minor: FLOAT + SALES + over,
    expected_close_minor: FLOAT + SALES,
    over_short_minor: over,
    tips_minor: null,
    ...extra,
  };
}

/** Rule 48: narrow or fail loudly — never let a refusal pass as a post. */
function mustPost(o: DrawerPostOutcome) {
  if (o.kind !== "posted") throw new Error(`expected posted, got ${o.kind}: ${o.message}`);
  return o;
}
function mustNot(o: DrawerPostOutcome, kind: "skipped" | "refused" | "failed") {
  if (o.kind !== kind) throw new Error(`expected ${kind}, got ${o.kind}: ${o.message}`);
  return o;
}

/** The lines handed to the ledger on the most recent call. */
function sentLines(): Array<{ accountCode: string; amountCents: number }> {
  const call = submit.mock.calls.at(-1)?.[0] as unknown as {
    lines: Array<{ accountCode: string; amountCents: number }>;
  };
  return call.lines;
}
function sentAmount(account: string): number | undefined {
  return sentLines().find((l) => l.accountCode === account)?.amountCents;
}

beforeEach(() => {
  vi.clearAllMocks();
  register.mockResolvedValue({ id: "r-1", name: "Register 1" });
  drops.mockResolvedValue(0);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) THE HAPPY PATH — a reconciled drawer reaches the ledger
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · a reconciled drawer posts", () => {
  it("posts, and reports the journal it created", async () => {
    session.mockResolvedValue(reconciled());
    const o = mustPost(await postDrawerCloseForSession("s-1"));
    expect(o.outcome).toBe("created");
    expect(o.journalNo).toBe(77);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("sends the takings to Undeposited Funds and relieves the till", async () => {
    session.mockResolvedValue(reconciled());
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(UNDEPOSITED_ACCOUNT)).toBe(SALES);
    expect(sentAmount(TILLS_ACCOUNT)).toBe(-SALES);
  });

  it("what it sends balances — the ledger is not asked to fix it", async () => {
    session.mockResolvedValue(reconciled(-400));
    await postDrawerCloseForSession("s-1");
    expect(sentLines().reduce((s, l) => s + l.amountCents, 0)).toBe(0);
  });

  it("a short drawer debits 50920, a long one credits it", async () => {
    session.mockResolvedValue(reconciled(-400));
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(OVER_SHORT_ACCOUNT)).toBe(400);

    session.mockResolvedValue(reconciled(400));
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(OVER_SHORT_ACCOUNT)).toBe(-400);
  });

  it("a balanced drawer never writes a zero over/short line", async () => {
    session.mockResolvedValue(reconciled());
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(OVER_SHORT_ACCOUNT)).toBeUndefined();
  });

  it("posts as an approval-exempt bank entry, automatically", async () => {
    session.mockResolvedValue(reconciled());
    await postDrawerCloseForSession("s-1");
    const sent = submit.mock.calls.at(-1)?.[0] as unknown as {
      sourceKind: string;
      autoPost: boolean;
      journalDate: string;
    };
    expect(sent.sourceKind).toBe("bank");
    expect(sent.autoPost).toBe(true);
    // The business day, not today: a drawer reconciled the next morning still
    // belongs to the day it was taken.
    expect(sent.journalDate).toBe("2026-11-02");
  });

  it("derives cash sales from the reconciled figures, drops included", async () => {
    // expected = opening + sales - drops, so sales must come back out as 500.00
    // even though $200 was already dropped to the safe mid-shift.
    drops.mockResolvedValue(20_000);
    session.mockResolvedValue(
      reconciled(0, {
        expected_close_minor: FLOAT + SALES - 20_000,
        closing_count_minor: FLOAT + SALES - 20_000,
      }),
    );
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(UNDEPOSITED_ACCOUNT)).toBe(SALES - 20_000);
    expect(sentAmount(OVER_SHORT_ACCOUNT)).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) TIPS ARE NOT COMPANY MONEY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · tips are never swept", () => {
  it("a $42.50 tip jar changes nothing about what goes to the safe", async () => {
    session.mockResolvedValue(reconciled());
    await postDrawerCloseForSession("s-1");
    const withoutTips = sentAmount(UNDEPOSITED_ACCOUNT);

    session.mockResolvedValue(reconciled(0, { tips_minor: 4_250 }));
    await postDrawerCloseForSession("s-1");

    // Migration 0134: tips are the employee's money and are counted separately
    // from the drawer. Sweeping them would balance perfectly and quietly move
    // somebody's wages into the company's bank account.
    expect(sentAmount(UNDEPOSITED_ACCOUNT)).toBe(withoutTips);
    expect(sentAmount(UNDEPOSITED_ACCOUNT)).toBe(SALES);
  });

  it("a recorded tip never becomes an over/short either", async () => {
    session.mockResolvedValue(reconciled(0, { tips_minor: 4_250 }));
    await postDrawerCloseForSession("s-1");
    expect(sentAmount(OVER_SHORT_ACCOUNT)).toBeUndefined();
  });

  it("the service never reads tips_minor at all", () => {
    // The strongest form of the guarantee: it cannot misuse what it never
    // touches. If a future edit starts reading tips here, this fails first.
    expect(stripComments(read(SERVICE))).not.toContain("tips_minor");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) THE RIGHT MOMENT — blind close is too early
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · it posts at reconcile, not at close", () => {
  for (const status of ["open", "closed", "verified"] as const) {
    it(`a ${status} drawer is skipped, and says why`, async () => {
      session.mockResolvedValue(reconciled(0, { status }));
      const o = mustNot(await postDrawerCloseForSession("s-1"), "skipped");
      expect(o.code).toBe("TILL_POST_NOT_RECONCILED");
      expect(o.message).toContain(status);
      expect(submit).not.toHaveBeenCalled();
    });
  }

  it("a blind count with no expected figure cannot be posted", async () => {
    // This is the whole reason the post waits: at blind close the over/short
    // is genuinely unknown, and inventing one would be a guess.
    session.mockResolvedValue(
      reconciled(0, { status: "closed", expected_close_minor: null }),
    );
    mustNot(await postDrawerCloseForSession("s-1"), "skipped");
    expect(submit).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) REFUSALS — a bad read is not an empty drawer
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · what it refuses", () => {
  it("a session that cannot be read is refused, not treated as nothing to do", async () => {
    session.mockResolvedValue(null);
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_POST_NO_SESSION");
    // Rule 46, said out loud so nobody 'simplifies' it into a skip.
    expect(o.message).toMatch(/not the same as a drawer with nothing/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it("reconciled but missing its numbers is refused (rule 135)", async () => {
    session.mockResolvedValue(reconciled(0, { closing_count_minor: null }));
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_POST_INCOMPLETE_RECONCILE");
    expect(submit).not.toHaveBeenCalled();
  });

  it("a null expected figure on a reconciled row is refused too", async () => {
    // Asserting the CODE, not just the kind: a guard that only checks the
    // counted figure would still refuse this row for the wrong reason later on
    // (the builder would choke on NaN), and "refused" alone cannot tell the
    // difference between a deliberate rule-135 stop and an accident.
    session.mockResolvedValue(reconciled(0, { expected_close_minor: null }));
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_POST_INCOMPLETE_RECONCILE");
    expect(submit).not.toHaveBeenCalled();
  });

  it("a null OPENING float is refused, never defaulted to zero", async () => {
    // Rule 135, and D-72's shape moved into cash. Every other fixture supplies
    // an opening float, so without this case the service could quietly treat an
    // uncounted drawer as one that opened empty. That is not a rounding error:
    // the float is subtracted out to derive cash sales, so a wrong opening
    // figure overstates the day's takings by the whole float and the over/short
    // line absorbs the difference as if a cashier had done it.
    session.mockResolvedValue(reconciled(0, { opening_count_minor: null }));
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_POST_INCOMPLETE_RECONCILE");
    expect(submit).not.toHaveBeenCalled();
  });

  it("the refusal names all three figures it needs, so the fix is obvious", async () => {
    session.mockResolvedValue(reconciled(0, { opening_count_minor: null }));
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.message).toMatch(/opening/i);
    expect(o.message).toMatch(/counted/i);
    expect(o.message).toMatch(/expected/i);
  });

  it("an opening float of ZERO is a real drawer and still posts", async () => {
    // Rule 135's other half: zero IS an answer. A drawer genuinely opened with
    // no float must not be swept up by the missing-figure guard. Without this,
    // tightening the guard to `!session.opening_count_minor` would look fine.
    session.mockResolvedValue(
      reconciled(0, {
        opening_count_minor: 0,
        closing_count_minor: SALES,
        expected_close_minor: SALES,
      }),
    );
    mustPost(await postDrawerCloseForSession("s-1"));
    expect(sentAmount(UNDEPOSITED_ACCOUNT)).toBe(SALES);
  });

  it("a drawer counted below its own float is refused by the builder", async () => {
    // Consistent figures: no sales, no drops, so expected IS the float — and
    // the drawer still came up $157.50 light. That is a manager's problem.
    session.mockResolvedValue(
      reconciled(0, { closing_count_minor: 1_000, expected_close_minor: FLOAT }),
    );
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_CLOSE_BELOW_FLOAT");
    expect(submit).not.toHaveBeenCalled();
  });

  it("reconciled figures implying NEGATIVE cash sales are refused", async () => {
    // expected = opening + sales - drops. If the stored expected is below the
    // opening float with no drops, the arithmetic says the register sold
    // MINUS $157.50, which is not a thing. Something wrote an impossible row
    // and the ledger must not be handed it.
    session.mockResolvedValue(
      reconciled(0, { closing_count_minor: 1_000, expected_close_minor: 1_000 }),
    );
    const o = mustNot(await postDrawerCloseForSession("s-1"), "refused");
    expect(o.code).toBe("TILL_CLOSE_BAD_AMOUNT");
    expect(submit).not.toHaveBeenCalled();
  });

  it("a shift that took nothing and counted its float is SKIPPED, not refused", async () => {
    // Rule 136: a correct, complete outcome that moves no money is its own
    // answer and must never be reported as a problem.
    session.mockResolvedValue(
      reconciled(0, { closing_count_minor: FLOAT, expected_close_minor: FLOAT }),
    );
    const o = mustNot(await postDrawerCloseForSession("s-1"), "skipped");
    expect(o.code).toBe("TILL_CLOSE_NOTHING_MOVED");
    expect(submit).not.toHaveBeenCalled();
  });

  it("a ledger rejection is reported as failed, with the ledger's own words", async () => {
    submit.mockResolvedValueOnce({
      ok: false,
      journalId: null,
      journalNo: null,
      status: null,
      outcome: null,
      code: "GL_OUT_OF_BALANCE",
      message: "The debits and the credits differ.",
    } as unknown as Awaited<ReturnType<typeof submit>>);
    session.mockResolvedValue(reconciled());
    const o = mustNot(await postDrawerCloseForSession("s-1"), "failed");
    expect(o.code).toBe("GL_OUT_OF_BALANCE");
    expect(o.message).toContain("debits and the credits");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) IDEMPOTENCY — one close, one entry, forever
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · it cannot post the same drawer twice", () => {
  it("the source ref is keyed on the SESSION, not the register or the day", async () => {
    // Two shifts on one register on one day is normal. A register+date ref
    // would merge them and lose a whole shift's cash — D-24's exact shape.
    expect(tillCloseSourceRef("s-1")).toBe(`${TILL_CLOSE_SOURCE_PREFIX}:s-1`);
    expect(tillCloseSourceRef("s-1")).not.toBe(tillCloseSourceRef("s-2"));
  });

  it("the service sends exactly that ref, not a re-typed copy of the format", async () => {
    session.mockResolvedValue(reconciled());
    await postDrawerCloseForSession("s-1");
    const sent = submit.mock.calls.at(-1)?.[0] as unknown as { sourceRef: string };
    expect(sent.sourceRef).toBe(tillCloseSourceRef("s-1"));
  });

  it("a replay is reported as a duplicate and says nothing was written twice", async () => {
    session.mockResolvedValue(reconciled(0, { id: "already" }));
    const o = mustPost(await postDrawerCloseForSession("already"));
    expect(o.outcome).toBe("duplicate");
    expect(o.message).toMatch(/already posted/i);
    expect(describeDrawerPostOutcome(o)).toMatch(/not booked twice/i);
  });

  it("idempotency is the ledger's job, not a pre-check that could race", async () => {
    // Two managers clicking at once must not both see 'nothing posted yet'.
    const src = stripComments(read(SERVICE));
    expect(src).not.toMatch(/already\s*posted\s*\?|existingJournal|hasPosted/);
    expect(src).toContain("autoPost: true");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6) REACHABILITY (rule 133) — the door, and the report of what came through
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · reachability", () => {
  it("the reconcile action calls the poster", () => {
    const src = stripComments(read(ACTIONS));
    expect(src).toContain("postDrawerCloseForSession(sessionId)");
  });

  it("it posts AFTER the reconcile succeeded, never before", () => {
    // There are five `if (!result.ok) redirect(...)` lines in actions.ts, one
    // per action. Searching the whole file finds the FIRST one, which belongs
    // to a different action, so deleting the reconcile guard would leave an
    // earlier match standing and this comparison would still pass. Narrow to
    // the body of reconcileDrawerAction before looking.
    const src = stripComments(read(ACTIONS));
    const start = src.indexOf("export async function reconcileDrawerAction");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("export async function", start + 1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);

    const guard = body.indexOf("if (!result.ok) redirect");
    const post = body.indexOf("postDrawerCloseForSession(sessionId)");
    // Both must exist IN THIS ACTION, and in this order.
    expect(guard).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(guard);
  });

  it("the slice test itself cannot be fooled by another action's guard", () => {
    // Rule 39: a check that re-implements what it checks proves nothing. This
    // proves the narrowing above actually narrows -- that the file really does
    // contain more than one guard line, which is why the slice is required.
    const src = stripComments(read(ACTIONS));
    const guards = src.split("if (!result.ok) redirect").length - 1;
    expect(guards).toBeGreaterThan(1);
  });

  it("the outcome reaches the manager's screen, not just the return value", () => {
    expect(stripComments(read(ACTIONS))).toContain("describeDrawerPostOutcome(posted)");
    const page = stripComments(read(PAGE));
    expect(page).toContain("sp.posted");
  });

  it("the outcome is written to the audit log, so it survives the next click", () => {
    // Rule 134: a redirect parameter is erased by the next navigation. If that
    // were the only record, an unposted close would leave no trace at all.
    const src = stripComments(read(ACTIONS));
    expect(src).toContain("ledger_kind: posted.kind");
    expect(src).toContain("ledger_code: posted.code");
  });

  it("every outcome kind gets its own sentence for the banner", () => {
    const kinds: DrawerPostOutcome[] = [
      { kind: "posted", sessionId: "s", sourceRef: "r", journalId: "j", journalNo: 5, outcome: "created", code: "C", message: "m" },
      { kind: "skipped", sessionId: "s", code: "C", message: "nothing moved" },
      { kind: "refused", sessionId: "s", code: "C", message: "bad numbers" },
      { kind: "failed", sessionId: "s", sourceRef: "r", code: "C", message: "ledger said no" },
    ];
    const said = kinds.map(describeDrawerPostOutcome);
    // Four distinct sentences: none may collapse into a shrug.
    expect(new Set(said).size).toBe(4);
    for (const s of said) expect(s.length).toBeGreaterThan(10);
    expect(said[0]).toContain("#5");
    expect(said[3]).toContain("ledger said no");
  });

  it("the comment stripper actually strips, so those checks can fail", () => {
    expect(stripComments("// postDrawerCloseForSession(sessionId)\n")).not.toContain(
      "postDrawerCloseForSession",
    );
    expect(stripComments("const a = 1; // x\n")).toContain("const a = 1;");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7) THE LIMIT THAT REMAINS (rule 133f)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-94 · what is still not wired", () => {
  it("the open-from-vault half has no poster, and the file says so", () => {
    const src = read(SERVICE);
    expect(src).toContain("DELIBERATE LIMIT");
    expect(src).toContain("buildTillOpenJournal");
  });

  it("nothing here posts an opening entry", () => {
    expect(stripComments(read(SERVICE))).not.toContain("buildTillOpenJournal(");
  });
});
