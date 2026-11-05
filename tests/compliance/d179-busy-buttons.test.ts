/**
 * D179 (S2 "busy buttons"): owner, 2026-11-05 — every button "turns gray and
 * shows a spinner with 'Saving…' the moment it's tapped; can't be tapped
 * again; ends with a big green check: 'Saved. You're done.'"
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  __runSaveOutcomeTests,
  saveOutcomeFromUrls,
  OUTCOME_SUCCESS_TITLE,
  OUTCOME_ERROR_TITLE,
} from "@/lib/admin/save-outcome-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

describe("D179 save-outcome core", () => {
  it("self-test runs", () => {
    const r = __runSaveOutcomeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(28);
  });
  it("the owner's exact words", () => {
    expect(OUTCOME_SUCCESS_TITLE).toBe("Saved. You're done.");
    expect(OUTCOME_ERROR_TITLE).toBe("That did not save.");
  });
  it("never claims success without proof", () => {
    const U = "https://g.test/admin/x";
    expect(saveOutcomeFromUrls(U, U).kind).toBe("none");
    expect(saveOutcomeFromUrls(U, `${U}?tab=a`).kind).toBe("none");
    expect(saveOutcomeFromUrls(U, `${U}?saved=1&error=boom%20here`).kind).toBe("error");
  });
});

describe("D179 PendingKeeper shows the landing card", () => {
  const src = read("src/components/admin/ux/PendingKeeper.tsx");
  it("judges only form saves, from the URLs", () => {
    expect(src).toContain('if (judge && rec.kind === "form")');
    expect(src).toContain("saveOutcomeFromUrls(rec.hrefAtStart, window.location.href)");
  });
  it("a new press clears the old card and does not judge the replaced one", () => {
    expect(src).toContain("clearPending(false); // one pending at a time");
    expect(src).toContain('setOutcome({ kind: "none" });');
  });
  it("errors are announced assertively; card is dismissable and times out", () => {
    expect(src).toContain('role={outcome.kind === "error" ? "alert" : "status"}');
    expect(src).toContain("OUTCOME_SUCCESS_MS : OUTCOME_ERROR_MS");
    expect(src).toContain('aria-label="Dismiss"');
  });
  it("css exists", () => {
    const css = read("src/app/globals.css");
    for (const c of [".gw-save-outcome {", ".gw-save-outcome-success", ".gw-save-outcome-error"]) expect(css).toContain(c);
  });
});

describe("D179 no confirm() inside a server-action form's onSubmit (stuck-busy class)", () => {
  it("every admin confirm-before-submit asks on the button click", () => {
    const offenders: string[] = [];
    for (const f of [...walk("src/app/admin"), ...walk("src/components/admin")]) {
      const s = read(f);
      const re = /onSubmit=\{\(e\)\s*=>\s*\{[^}]*confirm\(/g;
      if (re.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it("the three fixed forms confirm on click", () => {
    for (const f of [
      "src/components/admin/StoreHoursEditor.tsx",
      "src/app/admin/plaid/RemoveConnectionButton.tsx",
      "src/app/admin/settings/banking/approvals/ApprovalButtons.tsx",
    ]) {
      expect(read(f)).toMatch(/onClick=\{\(e\) => \{\s*[^}]{0,60}window\.confirm\(/);
    }
  });
});

describe("D179 every async button guards against a second press", () => {
  it("admin + iPad: an async onClick button always has disabled=", () => {
    const offenders: string[] = [];
    const files = [
      ...walk("src/app/admin"),
      ...walk("src/components/admin"),
      ...walk("src/app/(site)/pos"),
    ];
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/<button\b([^<]*?)>/g)) {
        const tag = m[1];
        if (/onClick=\{\s*(async|\(\)\s*=>\s*void\s)/.test(tag) && !tag.includes("disabled")) {
          // Clipboard copy is instant and idempotent.
          if (s.slice(m.index, m.index + 300).includes("navigator.clipboard")) continue;
          if (/void (loadHistory|toggleHistory)\(/.test(tag)) continue; // read-only, sequence-stamped
          offenders.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
  it("vendor ACH page (public, outside the admin keeper) shows busy state", () => {
    const s = read("src/app/(site)/vendor-ach/[token]/page.tsx");
    expect(s).toContain('busy="Sending the code…"');
    expect(s).toContain('busy="Checking…"');
    expect(s).not.toMatch(/<button type="submit" className=\{bigButton\}>/);
  });
});
