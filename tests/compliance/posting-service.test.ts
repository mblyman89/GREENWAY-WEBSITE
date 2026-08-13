/**
 * tests/compliance/posting-service.test.ts
 *
 * Tests for THE ONE DOOR's application layer — the thin server module that
 * calls gl_submit_journal().
 *
 * The database's own behaviour is proven separately and far more aggressively
 * by scripts/accounting/posting-service-tests.sql, which executes 82 assertions
 * against real PostgreSQL (112 assertions as of the approval work). What is tested HERE is the part that lives only in
 * TypeScript and would otherwise never be executed before it ran against
 * Michael's real books:
 *
 *   - the pre-flight refusals (out of balance, too few lines, no reference),
 *     which must never reach the network,
 *   - the exact payload sent to the RPC, because a mis-named parameter would
 *     silently become NULL and, in the case of p_auto_post, could turn a
 *     deliberate refusal into a post,
 *   - the plain-English translation of every refusal, because a shrug in this
 *     layer is how people start doing the bookkeeping outside the system.
 *
 * The Supabase client is a stub. That is deliberate: this file is about the
 * TypeScript, and the SQL suite is about the SQL. Neither substitutes for the
 * other.
 */
import { describe, it, expect, vi } from "vitest";
import {
  submitJournal,
  submitIntercompanyPair,
  approveJournal,
  explainPostingError,
  previewDecision,
  type SubmitJournalInput,
} from "../../src/lib/accounting/posting-service";
import type { PostingTemplate } from "../../src/lib/accounting/posting-core";

// --- a stub that records exactly what was sent -------------------------------
function stubClient(response: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: response.data ?? null, error: response.error ?? null };
    }),
  };
  return { client: client as never, calls };
}

const balanced: SubmitJournalInput = {
  entityCode: "greenway",
  journalDate: "2026-03-15",
  sourceKind: "bank",
  sourceRef: "PSE-2026-03",
  memo: "the electric bill",
  lines: [
    { accountCode: "70020", amountCents: 42_350, costClass: "nondeductible_280e" },
    { accountCode: "10200", amountCents: -42_350 },
  ],
};

