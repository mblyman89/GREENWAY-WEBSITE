/**
 * tests/compliance/owner-operator-self-approval.test.ts   (slice books-89)
 *
 * Michael asked for the $5,000 block to come off, in these words:
 *
 *   "I will need you to turn off the over 5k approval feature. I am the one and
 *    only owner operator that will have access to the books. I liked it because
 *    it flags large purchases, but I regularly have over 5k invoices, so I want
 *    to be notified about it, then it needs to allow me to approve it."
 *
 * There are TWO requests in that paragraph and they pull in opposite
 * directions. Remove the block. KEEP THE FLAG. The lazy fix — raising
 * threshold_cents to something enormous — satisfies the first and silently
 * destroys the second, and it would look identical in every test that only
 * checked "can Michael post a $6,000 entry now".
 *
 * So this file's real job is guarding the half that is easy to lose.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const M0211 = readFileSync(
  "supabase/migrations/0211_owner_operator_self_approval.sql",
  "utf8",
);

describe("0211 lifts the self-approval block", () => {
  it("sets allow_self_approval true", () => {
    expect(/set\s+allow_self_approval\s*=\s*true/.test(M0211)).toBe(true);
  });

  it("supplies the written reason the 0174 constraint demands", () => {
    // gl_approval_policy_self_needs_reason requires >= 20 non-blank characters
    // whenever allow_self_approval is true. A migration that set the boolean
    // without the reason would abort on a check constraint at deploy time.
    const m = /self_approval_reason\s*=\s*\n?\s*'([^']*(?:''[^']*)*)'/.exec(M0211);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? "").trim().length).toBeGreaterThanOrEqual(20);
  });

  it("records WHY in the reason, not just THAT", () => {
    // An examiner reading gl_approval_policy months from now must find the
    // justification beside the permission.
    expect(M0211).toContain("only person with books access");
    expect(M0211).toContain("is_owner()");
  });

  it("is idempotent: re-running touches nothing already permitted", () => {
    // A blanket UPDATE would overwrite a better, hand-written reason if one is
    // ever added. The WHERE clause is what makes a second run a no-op.
    expect(/where\s+allow_self_approval\s*=\s*false/.test(M0211)).toBe(true);
  });

  it("refuses to finish quietly if a policy row still blocks (rule 46)", () => {
    // A data migration that matched zero rows looks exactly like one that
    // worked. This is the difference.
    expect(M0211).toContain("0211 FAILED");
    expect(/raise exception/.test(M0211)).toBe(true);
  });

  it("guards its own ordering rather than failing with 'relation does not exist'", () => {
    expect(M0211).toContain("MIGRATION_OUT_OF_ORDER");
  });
});

describe("0211 KEEPS the flag Michael said he liked", () => {
  it("never changes threshold_cents", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. needs_second_approver is computed
    // from threshold_cents, so raising it would remove the block AND the
    // warning. He asked to keep the warning: "I liked it because it flags
    // large purchases... so I want to be notified about it".
    expect(/set[\s\S]{0,400}threshold_cents\s*=/.test(M0211)).toBe(false);
    expect(M0211).not.toMatch(/threshold_cents\s*=\s*\d/);
  });

  it("leaves the approval functions alone, because the policy is the switch", () => {
    // A business rule belongs in a row. Carving it into a function body is what
    // makes it a code change the day a bookkeeper is hired.
    expect(M0211).not.toContain("create or replace function public.gl_approve_journal");
    expect(M0211).not.toContain("drop trigger");
  });

  it("says out loud that the warning survives", () => {
    expect(M0211).toContain("needs_second_approver");
  });
});

describe("the flag has no screen yet, and that is written down not assumed", () => {
  const TODO = readFileSync("todo.md", "utf8");

  it("todo.md carries the deferred follow-up as PR D", () => {
    // Michael: "But we will work on that later, just add it to the list of
    // things to complete later on." Shipping the removal without recording the
    // remainder is how the half he liked disappears for good.
    expect(TODO).toContain("## PR D");
    expect(TODO).toContain("notify, do not block");
  });

  it("the deferred entry names the flag that exists but is not rendered", () => {
    const pr = TODO.slice(TODO.indexOf("## PR D"), TODO.indexOf("## PR D") + 2600);
    expect(pr).toContain("needsSecondApprover");
  });
});

describe("standing rule 133 is recorded (the end-to-end safety net)", () => {
  const TODO = readFileSync("todo.md", "utf8");

  it("rule 133 exists and quotes Michael's request verbatim", () => {
    expect(TODO).toContain("133. **THE END-TO-END RULE");
    expect(TODO).toContain("wire everything end to end this time");
  });

  it("names the reachability trap as the mechanism, not just the intention", () => {
    // A rule that says "be careful" is decoration. This one has to point at the
    // gate that enforces it.
    const idx = TODO.indexOf("133. **THE END-TO-END RULE");
    const rule = TODO.slice(idx, idx + 4000);
    expect(rule).toContain("posting-services-are-reachable.test.ts");
    expect(rule).toContain("ledger-census-data.ts");
  });
});
