/**
 * tests/compliance/fix-p2-6-deposit-bags.test.ts
 *
 * Fix Phase 2.6a (G-04 deposit bag screen; G-14 the seal wire; F-00-6,
 * F-03-9, F-03-10). Owner message 4, verbatim:
 * "…post drops, then deposit-to-bank books, then deposit bag screen and
 * end-of-day sheet."
 *
 * Owner decisions this slice obeys (verbatim in docs/fix/00-OWNER-DECISIONS):
 *   D24 one person counts at night, a DIFFERENT person recounts in the morning
 *   D25 "anyone can seal the bag, I am the only one to take cash to the bank"
 *   D26 tamper-evident pre-numbered bags
 *   D27 "warning only please"
 *
 * What this file proves:
 *   1. The pure rules: day parsing, expected deposit, night count, the blind
 *      and different-person morning recount, the $5 reason, the seal, the
 *      owner bank record, the bag log CSV.
 *   2. postSealForBag refuses an unsealed bag, posts DR 10400 / CR 10100 on
 *      the bag's business day under source ref seal-bag:<id>, records the
 *      journal id once, and reports a failure as NOT POSTED.
 *   3. The server actions check permission + PIN before writing, the bank run
 *      is owner-only (requireBooksAccess before saveBanked), and every step
 *      is audited.
 *   4. The screen exists, Register Activity links to it, and an undeclared bag
 *      only WARNS (D27), never blocks.
 *   5. The census tells the truth: the seal is reachable via the bag screen.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── mocks ───────────────────────────────────────────────────────────────────
type SubmitInput = {
  entityCode: string;
  journalDate: string;
  sourceKind: string;
  sourceRef: string;
  memo: string;
  lines: { accountCode: string; amountCents: number }[];
  autoPost?: boolean;
};
let SUBMIT_RESULT: Record<string, unknown> = { ok: true, journalId: "j-1", journalNo: 41, outcome: "created", code: "GL_AUTOPOST_OK", message: "ok" };
const submitMock = vi.fn(async (_input: SubmitInput, _client?: unknown) => SUBMIT_RESULT);
vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: (...a: unknown[]) => submitMock(...(a as [SubmitInput, unknown])),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("tests pass their own client");
  },
}));

import {
  parseBusinessDay,
  expectedDeposit,
  checkNightCount,
  checkMorningRecount,
  RECOUNT_SAME_PERSON_ERROR,
  compareNightMorning,
  statusAfterRecount,
  checkRecountReason,
  checkSeal,
  sealSourceRef,
  checkBankRecord,
  sealedLeftBehind,
  showNightFigure,
  depositShapeNotice,
  bagLogCsv,
  csvCell,
  type BagRow,
} from "@/lib/registers/deposit-bag-flow-core";
import { postSealForBag, describeSealPost } from "@/lib/accounting/seal-bag-posting-service";
import { undeclaredBagWarning } from "@/lib/accounting/safe-bag-core";
import { LEDGER_CENSUS_ROWS } from "@/lib/accounting/ledger-census-data";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── a fake Supabase client for postSealForBag ───────────────────────────────
type Bag = Record<string, unknown>;
let BAG: Bag | null = null;
let READ_ERROR: string | null = null;
let UPDATE_ERROR: string | null = null;
const UPDATES: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }> = [];

function fakeClient() {
  return {
    from: (_table: string) => {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          values = v;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filters[`eq:${c}`] = v;
          return q;
        },
        is: (c: string, v: unknown) => {
          filters[`is:${c}`] = v;
          return q;
        },
        maybeSingle: async () =>
          READ_ERROR ? { data: null, error: { message: READ_ERROR } } : { data: BAG, error: null },
        then: (res: (v: unknown) => unknown) => {
          if (values) UPDATES.push({ values, filters });
          return Promise.resolve(UPDATE_ERROR ? { error: { message: UPDATE_ERROR } } : { error: null }).then(res);
        },
      });
      return q;
    },
  } as never;
}

const sealedBag = (over: Partial<Bag> = {}): Bag => ({
  id: "bag-1",
  bag_no: "1041",
  business_day: "2026-11-02",
  status: "deposited",
  amount_minor: 123456,
  sealed_at: "2026-11-03T16:00:00Z",
  seal_journal_id: null,
  ...over,
});

beforeEach(() => {
  submitMock.mockClear();
  SUBMIT_RESULT = { ok: true, journalId: "j-1", journalNo: 41, outcome: "created", code: "GL_AUTOPOST_OK", message: "ok" };
  BAG = sealedBag();
  READ_ERROR = null;
  UPDATE_ERROR = null;
  UPDATES.length = 0;
});

const row = (over: Partial<BagRow> = {}): BagRow =>
  ({
    id: "b1",
    bagNo: "1041",
    businessDay: "2026-11-02",
    status: "deposited",
    amountMinor: 50000,
    nightCountMinor: 50000,
    nightCountedBy: "e1",
    nightCountedAt: null,
    expectedMinor: 50000,
    nightNote: null,
    morningCountMinor: 50000,
    morningCountedBy: "e2",
    morningCountedAt: null,
    varianceReason: null,
    sealedAt: "2026-11-03T16:00:00Z",
    sealedBy: "e2",
    sealJournalId: "j1",
    bankedOn: null,
    bankedBy: null,
    bankNote: null,
    depositConfirmedOn: null,
    ...over,
  }) as BagRow;

// ═══════════════════════════════════════════════════════════════════════════
describe("2.6a · 1 — the pure rules", () => {
  it("a bad ?day= is an error, never silently today (F-03-8)", () => {
    expect(parseBusinessDay("", "2026-11-02")).toEqual({ ok: true, day: "2026-11-02" });
    expect(parseBusinessDay("2026-02-30", "x").ok).toBe(false);
    expect(parseBusinessDay("yesterday", "x").ok).toBe(false);
    expect(parseBusinessDay("2026-11-01", "x")).toEqual({ ok: true, day: "2026-11-01" });
  });

  it("expected deposit = Σ(closing − float) + drops; an open drawer makes it unknown, not zero", () => {
    const e = expectedDeposit(
      [
        { id: "s1", registerName: "Till 1", status: "closed", openingMinor: 20000, closingMinor: 70000 },
        { id: "s2", registerName: "Till 2", status: "closed", openingMinor: 20000, closingMinor: 30000 },
      ] as never,
      [{ sessionId: "s1", amountMinor: 100000 }],
    );
    expect(e.expectedMinor).toBe(50000 + 10000 + 100000);
    const open = expectedDeposit([{ id: "s1", registerName: "Till 1", status: "open", openingMinor: 20000, closingMinor: null }] as never, []);
    expect(open.expectedMinor).toBeNull();
    expect(open.problems.join(" ")).toMatch(/still open/);
  });

  it("night count needs a bag number, a PIN, money, and one bag per day", () => {
    const base = { bagNo: "1041", countMinor: 1000, closerId: "e1", existingBagNoForDay: null, note: "" };
    expect(checkNightCount(base).ok).toBe(true);
    expect(checkNightCount({ ...base, bagNo: " " }).ok).toBe(false);
    expect(checkNightCount({ ...base, closerId: null }).ok).toBe(false);
    expect(checkNightCount({ ...base, countMinor: 0 }).ok).toBe(false);
    const dup = checkNightCount({ ...base, existingBagNoForDay: "1040" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/One day, one bag/);
  });

  it("the morning recount must be a DIFFERENT employee (D24)", () => {
    const base = { status: "undeclared" as const, sealed: false, nightCounterId: "e1", recounterId: "e2", countMinor: 1000 };
    expect(checkMorningRecount(base).ok).toBe(true);
    const same = checkMorningRecount({ ...base, recounterId: "e1" });
    expect(same).toEqual({ ok: false, error: RECOUNT_SAME_PERSON_ERROR });
    expect(checkMorningRecount({ ...base, sealed: true }).ok).toBe(false);
    expect(checkMorningRecount({ ...base, recounterId: null }).ok).toBe(false);
  });

  it("the morning recount is blind: the night figure is hidden until the recount is saved", () => {
    expect(showNightFigure({ morningCountMinor: null, sealedAt: null, bankedOn: null })).toBe(false);
    expect(showNightFigure({ morningCountMinor: 100, sealedAt: null, bankedOn: null })).toBe(true);
    expect(showNightFigure({ morningCountMinor: null, sealedAt: "t", bankedOn: null })).toBe(true);
  });

  it("a reason is required only over $5 (D21); the bag declares when it agrees or a reason is written", () => {
    const small = compareNightMorning(10000, 10500);
    expect(small.needsReason).toBe(false);
    expect(statusAfterRecount(small, null)).toBe("counted");
    const big = compareNightMorning(10000, 10501);
    expect(big.needsReason).toBe(true);
    expect(statusAfterRecount(big, null)).toBe("undeclared");
    expect(statusAfterRecount(big, "miscount of fives")).toBe("counted");
    expect(checkRecountReason(501, "").ok).toBe(false);
    expect(checkRecountReason(500, "").ok).toBe(true);
  });

  it("the seal needs the recount first, refuses twice, and seals the MORNING amount", () => {
    const bag = {
      bagNo: "1041",
      status: "counted" as const,
      sealedAt: null,
      nightCountMinor: 10000,
      nightCountedBy: "e1",
      morningCountMinor: 10200,
      morningCountedBy: "e2",
      varianceReason: null,
    };
    const ok = checkSeal(bag, { bagNo: "1041", sealerId: "e3" });
    expect(ok).toEqual({ ok: true, bagNo: "1041", amountMinor: 10200 });
    const early = checkSeal({ ...bag, morningCountMinor: null, morningCountedBy: null }, { bagNo: "1041", sealerId: "e3" });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error).toMatch(/The morning recount comes first/);
    expect(checkSeal({ ...bag, sealedAt: "t" }, { bagNo: "1041", sealerId: "e3" }).ok).toBe(false);
    expect(checkSeal(bag, { bagNo: "1041", sealerId: null }).ok).toBe(false);
    // over $5 without a reason: do not seal
    expect(checkSeal({ ...bag, morningCountMinor: 11000 }, { bagNo: "1041", sealerId: "e3" }).ok).toBe(false);
    expect(sealSourceRef("abc")).toBe("seal-bag:abc");
  });

  it("the owner bank record takes only sealed, unbanked bags, on or after their day", () => {
    const bags = [row({ id: "b1" }), row({ id: "b2", bagNo: "1042", businessDay: "2026-11-03" }), row({ id: "b3", sealedAt: null })];
    const ok = checkBankRecord(bags, ["b1", "b2"], "2026-11-04", "");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.totalMinor).toBe(100000);
    expect(checkBankRecord(bags, [], "2026-11-04", "").ok).toBe(false);
    expect(checkBankRecord(bags, ["b3"], "2026-11-04", "").ok).toBe(false);
    expect(checkBankRecord(bags, ["b2"], "2026-11-02", "").ok).toBe(false);
    expect(checkBankRecord([row({ bankedOn: "2026-11-03" })], ["b1"], "2026-11-04", "").ok).toBe(false);
    expect(sealedLeftBehind(bags, ["b1"]).map((b) => b.id)).toEqual(["b2"]);
  });

  it("the $10,000 shape notice is advice, computed from the deposit and what stays behind (F-03-10)", () => {
    expect(depositShapeNotice(100, 0)).toBeNull();
    // $9,000 deposited while $12,000 of deposit cash stays in the safe
    const n = depositShapeNotice(900000, 1200000);
    expect(n?.code).toBe("DEPOSIT_SHAPE_UNDER_THRESHOLD");
  });

  it("the bag log CSV escapes cells and neutralises formula injection", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=SUM(A1)").startsWith("'") || csvCell("=SUM(A1)").startsWith("\"'")).toBe(true);
    expect(bagLogCsv([["a", "b"]])).toContain("a,b");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2.6a · 2 — postSealForBag: the seal wire (G-14)", () => {
  it("refuses a bag that is not sealed, and posts nothing", async () => {
    BAG = sealedBag({ sealed_at: null, status: "counted" });
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("BAG_NOT_SEALED");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("refuses a missing bag and a bag with no amount", async () => {
    BAG = null;
    expect((await postSealForBag("x", fakeClient())).kind).toBe("refused");
    BAG = sealedBag({ amount_minor: null });
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("BAG_NO_AMOUNT");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("a failed read is a failure, never a refusal or a post (rule 46)", async () => {
    READ_ERROR = "network down";
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("failed");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("posts DR 10400 / CR 10100 on the bag's business day, autoPost, sourceRef seal-bag:<id>", async () => {
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("posted");
    expect(submitMock).toHaveBeenCalledTimes(1);
    const input = submitMock.mock.calls[0][0];
    expect(input.sourceRef).toBe("seal-bag:bag-1");
    expect(input.journalDate).toBe("2026-11-02");
    expect(input.autoPost).toBe(true);
    expect(input.sourceKind).toBe("bank");
    const dr = input.lines.find((l) => l.amountCents > 0)!;
    const cr = input.lines.find((l) => l.amountCents < 0)!;
    expect(dr.accountCode).toBe("10400");
    expect(dr.amountCents).toBe(123456);
    expect(cr.accountCode).toBe("10100");
    expect(cr.amountCents).toBe(-123456);
  });

  it("records the journal id once, only where it is still empty", async () => {
    await postSealForBag("bag-1", fakeClient());
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].values).toEqual({ seal_journal_id: "j-1" });
    expect(UPDATES[0].filters["eq:id"]).toBe("bag-1");
    expect(UPDATES[0].filters["is:seal_journal_id"]).toBeNull();
    UPDATES.length = 0;
    BAG = sealedBag({ seal_journal_id: "j-0" });
    await postSealForBag("bag-1", fakeClient());
    expect(UPDATES).toHaveLength(0);
  });

  it("a retry is answered 'duplicate', never written twice", async () => {
    SUBMIT_RESULT = { ok: true, journalId: "j-1", journalNo: 41, outcome: "duplicate", code: "DUP", message: "dup" };
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("posted");
    if (o.kind === "posted") expect(o.duplicate).toBe(true);
    expect(describeSealPost(o)).toMatch(/not booked twice/);
  });

  it("a ledger failure is reported NOT POSTED, with the retry instruction", async () => {
    SUBMIT_RESULT = { ok: false, code: "GL_DOWN", message: "ledger down." };
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("failed");
    expect(describeSealPost(o)).toMatch(/^NOT POSTED/);
    expect(describeSealPost(o)).toMatch(/Post to the books/);
  });

  it("a failed link write is surfaced, not swallowed", async () => {
    UPDATE_ERROR = "trigger said no";
    const o = await postSealForBag("bag-1", fakeClient());
    expect(o.kind).toBe("posted");
    if (o.kind === "posted") expect(o.linkError).toBe("trigger said no");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2.6a · 3 — the server actions check before they write", () => {
  const src = read("src/app/admin/registers/deposit-bags/actions.ts");
  const body = (name: string) => {
    const i = src.indexOf(`export async function ${name}`);
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf("export async function", i + 10);
    return src.slice(i, j === -1 ? undefined : j);
  };

  it("is a server-actions file", () => {
    expect(src.startsWith('"use server"') || src.includes('\n"use server"')).toBe(true);
  });

  it("every PIN goes through the throttle on its own scope", () => {
    expect(src).toMatch(/pinPadBlocked\(DEPOSIT_BAG_PIN_SCOPE\)/);
    expect(src).toMatch(/notePinFailure\(DEPOSIT_BAG_PIN_SCOPE\)/);
  });

  it("night count: permission, PIN, rule, write, audit — in that order", () => {
    const b = body("nightCountAction");
    const order = ["requirePermission(", "employeeFromPin(", "checkNightCount(", "insertNightCount(", '"deposit_bag.night_counted"'];
    const idx = order.map((k) => b.indexOf(k));
    idx.forEach((v) => expect(v).toBeGreaterThan(-1));
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it("morning recount: a same-person attempt is refused AND audited (D24)", () => {
    const b = body("morningRecountAction");
    expect(b).toContain("checkMorningRecount(");
    const i = b.indexOf("if (chk.error === RECOUNT_SAME_PERSON_ERROR) {");
    expect(i).toBeGreaterThan(-1);
    const branch = b.slice(i, b.indexOf("fail(chk.error)", i));
    expect(branch).toContain('action: "deposit_bag.recount_refused"');
    expect(branch).toContain('reason: "same_person_as_night_count"');
    expect(b.indexOf("checkRecountReason(")).toBeLessThan(b.indexOf("saveMorningRecount("));
    expect(b).toContain('"deposit_bag.recounted"');
  });

  it("seal: anyone with a PIN (D25), checkSeal before saveSeal, then the books", () => {
    const b = body("sealBagAction");
    expect(b.indexOf("employeeFromPin(")).toBeGreaterThan(-1);
    expect(b.indexOf("checkSeal(")).toBeLessThan(b.indexOf("saveSeal("));
    expect(b.indexOf("saveSeal(")).toBeLessThan(b.indexOf("postSealForBag("));
    expect(b).toContain('"deposit_bag.sealed"');
    expect(b).not.toContain("requireBooksAccess(");
  });

  it("retry: posts again through the same idempotent poster, audited", () => {
    const b = body("retrySealPostAction");
    expect(b).toContain("postSealForBag(");
    expect(b).toContain('"deposit_bag.seal_post_retried"');
  });

  it("bank run: owner only (D25) — requireBooksAccess before any read or write", () => {
    const b = body("bankRunAction");
    const gate = b.indexOf("requireBooksAccess(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(b.indexOf("checkBankRecord("));
    expect(gate).toBeLessThan(b.indexOf("saveBanked("));
    expect(b).toContain("sealedLeftBehind(");
    expect(b).toContain('"deposit_bag.banked"');
    expect(b).not.toContain("requirePermission(");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2.6a · 4 — the screen, the button, the D27 warning", () => {
  it("the bag screen renders the night, morning, seal, bank and log panels", () => {
    const p = read("src/app/admin/registers/deposit-bags/page.tsx");
    for (const k of ["nightCountAction", "morningRecountAction", "sealBagAction", "retrySealPostAction", "bankRunAction"]) {
      expect(p).toContain(k);
    }
    expect(p).toContain('<PinField name="night_pin"');
    expect(p).toContain('<PinField name="morning_pin"');
    expect(p).toContain('<PinField name="seal_pin"');
    expect(p).toContain("<form key={b.id} action={sealBagAction}");
    expect(p).toContain("showNightFigure(");
    expect(p).toContain("canReadBooks");
    expect(p).toMatch(/NOT POSTED/);
    expect(p).toContain("parseBusinessDay(");
  });

  it("the bag log has a CSV export behind a permission", () => {
    expect(existsSync(join(ROOT, "src/app/admin/registers/deposit-bags/csv/route.ts"))).toBe(true);
    const r = read("src/app/admin/registers/deposit-bags/csv/route.ts");
    expect(r).toContain("requirePermission(");
    expect(r).toContain("bagLogCsv(");
  });

  it("Register Activity links to the bag screen and shows the D27 warning", () => {
    const p = read("src/app/admin/registers/page.tsx");
    // the toolbar button itself, not only the link inside the warning
    expect(p).toMatch(/<Button href=\{`\$\{BASE\}\/deposit-bags`\}[^>]*>\s*Deposit bags\{/);
    expect(p).toMatch(/const undeclaredWarning = undeclaredBagWarning\(/);
    expect(p).toContain("{undeclaredWarning ? (");
    expect(p).toContain("undeclaredBagsBefore(");
  });

  it("D27: an undeclared bag WARNS, and the old blocking function is gone", () => {
    const w = undeclaredBagWarning([{ bagNo: "1041", status: "undeclared", businessDay: "2026-11-02" }]);
    expect(w).toMatch(/^Warning:/);
    expect(w).toMatch(/nothing is blocked \(D27\)/);
    expect(undeclaredBagWarning([{ bagNo: "1041", status: "counted" }])).toBeNull();
    expect(read("src/lib/accounting/safe-bag-core.ts")).not.toMatch(/export function blockCloseForUndeclaredBags/);
  });

  it("migration 0316 drops the staff write policy and guards the sealed bag (F-03-9)", () => {
    const m = read("supabase/migrations/0316_deposit_bag_custody.sql");
    expect(m).toMatch(/drop policy if exists/i);
    expect(m).toMatch(/seal_journal_id/);
    expect(m).toMatch(/trigger/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("2.6a · 5 — the census tells the truth", () => {
  const rowOf = (k: string) => LEDGER_CENSUS_ROWS.find((r) => r.key === k)!;
  it("the seal is reachable through the bag screen", () => {
    const r = rowOf("cash_and_banking.seal_deposit_bag");
    expect(r.poster).toBe("src/lib/accounting/seal-bag-posting-service.ts#postSealForBag");
    expect(r.layers.reachable.status).toBe("PRESENT");
    expect(r.layers.reachable.evidence).toContain("sealBagAction");
    expect(r.layers.idempotent.status).toBe("PRESENT");
  });
});
