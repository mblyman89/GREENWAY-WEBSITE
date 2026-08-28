/**
 * tests/compliance/journal-specimen.test.ts   (slice books-91, D-71)
 *
 * Two things are under test here, and they are different in kind.
 *
 * 1. THE SPECIMEN Michael asked to see. It must be built by the real engine,
 *    it must balance, and the screen must actually render it. A worked example
 *    that drifts from the engine is worse than none, because it teaches a
 *    reader to expect something the software does not do.
 *
 * 2. THE DURABLE RECORD (D-71). Every books outcome of a finalize -- posted,
 *    refused, or deliberately skipped -- must be written to manifest_events.
 *    Before this slice the outcome existed ONLY in a redirect URL, so the
 *    reason a payable was refused vanished on the next navigation. That is the
 *    defect Michael hit: inventory moved, the menu updated, no journal entry
 *    appeared, and nothing anywhere said why.
 *
 * Rule 39: these assertions do not re-implement the bill engine. The specimen's
 * own arithmetic check multiplies the stated quantities by hand (in the core's
 * self-test) precisely so that it is an INDEPENDENT check rather than a mirror.
 * Here we assert structure, wiring and reachability.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  buildJournalSpecimen,
  specimenAccountName,
  __runJournalSpecimenCoreTests,
  SPECIMEN_LOTS,
} from "@/lib/accounting/journal-specimen-core";
import { AP_ACCOUNT_CODE } from "@/lib/accounting/vendor-bill-core";
import { isApprovalExempt } from "@/lib/accounting/approval-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Strip comments so a docblock that MENTIONS a name cannot satisfy a test. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ACTIONS_PATH = "src/app/admin/inventory/intake/actions.ts";
const ACTIONS = read(ACTIONS_PATH);
const ACTIONS_CODE = stripComments(ACTIONS);
const PAGE = read("src/app/admin/books/drafts/page.tsx");
const PAGE_CODE = stripComments(PAGE);
const SPECIMEN_TSX = read("src/app/admin/books/drafts/JournalSpecimen.tsx");
const SPECIMEN_TSX_CODE = stripComments(SPECIMEN_TSX);

describe("the comment stripper actually strips", () => {
  // Rule 48: a check that cannot classify must fail, not quietly pass. If the
  // stripper silently returned its input, every "not.toContain" below would
  // pass for the wrong reason.
  it("removes block and line comments but keeps code", () => {
    expect(stripComments("/* logManifestEvent */ const a = 1;")).not.toContain(
      "logManifestEvent",
    );
    expect(stripComments("// logManifestEvent\nconst a = 1;")).not.toContain(
      "logManifestEvent",
    );
    expect(stripComments("/* x */ const a = 1;")).toContain("const a = 1;");
    // And it did strip THIS repo's files, not just toy strings.
    expect(ACTIONS.length).toBeGreaterThan(ACTIONS_CODE.length);
  });
});

