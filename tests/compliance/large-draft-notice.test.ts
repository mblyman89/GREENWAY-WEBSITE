/**
 * tests/compliance/large-draft-notice.test.ts   (slice books-90, PR D)
 *
 * The planner's ARITHMETIC is already covered by __runLargeDraftNoticeCoreTests
 * in the pure sweep, and repeating it here would be duplication rather than
 * coverage (standing rule 129: one assertion per risk). This file tests the
 * things the pure sweep structurally cannot see:
 *
 *   1. THE THRESHOLD RULE STILL MATCHES THE DATABASE. The planner decides "is
 *      this large?" in TypeScript; migration 0174 decides it in SQL. If those
 *      two ever disagree, Michael gets emailed about entries the system posts
 *      without complaint, or — far worse — stops being emailed about ones it
 *      blocks. The migration text is the authority and is read from disk.
 *
 *   2. THE CHAIN IS ACTUALLY CONNECTED (standing rule 133). A perfect planner
 *      that nothing calls is D-40 and D-70 all over again, and this slice
 *      exists precisely because books-89 shipped a flag nobody could see.
 *
 *   3. THE ENGINE CANNOT BE TAKEN DOWN BY THIS PLANNER. It is the fifth of five
 *      and the only one that touches the books; a failure here must not silence
 *      the CCRS and wage-order deadlines, which carry real penalties.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APPROVAL_EXEMPT_SOURCE_KINDS } from "@/lib/accounting/approval-core";
import { isLargeDraft, planLargeDraftNotice } from "@/lib/accounting/large-draft-notice-core";

const M0174 = readFileSync("supabase/migrations/0174_gl_posting_service.sql", "utf8");
const ENGINE = readFileSync("src/lib/notifications/compliance-reminders.ts", "utf8");
const STORE = readFileSync("src/lib/accounting/large-draft-notice-store.ts", "utf8");
const ACTIONS = readFileSync("src/app/admin/compliance/calendar/actions.ts", "utf8");
const PAGE = readFileSync("src/app/admin/compliance/calendar/page.tsx", "utf8");
const PANEL = readFileSync("src/components/admin/compliance/SendRemindersNowPanel.tsx", "utf8");

describe("the flag matches the database, not my memory of it", () => {
  // 0174:475-486 is the vestibule that sets needs_second_approver on a draft.
  it("the migration still decides largeness the way this planner does", () => {
    const vestibule = M0174.slice(
      M0174.indexOf("if not p_auto_post then"),
      M0174.indexOf("-- (5) AUTOMATION RE-DERIVED SERVER-SIDE"),
    );

    // If this fails the slice is looking at the wrong part of the file, and
    // every assertion below would be checking nothing (standing rule 48).
    expect(vestibule).toContain("needs_second_approver");

    // AT the threshold counts. A `>` here instead of `>=` would silently spare
    // every entry that lands exactly on $5,000.
    expect(vestibule).toContain("v_abs_total >= v_threshold");
    expect(isLargeDraft({ totalCents: 500_000, thresholdCents: 500_000, sourceKind: "manual" })).toBe(
      true,
    );
    expect(isLargeDraft({ totalCents: 499_999, thresholdCents: 500_000, sourceKind: "manual" })).toBe(
      false,
    );
  });

  it("the exempt source kinds are the migration's list, not a second copy", () => {
    const vestibule = M0174.slice(
      M0174.indexOf("if not p_auto_post then"),
      M0174.indexOf("-- (5) AUTOMATION RE-DERIVED SERVER-SIDE"),
    );

    for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
      expect(vestibule).toContain(`'${kind}'`);
      expect(
        isLargeDraft({ totalCents: 9_000_000, thresholdCents: 500_000, sourceKind: kind }),
      ).toBe(false);
    }

    // The list is not merely non-empty in the migration — it is the SAME size,
    // so a kind added to the SQL and forgotten here shows up as a failure.
    const inSql = (vestibule.match(/'(pos_sale|excise|purchase|bank|reversal)'/g) ?? []).length;
    expect(inSql).toBe(APPROVAL_EXEMPT_SOURCE_KINDS.length);
  });

  it("the $5,000 default is the migration's default", () => {
    expect(M0174).toContain("threshold_cents      bigint not null default 500000");
    expect(STORE).toContain("500_000");
  });
});

describe("the chain is connected end to end (standing rule 133)", () => {
  it("the engine calls the planner and the store", () => {
    expect(/\bplanLargeDraftNotice\s*\(/.test(ENGINE)).toBe(true);
    expect(/\bloadUnapprovedDrafts\s*\(/.test(ENGINE)).toBe(true);
  });

  it("a human door exists: the page renders the panel, which calls the action", () => {
    expect(/<SendRemindersNowPanel\s*\/>/.test(PAGE)).toBe(true);
    expect(/\bsendRemindersNowAction\s*\(/.test(PANEL)).toBe(true);
    expect(/export async function sendRemindersNowAction\b/.test(ACTIONS)).toBe(true);
  });

  it("the action calls the engine and is gated and audited", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function sendRemindersNowAction"));
    expect(/\brunComplianceReminders\s*\(/.test(fn)).toBe(true);
    expect(/requirePermission\("compliance\.calendar"\)/.test(fn)).toBe(true);
    expect(/recordAudit\s*\(/.test(fn)).toBe(true);

    // The gate must come BEFORE the send, or it records a break-in instead of
    // preventing one.
    expect(fn.indexOf("requirePermission")).toBeLessThan(fn.indexOf("runComplianceReminders"));
  });

  it("the store reads with the admin client, because cron has no session", () => {
    // listDraftJournals would refuse every night at 4am, silently.
    expect(STORE).toContain("createSupabaseAdminClient");

    // A CALL, not a mention. The docblock explains at length why the
    // session-gated readers are the wrong ones here, so asserting against the
    // raw file would fail on the explanation itself — and the tempting fix
    // would be to delete a guard that is actually correct. Strip the comments
    // and test the CODE.
    const code = STORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(/\blistDraftJournals\s*\(/.test(code)).toBe(false);
    expect(/\brequireStaff\s*\(/.test(code)).toBe(false);

    // ...and prove the stripper actually stripped, or the two lines above are
    // passing because `code` is empty (standing rule 48).
    expect(code).toContain("createSupabaseAdminClient");
  });
});

describe("this planner cannot take the other four down", () => {
  it("the books read is wrapped in its own try/catch", () => {
    const block = ENGINE.slice(
      ENGINE.indexOf("// 5) books-90"),
      ENGINE.indexOf("result.planned = reminders.length;"),
    );
    expect(block).toContain("try {");
    expect(block).toContain("} catch (e) {");
    expect(block).toContain("Large-entry planner failed");
  });

  it("a failed read is reported, never delivered as 'nothing is waiting'", () => {
    // Standing rule 46. Silence here is the one outcome that would let a
    // $40,000 entry sit unnoticed while the system looked healthy.
    const block = ENGINE.slice(
      ENGINE.indexOf("// 5) books-90"),
      ENGINE.indexOf("result.planned = reminders.length;"),
    );
    expect(block).toContain("draftRead.ok");
    expect(block).toContain("NO email was sent about it");
    expect(STORE).toContain("ok: false");
  });
});

describe("what Michael actually receives", () => {
  const facts = {
    journalId: "j-1",
    entityCode: "retail",
    journalDate: "2026-11-10",
    sourceKind: "manual",
    memo: "Bulk flower purchase",
    totalCents: 750_000,
    thresholdCents: 500_000,
    createdDayKey: "2026-11-10",
  };

  it("names the money, the entity and the memo, so the email is actionable", () => {
    const n = planLargeDraftNotice("2026-11-10", [facts]);
    expect(n).not.toBeNull();
    expect(n!.subject).toContain("$7,500.00");
    expect(n!.body).toContain("retail");
    expect(n!.body).toContain("Bulk flower purchase");
    expect(n!.linkPath).toBe("/admin/books/drafts");
  });

  it("says nothing has posted, because nothing has", () => {
    const n = planLargeDraftNotice("2026-11-10", [facts])!;
    expect(n.body).toMatch(/Nothing here has posted/i);
    expect(n.body).toMatch(/do not touch your P&L/i);
  });

  it("tells him he can approve it himself, which books-89 made true", () => {
    const n = planLargeDraftNotice("2026-11-10", [facts])!;
    expect(n.body).toMatch(/approve these yourself/i);
  });

  it("goes quiet the day the drafts are approved", () => {
    expect(planLargeDraftNotice("2026-11-10", [])).toBeNull();
  });
});
