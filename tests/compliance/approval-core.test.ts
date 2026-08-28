/**
 * tests/compliance/approval-core.test.ts   (slice books-85, closes D-67)
 *
 * The approval path: what happens to a draft, and — more importantly — what
 * does NOT happen to it.
 *
 * The interesting risk in this slice is not "the button does nothing". It is
 * the opposite: a well-meaning approve-then-post that calls
 * gl_approve_journal on entries that never needed approving, gets
 * GL_SELF_APPROVAL_REFUSED because Michael wrote them, and strands entries the
 * posting rules were perfectly happy to accept. That would be D-67 all over
 * again wearing a different hat, and it would look like a working feature.
 *
 * So most of what follows is about the EXEMPTIONS, and the last block pins the
 * exemption list to the actual text of migration 0174 — if that trigger ever
 * changes, this file fails rather than silently drifting out of agreement with
 * the database.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  planApproval,
  debitTotalCents,
  isApprovalExempt,
  APPROVAL_EXEMPT_SOURCE_KINDS,
  SOURCE_KINDS,
  __runApprovalCoreTests,
  type ActorFacts,
  type ApprovalPolicyFacts,
  type DraftFacts,
} from "../../src/lib/accounting/approval-core";

const OWNER: ActorFacts = { actorId: "u-michael", isOwner: true };
const POLICY: ApprovalPolicyFacts = { thresholdCents: 500000, allowSelfApproval: false };

function draft(over: Partial<DraftFacts> = {}): DraftFacts {
  return {
    journalId: "j-1",
    status: "draft",
    sourceKind: "manual",
    totalCents: 100000,
    createdBy: "u-michael",
    approvedBy: null,
    lineCount: 2,
    ...over,
  };
}

describe("approval-core: the pure self-tests", () => {
  it("passes its own embedded sweep", () => {
    expect(() => __runApprovalCoreTests()).not.toThrow();
  });
});

describe("who may act", () => {
  it("refuses anyone who is not the owner, before looking at anything else", () => {
    // Note the draft here is perfect. The refusal is about the person.
    const p = planApproval(draft(), POLICY, { actorId: "u-admin", isOwner: false });
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("GL_FORBIDDEN");
  });

  it("refuses a signed-out caller even if they are somehow marked owner", () => {
    const p = planApproval(draft(), POLICY, { actorId: null, isOwner: true });
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("GL_NO_APPROVER_IDENTITY");
  });

  it("treats a blank actor id as no identity, not as a valid user", () => {
    const p = planApproval(draft(), POLICY, { actorId: "   ", isOwner: true });
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("GL_NO_APPROVER_IDENTITY");
  });
});

describe("what may be acted on", () => {
  it("refuses anything that is not a draft", () => {
    for (const status of ["posted", "reversed"]) {
      const p = planApproval(draft({ status }), POLICY, OWNER);
      expect(p.ok).toBe(false);
      if (p.ok) throw new Error("unreachable");
      expect(p.code).toBe("GL_ALREADY_POSTED");
      expect(p.message).toContain(status);
    }
  });

  it("refuses a draft with fewer than two lines", () => {
    for (const lineCount of [0, 1]) {
      const p = planApproval(draft({ lineCount }), POLICY, OWNER);
      expect(p.ok).toBe(false);
      if (p.ok) throw new Error("unreachable");
      expect(p.code).toBe("GL_TOO_FEW_LINES");
    }
  });
});

describe("THE EXEMPTIONS — the part that would silently break the feature", () => {
  it("posts every exempt kind WITHOUT an approve call, even at nine million cents", () => {
    // $90,000 of POS sales, authored by Michael, is the exact shape that a
    // naive approve-then-post would strand: approve would raise
    // GL_SELF_APPROVAL_REFUSED on an entry the trigger waves straight through.
    for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
      const p = planApproval(
        draft({ sourceKind: kind, totalCents: 9_000_000, createdBy: OWNER.actorId }),
        POLICY,
        OWNER,
      );
      expect(p.ok, `${kind} must not be refused`).toBe(true);
      if (!p.ok) throw new Error("unreachable");
      expect(p.action, `${kind} must post directly`).toBe("post_only");
    }
  });

  it("says out loud why a reversal is never blocked", () => {
    const p = planApproval(draft({ sourceKind: "reversal", totalCents: 9_000_000 }), POLICY, OWNER);
    if (!p.ok) throw new Error("a reversal must never be refused");
    expect(p.reason.toLowerCase()).toContain("reversal");
  });

  it("does NOT exempt the kinds a human judges", () => {
    for (const kind of ["manual", "payroll", "intercompany", "depreciation", "accrual", "close"]) {
      expect(isApprovalExempt(kind), `${kind} must not be exempt`).toBe(false);
    }
  });

  it("does not exempt an unknown source kind — an unrecognised kind is not a licence", () => {
    expect(isApprovalExempt("")).toBe(false);
    expect(isApprovalExempt("something_invented_later")).toBe(false);
  });

  it("lists only source kinds the schema actually allows", () => {
    for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
      expect(SOURCE_KINDS as readonly string[]).toContain(kind);
    }
  });
});

describe("the threshold", () => {
  it("posts directly below the threshold", () => {
    const p = planApproval(draft({ totalCents: 499_999 }), POLICY, OWNER);
    if (!p.ok) throw new Error("below threshold must not be refused");
    expect(p.action).toBe("post_only");
  });

  it("requires approval EXACTLY at the threshold, because the database uses >=", () => {
    const p = planApproval(
      draft({ totalCents: 500_000, createdBy: "u-someone-else" }),
      POLICY,
      OWNER,
    );
    if (!p.ok) throw new Error("at threshold must be actionable by a non-author");
    expect(p.action).toBe("approve_then_post");
  });

  it("refuses self-approval at or above the threshold", () => {
    const p = planApproval(draft({ totalCents: 500_000 }), POLICY, OWNER);
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("GL_SELF_APPROVAL_REFUSED");
    // The message has to be useful, not just correct: it names both numbers so
    // the owner can see how far over he is and decide what to do.
    expect(p.message).toContain("500000");
  });

  it("allows self-approval only when the policy deliberately switches it on", () => {
    const p = planApproval(draft({ totalCents: 500_000 }), {
      thresholdCents: 500_000,
      allowSelfApproval: true,
    }, OWNER);
    if (!p.ok) throw new Error("allowed self-approval must proceed");
    expect(p.action).toBe("approve_then_post");
  });

  it("does not refuse self-approval BELOW the threshold — the control does not apply there", () => {
    const p = planApproval(draft({ totalCents: 1 }), POLICY, OWNER);
    if (!p.ok) throw new Error("a one-cent entry must not need a second signature");
    expect(p.action).toBe("post_only");
  });

  it("does not treat a null author as self-approval", () => {
    // A machine-written entry can have created_by null. Comparing null to the
    // actor must not accidentally match.
    const p = planApproval(draft({ totalCents: 900_000, createdBy: null }), POLICY, OWNER);
    if (!p.ok) throw new Error("a null author is not the approver");
    expect(p.action).toBe("approve_then_post");
  });
});

describe("failing closed", () => {
  it("refuses when the entity has no approval policy at all", () => {
    const p = planApproval(draft(), null, OWNER);
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("GL_NO_APPROVAL_POLICY");
  });

  it("still refuses a missing policy for a LARGE entry — no policy is never a pass", () => {
    const p = planApproval(draft({ totalCents: 50_000_000 }), null, OWNER);
    expect(p.ok).toBe(false);
  });

  it("waves an EXEMPT kind through even with no policy, because the trigger does too", () => {
    // This is not a hole. gl_guard_journal_approval returns early for these
    // kinds BEFORE it ever looks up a policy (0174:817, above the policy
    // lookup at 0174:832), so refusing here would block a post the database
    // would happily accept.
    const p = planApproval(draft({ sourceKind: "pos_sale" }), null, OWNER);
    if (!p.ok) throw new Error("an exempt kind needs no policy");
    expect(p.action).toBe("post_only");
  });
});

describe("an entry that is already approved", () => {
  it("is posted, not re-approved — re-approving would erase who signed it", () => {
    const p = planApproval(
      draft({ totalCents: 9_000_000, approvedBy: "u-other" }),
      POLICY,
      OWNER,
    );
    if (!p.ok) throw new Error("an approved entry must be postable");
    expect(p.action).toBe("post_only");
  });

  it("treats a blank approver as not approved", () => {
    const p = planApproval(draft({ totalCents: 9_000_000, approvedBy: "  " }), POLICY, OWNER);
    // Michael is the author of this one, so a blank approver must fall through
    // to the self-approval refusal rather than being mistaken for a signature.
    expect(p.ok).toBe(false);
  });
});

describe("debitTotalCents mirrors the database's own arithmetic", () => {
  it("halves the sum of absolute values, exactly as 0174 does", () => {
    expect(debitTotalCents([1000, -1000])).toBe(1000);
    expect(debitTotalCents([1000, -600, -400])).toBe(1000);
    expect(debitTotalCents([2500, 1500, -4000])).toBe(4000);
    expect(debitTotalCents([])).toBe(0);
  });

  it("refuses a non-integer rather than rounding it", () => {
    expect(() => debitTotalCents([10.5, -10.5])).toThrow(/integer cents/i);
  });

  it("refuses a non-finite amount", () => {
    expect(() => debitTotalCents([Number.NaN])).toThrow();
    expect(() => debitTotalCents([Number.POSITIVE_INFINITY])).toThrow();
  });
});

/**
 * THE ANTI-DRIFT TEST. Everything above is only correct if the exemption list
 * still matches the trigger. This reads the migration and checks.
 */