describe("the specimen is built by the real engine", () => {
  it("passes its own self-tests", () => {
    expect(() => __runJournalSpecimenCoreTests()).not.toThrow();
  });

  it("builds, balances, and credits accounts payable exactly once", () => {
    const s = buildJournalSpecimen();
    expect(s.ok).toBe(true);
    if (!s.ok) return;

    // Check the ARITHMETIC directly, not the `balanced` flag. Asserting the
    // flag alone lets `balanced: true` be hard-coded and still pass, which is
    // a test that proves the label rather than the books.
    expect(s.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    expect(s.balanced).toBe(true);

    // ...and prove the flag is REPORTING that arithmetic rather than reciting
    // it. `balanced` is what the screen trusts when it decides whether to warn
    // Michael, so a flag hard-wired to true is a warning that can never fire.
    // The source must derive it from the summed lines.
    const CORE_SRC = read("src/lib/accounting/journal-specimen-core.ts");
    const coreCode = stripComments(CORE_SRC);
    expect(coreCode).toMatch(
      /const\s+signedSum\s*=\s*lines\.reduce\(\s*\(s,\s*l\)\s*=>\s*s\s*\+\s*l\.amountCents,\s*0\s*\)/,
    );
    expect(coreCode).toMatch(/balanced:\s*signedSum\s*===\s*0/);

    const credits = s.lines.filter((l) => l.amountCents < 0);
    expect(credits).toHaveLength(1);
    expect(credits[0].accountCode).toBe(AP_ACCOUNT_CODE);

    // The credit must actually REACH THE CREDIT COLUMN. Without this, a line
    // that is a credit in the data but renders a blank credit cell — money
    // that silently vanishes off the screen — passes every other assertion.
    expect(credits[0].creditText).not.toBe("");
    expect(credits[0].debitText).toBe("");
    for (const d of s.lines.filter((l) => l.amountCents > 0)) {
      expect(d.debitText).not.toBe("");
      expect(d.creditText).toBe("");
    }
  });

  it("shows the exact figures this published example is supposed to show", () => {
    // PINNED LITERALS, on purpose. Every other assertion derives its
    // expectation from SPECIMEN_LOTS, so editing a quantity or a unit cost
    // moves the test and the code together and nothing notices. These three
    // numbers are the specimen as documented in the owner report and the
    // DEFECTS entry; changing the delivery must be a DELIBERATE act that
    // updates this line too.
    //
    //   12 x 875.50 = 10,506.00      24 x 412.25 = 9,894.00
    //   payable                      = 20,400.00
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");

    expect(s.totalCents).toBe(2_040_000);
    expect(s.totalText).toBe("20,400.00");

    const byAccount = new Map(s.lines.map((l) => [l.accountCode, l.amountCents]));
    expect(byAccount.get("20010")).toBe(1_050_600);
    expect(byAccount.get("20120")).toBe(989_400);
    expect(byAccount.get(AP_ACCOUNT_CODE)).toBe(-2_040_000);
  });

  it("shows one debit line per PURCHASED lot, at that lot's own extended cost", () => {
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");

    // D-72: the free sample is NOT a bill line, so the count is the number of
    // purchased lots, not the number of lots on the truck.
    const purchased = SPECIMEN_LOTS.filter((l) => l.is_sample !== true);
    const samples = SPECIMEN_LOTS.filter((l) => l.is_sample === true);
    // Rule 48: this test cannot classify unless the specimen actually contains
    // both kinds. If it ever stops doing so, FAIL rather than pass vacuously.
    expect(purchased.length).toBeGreaterThan(0);
    expect(samples.length).toBeGreaterThan(0);

    const debits = s.lines.filter((l) => l.amountCents > 0);
    expect(debits).toHaveLength(purchased.length);
    expect(debits.length).toBeLessThan(SPECIMEN_LOTS.length);

    // Computed here from the stated delivery, NOT read back from the engine.
    for (const lot of purchased) {
      const extended = Math.round(
        (lot.received_qty ?? 0) * (lot.unit_cost_minor_units ?? 0),
      );
      expect(debits.some((d) => d.amountCents === extended)).toBe(true);
    }
  });

  it("D-72: the free sample rides along without moving one cent of the bill", () => {
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");

    const sample = SPECIMEN_LOTS.find((l) => l.is_sample === true);
    if (!sample) throw new Error("specimen must carry a sample lot to prove this");
    // The sample is a real delivered lot with real units on the truck...
    expect(Number(sample.received_qty)).toBeGreaterThan(0);
    // ...and no cost at all. Under the OLD code `Number(null) || 0` made this
    // indistinguishable from an unpriced purchase.
    expect(sample.unit_cost_minor_units).toBeNull();

    // Its lot code appears NOWHERE in the entry, and the total is exactly the
    // two purchased lots. This is the arithmetic proof of exclusion.
    for (const l of s.lines) {
      expect(l.description).not.toContain(String(sample.lot_code));
    }
    const purchasedTotal = SPECIMEN_LOTS.filter((l) => l.is_sample !== true).reduce(
      (sum, l) => sum + Math.round((l.received_qty ?? 0) * (l.unit_cost_minor_units ?? 0)),
      0,
    );
    expect(s.totalCents).toBe(purchasedTotal);
  });

  it("never puts an amount in both the debit and the credit column", () => {
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");
    for (const l of s.lines) {
      expect(l.debitText !== "" && l.creditText !== "").toBe(false);
    }
  });

  it("names every account it renders, so no bare code reaches the screen", () => {
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");
    for (const l of s.lines) {
      expect(specimenAccountName(l.accountCode)).not.toBeNull();
    }
  });

  it("derives the button label from the exempt list rather than asserting it", () => {
    const s = buildJournalSpecimen();
    if (!s.ok) throw new Error("specimen refused");
    // A purchase IS exempt (migration 0174), so it must offer a single click.
    expect(isApprovalExempt(s.sourceKind)).toBe(true);
    expect(s.buttonLabel).toBe("Post to the ledger");
  });

  it("announces that it is not real money", () => {
    const s = buildJournalSpecimen();
    expect(s.notice).toMatch(/not your books/i);
  });
});

describe("the specimen is reachable from a screen (rule 133)", () => {
  it("is imported and rendered by the drafts page", () => {
    expect(PAGE_CODE).toMatch(/import\s*\{\s*JournalSpecimen\s*\}/);
    expect(PAGE_CODE).toMatch(/<JournalSpecimen\s*\/>/);
  });

  it("is rendered even when Supabase is not configured", () => {
    // The unconfigured branch returns EARLY. If the specimen were only below
    // that return, the one screen state where a reader most needs an
    // explanation would show none.
    //
    // Scope precisely: from the `if (!isSupabaseServiceConfigured)` guard to
    // the `listDraftJournals` call that begins the configured path. Splitting
    // on the bare identifier would land on its IMPORT line instead and test a
    // region that proves nothing.
    const guardAt = PAGE_CODE.indexOf("if (!isSupabaseServiceConfigured)");
    expect(guardAt).toBeGreaterThan(-1);
    const readAt = PAGE_CODE.indexOf("listDraftJournals(", guardAt);
    expect(readAt).toBeGreaterThan(guardAt);

    const earlyReturn = PAGE_CODE.slice(guardAt, readAt);
    expect(earlyReturn).toMatch(/<JournalSpecimen\s*\/>/);

    // ...and it is ALSO on the normal path, after the read.
    expect(PAGE_CODE.slice(readAt)).toMatch(/<JournalSpecimen\s*\/>/);
  });

  it("renders the specimen's derived values rather than typed numbers", () => {
    // No literal dollar figure may appear in the component. The specimen's
    // total is 20,400.00 with the current delivery; if somebody pastes a
    // number in, this fails.
    expect(SPECIMEN_TSX_CODE).not.toMatch(/\d,\d{3}\.\d{2}/);
    expect(SPECIMEN_TSX_CODE).toContain("buildJournalSpecimen");
  });

  it("renders the refusal branch instead of swallowing it", () => {
    expect(SPECIMEN_TSX_CODE).toContain("s.message");
  });
});

describe("D-71: every books outcome of a finalize is written down", () => {
  it("logs a manifest event on success and on refusal", () => {
    expect(ACTIONS_CODE).toContain("vendor_bill_posted");
    expect(ACTIONS_CODE).toContain("vendor_bill_refused");
  });

  it("chooses the event type from the OUTCOME, not the same word every time", () => {
    // The whole value of the record is that a refusal reads differently from a
    // success. A branch that logs "posted" unconditionally is worse than no
    // log: it is a timeline that lies about a payable that never existed.
    expect(ACTIONS_CODE).toMatch(
      /billed\.ok\s*\?\s*"vendor_bill_posted"\s*:\s*"vendor_bill_refused"/,
    );
  });

  it("keeps the refusal banner on screen as well as on the timeline", () => {
    // The durable record must not have REPLACED the immediate one. Somebody
    // standing at the intake screen has to be told now, not on their next
    // visit to the manifest page.
    expect(ACTIONS_CODE).toMatch(
      /booksError=\$\{encodeURIComponent\(billed\.message\.slice\(0,\s*300\)\)\}/,
    );
  });

  it("logs a manifest event when no lot was activated, rather than skipping silently", () => {
    // The deliberate dead end must SAY SO (rule 133f).
    expect(ACTIONS_CODE).toContain("vendor_bill_skipped");
  });

  it("records the refusal CODE and MESSAGE, not just that something failed", () => {
    // "it failed" is not a diagnosis. The note must carry both.
    expect(ACTIONS_CODE).toMatch(/\$\{billed\.code\}:\s*\$\{billed\.message\}/);
  });

  it("still logs when the poster throws", () => {
    // Scope to finalizeManifestAction FIRST. This file holds twenty exported
    // actions and several of them have their own try/catch, so splitting the
    // whole file on "catch (err)" lands in setManifestLifecycleAction and
    // would report on code this slice never touched.
    const fnAt = ACTIONS_CODE.indexOf("export async function finalizeManifestAction");
    expect(fnAt).toBeGreaterThan(-1);
    const nextFnAt = ACTIONS_CODE.indexOf("export async function", fnAt + 10);
    const fn = ACTIONS_CODE.slice(fnAt, nextFnAt > -1 ? nextFnAt : undefined);

    // Prove the slice really is the finalize body before asserting on it
    // (rule 48: a check that cannot classify must fail, not pass).
    expect(fn).toContain("postManifestVendorBill");

    const catchAt = fn.indexOf("catch (err)");
    expect(catchAt).toBeGreaterThan(-1);
    const catchBody = fn.slice(catchAt);

    // Not merely "logManifestEvent appears somewhere after the catch" — that
    // is satisfied by the `else` branch further down the same function. The
    // catch itself must log, and must log a REFUSAL carrying the thrown reason.
    const nextBranchAt = catchBody.indexOf("} else {");
    const withinCatch = catchBody.slice(0, nextBranchAt > -1 ? nextBranchAt : undefined);
    expect(withinCatch).toMatch(
      /logManifestEvent\(\s*manifestId,\s*"vendor_bill_refused",\s*reason,/,
    );
  });

  it("keeps the on-screen banner as well as the durable record", () => {
    // The URL half must NOT have been replaced by the timeline half; the person
    // standing at the screen still needs to be told immediately.
    expect(ACTIONS_CODE).toContain("booksError=");
    expect(ACTIONS_CODE).toContain("books=");
  });

  it("logs AFTER the poster runs, so the note reports a real outcome", () => {
    const idx = ACTIONS_CODE.indexOf("postManifestVendorBill(manifestId");
    const logIdx = ACTIONS_CODE.indexOf("vendor_bill_posted");
    expect(idx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(idx);
  });
});

describe("the wire from intake to the books is still connected", () => {
  it("finalizeManifestAction calls the vendor-bill poster", () => {
    const fn = ACTIONS_CODE.split("export async function finalizeManifestAction")[1] ?? "";
    expect(fn).toContain("postManifestVendorBill");
  });

  it("only raises a payable when something was actually accepted", () => {
    expect(ACTIONS_CODE).toContain("result.activated > 0");
  });
});