describe("posting-service: pre-flight refusals never reach the network", () => {
  it("refuses an entry that does not balance, and does NOT call the database", async () => {
    const { client, calls } = stubClient({ data: {} });
    const r = await submitJournal(
      { ...balanced, lines: [
        { accountCode: "70020", amountCents: 42_350 },
        { accountCode: "10200", amountCents: -42_000 },
      ] },
      client,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GL_OUT_OF_BALANCE");
    expect(r.message).toContain("350");
    expect(calls.length).toBe(0);
  });

  it("refuses a single-sided entry without calling the database", async () => {
    const { client, calls } = stubClient({ data: {} });
    const r = await submitJournal(
      { ...balanced, lines: [{ accountCode: "70020", amountCents: 42_350 }] },
      client,
    );
    expect(r.code).toBe("GL_TOO_FEW_LINES");
    expect(calls.length).toBe(0);
  });

  it("refuses an AUTOMATIC entry with no stable reference", async () => {
    const { client, calls } = stubClient({ data: {} });
    const r = await submitJournal(
      { ...balanced, sourceRef: "   ", autoPost: true },
      client,
    );
    expect(r.code).toBe("GL_NO_IDEMPOTENCY_KEY");
    expect(calls.length).toBe(0);
  });

  it("NEGATIVE CONTROL: a hand-keyed DRAFT with no reference is allowed through", async () => {
    const { client, calls } = stubClient({
      data: { journal_id: "j1", status: "draft", outcome: "created", code: "GL_DRAFT_CREATED" },
    });
    const r = await submitJournal(
      { ...balanced, sourceKind: "manual", sourceRef: null, autoPost: false },
      client,
    );
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
  });
});

describe("posting-service: the RPC payload", () => {
  it("sends every parameter under the exact name the migration declares", async () => {
    const { client, calls } = stubClient({
      data: { journal_id: "j1", journal_no: 7, status: "posted", outcome: "created", code: "GL_AUTOPOST_OK" },
    });
    await submitJournal(
      { ...balanced, templateCode: "UTIL-PSE", expectedCents: 42_350, autoPost: true, threeWayMatched: true },
      client,
    );
    expect(calls[0].fn).toBe("gl_submit_journal");
    // A mis-named parameter arrives as NULL and the failure is silent, so the
    // key set is asserted exactly rather than sampled.
    expect(Object.keys(calls[0].args).sort()).toEqual(
      [
        "p_assumption_note",
        "p_auto_post",
        "p_entity_code",
        "p_expected_cents",
        "p_intercompany_ref",
        "p_journal_date",
        "p_lines",
        "p_memo",
        "p_source_kind",
        "p_source_ref",
        "p_template_code",
        "p_three_way_matched",
      ].sort(),
    );
  });

  it("converts lines to snake_case with cost_class defaulted to 'none', never undefined", async () => {
    const { client, calls } = stubClient({ data: { journal_id: "j1", status: "draft", outcome: "created" } });
    await submitJournal(balanced, client);
    const lines = calls[0].args.p_lines as Array<Record<string, unknown>>;
    expect(lines[0]).toEqual({
      account_code: "70020",
      amount_cents: 42_350,
      cost_class: "nondeductible_280e",
      description: null,
    });
    expect(lines[1].cost_class).toBe("none");
  });

  it("p_auto_post is FALSE unless explicitly requested — absent must never mean yes", async () => {
    const { client, calls } = stubClient({ data: { journal_id: "j1", status: "draft", outcome: "created" } });
    await submitJournal(balanced, client);
    expect(calls[0].args.p_auto_post).toBe(false);

    const truthy = stubClient({ data: { journal_id: "j1", status: "draft", outcome: "created" } });
    await submitJournal({ ...balanced, autoPost: undefined }, truthy.client);
    expect(truthy.calls[0].args.p_auto_post).toBe(false);

    const yes = stubClient({ data: { journal_id: "j1", status: "posted", outcome: "created" } });
    await submitJournal({ ...balanced, autoPost: true, templateCode: "T" }, yes.client);
    expect(yes.calls[0].args.p_auto_post).toBe(true);
  });

  it("p_three_way_matched is FALSE unless explicitly true (a truthy string must not count)", async () => {
    const { client, calls } = stubClient({ data: { journal_id: "j1", status: "draft", outcome: "created" } });
    await submitJournal(
      { ...balanced, threeWayMatched: "yes" as unknown as boolean },
      client,
    );
    expect(calls[0].args.p_three_way_matched).toBe(false);
  });
});

describe("posting-service: results", () => {
  it("reports a duplicate as a success that posted nothing new", async () => {
    const { client } = stubClient({
      data: { journal_id: "j1", journal_no: 7, status: "posted", outcome: "duplicate", code: "GL_DUPLICATE_IGNORED" },
    });
    const r = await submitJournal(balanced, client);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("duplicate");
    expect(r.message).toMatch(/already recorded/i);
    expect(r.message).toMatch(/nothing was posted twice/i);
  });

  it("reports a posted entry with its journal number as a number, not a string", async () => {
    const { client } = stubClient({
      data: { journal_id: "j1", journal_no: "42", status: "posted", outcome: "created", code: "GL_AUTOPOST_OK" },
    });
    const r = await submitJournal(balanced, client);
    expect(r.journalNo).toBe(42);
    expect(typeof r.journalNo).toBe("number");
  });

  it("does not throw on a database refusal — it returns a decision", async () => {
    const { client } = stubClient({
      error: { message: 'GL_POST_CONFLICT: greenway:purchase:INV-77 has already been recorded' },
    });
    // Note: `expect(asyncFn).not.toThrow()` does NOT await, so it proves
    // nothing about a rejected promise. Awaiting the call directly is what
    // actually demonstrates it resolves rather than rejecting.
    const r = await submitJournal(balanced, client);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GL_POST_CONFLICT");
  });
});

describe("posting-service: plain-English translation", () => {
  it("translates every error code the migration can raise", () => {
    // If the migration gains a code that is not in the table, this test is the
    // thing that notices — the fallback message is deliberately recognisable.
    const codes = [
      "GL_POST_CONFLICT",
      "GL_NO_IDEMPOTENCY_KEY",
      "GL_AUTOPOST_NOT_ELIGIBLE",
      "GL_AUTOPOST_NO_THREE_WAY_MATCH",
      "GL_AUTOPOST_NO_TEMPLATE",
      "GL_AUTOPOST_TEMPLATE_INACTIVE",
      "GL_AUTOPOST_TEMPLATE_UNAPPROVED",
      "GL_AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE",
      "GL_AUTOPOST_TEMPLATE_EXPIRED",
      "GL_AUTOPOST_WRONG_ENTITY",
      "GL_AUTOPOST_WRONG_SOURCE_KIND",
      "GL_AUTOPOST_OVER_LIMIT",
      "GL_AUTOPOST_OUT_OF_TOLERANCE",
      "GL_OUT_OF_BALANCE",
      "GL_TOO_FEW_LINES",
      "GL_UNKNOWN_ACCOUNT",
      "GL_UNKNOWN_ENTITY",
      "GL_PERIOD_CLOSED",
      "GL_NO_PERIOD",
      "GL_CONTROL_ACCOUNT",
      "GL_COST_CLASS_REQUIRED",
      "GL_COST_CLASS_NOT_ALLOWED",
      "gl_journals_line_in_the_sand",
      "GL_INTERCOMPANY_SAME_ENTITY",
      "GL_INTERCOMPANY_NO_REF",
      "GL_TEMPLATE_NEEDS_REASON",
    ];
    for (const c of codes) {
      const r = explainPostingError(`ERROR: ${c}: some database detail here`);
      expect(r.code, `${c} was not recognised`).toBe(c);
      expect(r.message.length, `${c} has no real explanation`).toBeGreaterThan(30);
      // No raw SQL jargon leaking into something Michael reads.
      expect(r.message).not.toMatch(/PL\/pgSQL|SQLSTATE|errcode/);
    }
  });

  it("NEGATIVE CONTROL: an unrecognised error is passed through, never swallowed", () => {
    const r = explainPostingError("ERROR: connection reset by peer");
    expect(r.code).toBe("GL_ERROR");
    expect(r.message).toContain("connection reset by peer");
  });

  it("explains the conflict without suggesting an overwrite", () => {
    const r = explainPostingError("GL_POST_CONFLICT: greenway:purchase:INV-77");
    expect(r.message).toMatch(/reverse it/i);
    expect(r.message).toMatch(/nothing has been changed/i);
  });
});

describe("posting-service: previewDecision", () => {
  const template: PostingTemplate = {
    code: "UTIL-PSE",
    entityCode: "greenway",
    sourceKind: "bank",
    isActive: true,
    approvedBy: "michael",
    approvedAt: "2026-01-15T00:00:00Z",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    tolerance: { absCents: 500, milliPct: 1000 },
    maxAutoPostCents: 500_000,
  };

  it("halves the absolute total correctly, so the ceiling is compared to the real entry value", () => {
    // Two lines of 42,350 sum to 84,700 in absolute terms; the entry is worth
    // 42,350. Getting this wrong would double every entry's apparent size and
    // trip the ceiling on legitimate bills.
    const d = previewDecision(
      { ...balanced, templateCode: "UTIL-PSE", expectedCents: 42_350 },
      template,
    );
    expect(d.disposition).toBe("post");
  });

  it("previews a draft when there is no template, without touching the network", () => {
    const d = previewDecision({ ...balanced, templateCode: null }, null);
    expect(d.disposition).toBe("draft");
    expect(d.code).toBe("AUTOPOST_NO_TEMPLATE");
  });

  it("previews the never-automatable kinds as drafts", () => {
    for (const kind of ["accrual", "depreciation", "intercompany", "opening_balance"] as const) {
      const d = previewDecision({ ...balanced, sourceKind: kind }, template);
      expect(d.disposition, `${kind}`).toBe("draft");
    }
  });

  it("survives garbage amounts in the preview rather than throwing at the UI", () => {
    expect(() =>
      previewDecision(
        { ...balanced, lines: [
          { accountCode: "70020", amountCents: Number.NaN },
          { accountCode: "10200", amountCents: -1 },
        ] },
        template,
      ),
    ).not.toThrow();
  });
});

describe("posting-service: intercompany", () => {
  it("sends both halves in one call, so they succeed or fail together", async () => {
    const { client, calls } = stubClient({ data: { intercompany_ref: "r1" } });
    const r = await submitIntercompanyPair(
      {
        ref: "11111111-1111-1111-1111-111111111111",
        journalDate: "2026-03-01",
        memo: "March rent, Geiger property",
        entityA: "greenway",
        linesA: [
          { accountCode: "70010", amountCents: 200_000, costClass: "nondeductible_280e" },
          { accountCode: "10200", amountCents: -200_000 },
        ],
        sourceRefA: "RENT-2026-03-GW",
        entityB: "landholding",
        linesB: [
          { accountCode: "10200", amountCents: 200_000 },
          { accountCode: "52000", amountCents: -200_000 },
        ],
        sourceRefB: "RENT-2026-03-LH",
      },
      client,
    );
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("gl_submit_intercompany_pair");
    expect(r.message).toMatch(/both halves/i);
    expect(r.message).toMatch(/draft/i);
  });

  it("translates a half-failure into plain English", async () => {
    const { client } = stubClient({
      error: { message: "GL_UNKNOWN_ACCOUNT: line 1 refers to account 99999" },
    });
    const r = await submitIntercompanyPair(
      {
        ref: "11111111-1111-1111-1111-111111111111",
        journalDate: "2026-03-01",
        memo: "broken half",
        entityA: "greenway",
        linesA: [],
        sourceRefA: "A",
        entityB: "landholding",
        linesB: [],
        sourceRefB: "B",
      },
      client,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GL_UNKNOWN_ACCOUNT");
  });
});

// ---------------------------------------------------------------------------
// THE BOUNCER — segregation of duties, application side.
// ---------------------------------------------------------------------------
describe("approveJournal", () => {
  it("sends exactly the parameters the database function declares", async () => {
    const { client, calls } = stubClient({ data: null });
    const r2 = await approveJournal(
      "11111111-1111-1111-1111-111111111111",
      "checked against the bank statement",
      client,
    );
    expect(r2.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].fn).toBe("gl_approve_journal");
    // A mis-named parameter silently becomes NULL, so the KEY SET is asserted
    // exactly, not merely checked for the presence of the ones we remembered.
    expect(Object.keys(calls[0].args).sort()).toEqual(["p_journal_id", "p_note"]);
    expect(calls[0].args.p_note).toBe("checked against the bank statement");
  });

  it("refuses an empty journal id without touching the network", async () => {
    const { client, calls } = stubClient({ data: null });
    const r = await approveJournal("   ", undefined, client);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("passes a missing note through as null rather than the string 'undefined'", async () => {
    const { client, calls } = stubClient({ data: null });
    await approveJournal("11111111-1111-1111-1111-111111111111", undefined, client);
    expect(calls[0].args.p_note).toBeNull();
  });

  it("translates a self-approval refusal into something a human can act on", async () => {
    const { client } = stubClient({
      error: { message: "GL_SELF_APPROVAL_REFUSED: this entry was written and approved by the same person" },
    });
    const r = await approveJournal("11111111-1111-1111-1111-111111111111", undefined, client);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GL_SELF_APPROVAL_REFUSED");
    expect(r.message).toMatch(/someone else/i);
    // It must also tell him the escape hatch EXISTS, or he will conclude the
    // system is broken and start keeping the entry outside it.
    expect(r.message).toMatch(/self-approval can be switched on/i);
  });

  it("does not claim success when the database refused", async () => {
    // NEGATIVE CONTROL for the test above: if ok were hard-coded true, this fails.
    const { client } = stubClient({ error: { message: "GL_NO_APPROVAL_POLICY: no approval policy exists" } });
    const r = await approveJournal("11111111-1111-1111-1111-111111111111", undefined, client);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("GL_NO_APPROVAL_POLICY");
  });
});

describe("the vestibule — a large draft says so up front", () => {
  it("reports needsSecondApprover and says so in the message", async () => {
    const { client } = stubClient({
      data: {
        journal_id: "aaaaaaaa-1111-1111-1111-111111111111",
        journal_no: null,
        status: "draft",
        outcome: "created",
        code: "GL_DRAFT_CREATED",
        total_cents: 900000,
        needs_second_approver: true,
      },
    });
    const input: SubmitJournalInput = {
      entityCode: "greenway",
      journalDate: "2026-03-15",
      sourceKind: "manual",
      sourceRef: null,
      memo: "a large manual entry",
      lines: [
        { accountCode: "10100", amountCents: 900_000 },
        { accountCode: "50010", amountCents: -900_000 },
      ],
    };
    const r = await submitJournal(input, client);
    expect(r.ok).toBe(true);
    expect(r.needsSecondApprover).toBe(true);
    expect(r.totalCents).toBe(900000);
    expect(r.message).toMatch(/second person/i);
  });

  it("NEGATIVE CONTROL: a small draft does not claim it needs an approver", async () => {
    // Without this, the assertion above would pass even if the field were
    // hard-coded true. A predicate that can never be false is not a test.
    const { client } = stubClient({
      data: {
        journal_id: "bbbbbbbb-1111-1111-1111-111111111111",
        journal_no: null,
        status: "draft",
        outcome: "created",
        code: "GL_DRAFT_CREATED",
        total_cents: 1000,
        needs_second_approver: false,
      },
    });
    const r = await submitJournal(
      {
        entityCode: "greenway",
        journalDate: "2026-03-15",
        sourceKind: "manual",
        sourceRef: null,
        memo: "a small manual entry",
        lines: [
          { accountCode: "10100", amountCents: 1_000 },
          { accountCode: "50010", amountCents: -1_000 },
        ],
      },
      client,
    );
    expect(r.needsSecondApprover).toBe(false);
    expect(r.message).not.toMatch(/second person/i);
  });

  it("treats a missing flag as 'no', never as 'yes'", async () => {
    // An older database, or a null, must not produce a scary false warning.
    const { client } = stubClient({
      data: {
        journal_id: "cccccccc-1111-1111-1111-111111111111",
        journal_no: null,
        status: "draft",
        outcome: "created",
        code: "GL_DRAFT_CREATED",
      },
    });
    const r = await submitJournal(
      {
        entityCode: "greenway",
        journalDate: "2026-03-15",
        sourceKind: "manual",
        sourceRef: null,
        memo: "no flag at all",
        lines: [
          { accountCode: "10100", amountCents: 1_000 },
          { accountCode: "50010", amountCents: -1_000 },
        ],
      },
      client,
    );
    expect(r.needsSecondApprover).toBe(false);
    expect(r.totalCents).toBeNull();
  });
});

describe("the new refusals are explained like a person wrote them", () => {
  const newCodes = [
    "GL_APPROVAL_REQUIRED",
    "GL_SELF_APPROVAL_REFUSED",
    "GL_NO_APPROVER_IDENTITY",
    "GL_NO_APPROVAL_POLICY",
    "GL_ALREADY_REVERSED",
  ];

  for (const code of newCodes) {
    it(`${code} is explained in plain English`, () => {
      const { code: got, message } = explainPostingError(`${code}: raw database text`);
      expect(got).toBe(code);
      expect(message.length).toBeGreaterThan(40);
      // No SQL jargon leaking to a human being.
      expect(message).not.toMatch(/constraint|trigger|relation|pg_|null value/i);
      expect(message).not.toMatch(/raise exception/i);
    });
  }

  it("NEGATIVE CONTROL: an unrecognised error is surfaced verbatim, never swallowed", () => {
    // An unknown code becomes GL_ERROR, but the RAW TEXT must survive into the
    // message. Hiding an error we have no friendly words for would be the worst
    // of both worlds: the person sees nothing useful and the detail is lost.
    const { code, message } = explainPostingError("GL_SOMETHING_NOBODY_HAS_SEEN: detail here");
    expect(code).toBe("GL_ERROR");
    expect(message).toContain("GL_SOMETHING_NOBODY_HAS_SEEN");
    expect(message).toContain("detail here");
  });
});