describe("the exempt list still agrees with migration 0174", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(migrationsDir).find((f) => f.startsWith("0174"));

  it("finds migration 0174", () => {
    expect(file).toBeTruthy();
  });

  it("matches the source kinds gl_guard_journal_approval waves through", () => {
    const sql = readFileSync(join(migrationsDir, file as string), "utf8");

    // The trigger's early return. Written without the /s dotAll flag: this
    // project targets ES2017 and /s is a compile error (TS1501).
    const m = sql.match(
      /if new\.source_kind in \(([^)]*)\) then[\s\S]{0,200}?return new;/,
    );
    expect(m, "the exempt-kind early return must still be in 0174").toBeTruthy();

    const listed = (m as RegExpMatchArray)[1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);

    // pos_sale, excise, purchase, bank come from that one `in (...)`; reversal
    // has its own separate early return a few lines below, so it is checked
    // independently rather than being expected in the list.
    for (const kind of listed) {
      expect(
        APPROVAL_EXEMPT_SOURCE_KINDS as readonly string[],
        `0174 exempts '${kind}' but approval-core does not`,
      ).toContain(kind);
    }

    expect(sql).toMatch(/if new\.source_kind = 'reversal' then/);
    expect(APPROVAL_EXEMPT_SOURCE_KINDS as readonly string[]).toContain("reversal");

    // And nothing extra: every kind we exempt must be justified by 0174.
    const justified = new Set([...listed, "reversal"]);
    for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
      expect(
        justified.has(kind),
        `approval-core exempts '${kind}' but 0174 does not justify it`,
      ).toBe(true);
    }
  });

  it("still reads >= for the threshold comparison it mirrors", () => {
    const sql = readFileSync(join(migrationsDir, file as string), "utf8");
    // If this ever became `>`, "exactly at the threshold" would flip meaning.
    expect(sql).toMatch(/v_total\s*<\s*v_pol\.threshold_cents/);
  });
});
