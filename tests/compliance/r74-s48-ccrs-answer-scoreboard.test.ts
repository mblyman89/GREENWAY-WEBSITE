/**
 * R74 S48 (Round 29): answer files never marked uploaded, unanswered-files
 * warning, in-flight strain/area not re-sent, Answer-all, test scoreboard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runCcrsAnswerTests } from "../../src/lib/compliance/ccrs-answer-core";
import { __runCcrsScoreboardTests, SCORE_TESTS } from "../../src/lib/compliance/ccrs-scoreboard-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S48 pure cores", () => {
  it("answer core", () => expect(__runCcrsAnswerTests()).toEqual({ passed: 16, failed: 0 }));
  it("scoreboard core", () => {
    expect(__runCcrsScoreboardTests()).toEqual({ passed: 14, failed: 0 });
    expect(SCORE_TESTS.filter((t) => t.required).length).toBe(13);
  });
});

describe("R74 S48 wiring", () => {
  const ACT = read("src/app/admin/compliance/ccrs/mail-actions.ts");
  const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");
  const STORE = read("src/lib/compliance/ccrs-scoreboard-store.ts");
  it("answers mark a file uploaded from the email when it never was (audited)", () => {
    expect(ACT).toContain("ccrs.file.uploaded_from_email");
    expect(ACT).toContain("ccrs.mail.answer_all");
  });
  it("the hub shows the warning, the Answer-all button and the scoreboard", () => {
    expect(PAGE).toContain('data-testid="ccrs-unanswered-warning"');
    expect(PAGE).toContain("applyAll: applyAllCcrsMailAction,");
    expect(PAGE).toContain("<CcrsScoreboardPanel read={scoreboard}");
  });
  it("scoreboard reads are bounded (never 1000+)", () => {
    const code = STORE.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/\.limit\(/);
    for (const m of code.matchAll(/\.limit\(([^)]*)\)/g)) expect(m[1]).not.toMatch(/\d{4,}/);
  });
});
