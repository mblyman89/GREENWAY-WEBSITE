/**
 * R41 S15: leftovers that could be done without guessing.
 *
 *   1. R90 (Nacha, effective March 17, 2028) is in ACH_CODES with its label
 *      copied verbatim from a NEW mirror of Nacha's rule page, not invented;
 *      logging one holds the payee as a possible-fraud return;
 *   2. the rule watch marks R90 as coded (no more "code change" reminder);
 *   3. scripts/r41/mutate-s3-app.py: the stale "key-check-removed" anchor (it
 *      matched 0 times after sealFile changed) is re-anchored and the run is
 *      clean again; every app mutation script's anchors resolve exactly once;
 *   4. docs and public-repo rules.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACH_CODES, ACH_CODE_SOURCE, classifyAchCode } from "@/lib/payments/ach-authorization-core";
import { NACHA_RULE_WATCH, ruleWatchStatus } from "@/lib/payments/ach-calendar-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIRROR = "docs/authorities/ach/nacha-r90-sanctions-return-code.txt";

describe("R90 from the Nacha mirror", () => {
  const m = flat(read(MIRROR));
  it("the mirror names its source URL and an HTML hash, and has the rule's title and date", () => {
    expect(m).toMatch(/^SOURCE: https:\/\/www\.nacha\.org\/rules\/new-return-reason-code-sanctions-compliance-obligations /);
    expect(m).toMatch(/sha256 of fetched HTML: [0-9a-f]{64}/);
    expect(m).toContain("New Return Reason Code for Sanctions Compliance Obligations");
    expect(m).toContain("March 17, 2028");
  });
  it("the label is the title Nacha gives R90, verbatim", () => {
    expect(ACH_CODE_SOURCE.R90).toBe("ach/nacha-r90-sanctions-return-code.txt");
    expect(m).toContain(`R90 (${ACH_CODES.R90.label}) will be added to the return reason code table.`);
  });
  it("an R90 is a known return, held as possible fraud, never a NOC; R16 keeps the newsletter label", () => {
    const c = classifyAchCode(" r90 ");
    expect(c).toMatchObject({ known: true, isNoc: false, action: "hold_investigate_fraud" });
    expect(ACH_CODES.R16.label).toBe("Account frozen");
    expect(ACH_CODES.R90.plain).toContain("1-800-562-8761");
    expect(ACH_CODES.R90.plain).toContain("Do not send it again");
  });
  it("the advice to work it out with the bank is Nacha's own words", () => {
    expect(m).toContain("the ODFI must take action and determine further requirements for the entry and entity relationships, working with its client.");
  });
  it("the README lists the mirror", () => {
    expect(read("docs/authorities/ach/README.md")).toContain("| nacha-r90-sanctions-return-code.txt | https://www.nacha.org/rules/new-return-reason-code-sanctions-compliance-obligations |");
  });
});

describe("rule watch", () => {
  it("R90 is marked coded and no longer reminds", () => {
    const r = NACHA_RULE_WATCH.find((x) => x.id === "r90-sanctions-2028-03-17")!;
    expect(r.impact).toBe("done");
    expect(r.greenway).toContain("Done in R41 S15");
    expect(ruleWatchStatus(r, "2028-02-01").remind).toBe(false);
  });
});

describe("mutation script anchors", () => {
  it("every app mutation script's anchors match exactly once (no stale anchor like key-check-removed)", () => {
    const dir = join(ROOT, "scripts/r41");
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^mutate-.*\.py$/.test(x) && !/^mutate-\d{4}-sql\.py$/.test(x))) {
      const src = readFileSync(join(dir, f), "utf8");
      const consts = new Map<string, string>();
      for (const mm of src.matchAll(/^([A-Z][A-Z0-9_]*) = "([^"]+)"$/gm)) consts.set(mm[1], mm[2]);
      const start = src.indexOf("\nM = [");
      if (start < 0) continue;
      const body = src.slice(start, src.indexOf("\n]\n", start));
      // one-line tuples: ("name", FILE, "anchor" | 'anchor', ...)
      for (const mm of body.matchAll(/^\s{4}\("([^"]+)", ([A-Z][A-Z0-9_]*), ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),/gm)) {
        const file = consts.get(mm[2]);
        if (!file) continue;
        const lit = mm[3];
        // single pass, like Python: \\ \n \t \r \" \'
        const anchor = lit.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[c] ?? c);
        const n = read(file).split(anchor).length - 1;
        if (n !== 1) bad.push(`${f} ${mm[1]} (${n})`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("mutate-s3-app.py re-anchors key-check-removed on the releaseLoop key check", () => {
    const s = read("scripts/r41/mutate-s3-app.py");
    expect(s).toContain(`("key-check-removed", LS, '  if (!isAtRestEncryptionConfigured()) return { ok: false, error: LEDGER_NO_KEY };\\n  // R41 S5: Schedule A.'`);
    expect(read("scripts/r41/mutate-s3-app.last.log")).toMatch(/killed {3}key-check-removed/);
  });
});

describe("S15 docs and public-repo rules", () => {
  it("the roadmap has the S15 row and detail", () => {
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S15 | Leftovers without guessing");
    expect(r).toContain("## S15 in detail");
  });
  it("no emails, one phone, no long digit runs in the new files", () => {
    for (const f of [MIRROR, "tests/compliance/r41-s15-leftovers.test.ts"]) {
      const s = read(f).replace(/[0-9a-f]{64}/g, "");
      expect(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? [], f).toEqual([]);
      expect((s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? []).filter((p) => !p.endsWith("562-8761")), f).toEqual([]);
      expect(s, f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
});
