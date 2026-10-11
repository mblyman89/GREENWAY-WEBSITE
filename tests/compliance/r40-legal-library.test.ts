/**
 * R40 — the Legal library. The owner asked for "verbatim text from rules and
 * regulations" and "relevant court cases". These tests make "verbatim" a
 * machine-checked promise, not a claim:
 *   - every quote is an exact substring of the mirrored official source,
 *   - the generator reproduces the checked-in file byte-for-byte,
 *   - a single changed character in a quote is caught (tested below),
 *   - every link into the back office points at a page that exists.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACH_LEGAL_LIBRARY, type LegalEntry } from "@/lib/payments/ach-legal-library";

const ROOT = join(__dirname, "..", "..");
const AUTH = join(ROOT, "docs", "authorities");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function quoteIsVerbatim(e: Pick<LegalEntry, "sourceFile" | "quote">): boolean {
  const src = flat(readFileSync(join(AUTH, e.sourceFile), "utf8"));
  return src.includes(flat(e.quote));
}

/** Map an in-app link to the Next.js page file that must serve it. */
function pageFileFor(link: string): string {
  const path = link.split(/[?#]/)[0].replace(/\/$/, "");
  return join(ROOT, "src", "app", ...path.split("/").filter(Boolean), "page.tsx");
}

const OFFICIAL_HOSTS = [
  "media.ca1.uscourts.gov",
  "ecf.ca8.uscourts.gov",
  "www.ca5.uscourts.gov",
  "www.govinfo.gov",
  "app.leg.wa.gov",
  "www.ecfr.gov",
];

describe("R40 legal library — verbatim, sourced, linked", () => {
  it("has the 13 entries the generator writes, with unique ids", () => {
    expect(ACH_LEGAL_LIBRARY.length).toBe(13);
    const ids = ACH_LEGAL_LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACH_LEGAL_LIBRARY.filter((e) => e.kind === "case").length).toBe(4);
  });

  it.each(ACH_LEGAL_LIBRARY.map((e) => [e.id, e] as const))("%s quote is verbatim in its mirrored source", (_id, e) => {
    expect(existsSync(join(AUTH, e.sourceFile))).toBe(true);
    expect(e.quote.length).toBeGreaterThan(40);
    expect(quoteIsVerbatim(e)).toBe(true);
  });

  it("the verbatim check is real: one changed character is caught", () => {
    for (const e of ACH_LEGAL_LIBRARY) {
      const q = e.quote;
      const k = Math.floor(q.length / 2);
      const mutated = q.slice(0, k) + (q[k] === "x" ? "y" : "x") + q.slice(k + 1);
      expect(quoteIsVerbatim({ sourceFile: e.sourceFile, quote: mutated })).toBe(false);
    }
  });

  it("every mirrored source carries its provenance header naming the official URL", () => {
    for (const e of ACH_LEGAL_LIBRARY) {
      const head = readFileSync(join(AUTH, e.sourceFile), "utf8").slice(0, 1200);
      const host = new URL(e.source).host;
      expect(head.includes(host), `${e.sourceFile} header should name ${host}`).toBe(true);
    }
  });

  it("every source URL is on an official court / legislature / government host", () => {
    for (const e of ACH_LEGAL_LIBRARY) {
      const u = new URL(e.source);
      expect(["http:", "https:"]).toContain(u.protocol);
      expect(OFFICIAL_HOSTS).toContain(u.host);
    }
  });

  it("cases carry facts; every entry has plain English and a protection", () => {
    for (const e of ACH_LEGAL_LIBRARY) {
      expect(e.plainEnglish.length).toBeGreaterThan(40);
      expect(e.howWeProtectYou.length).toBeGreaterThan(40);
      if (e.kind === "case") expect(e.whatHappened.length).toBeGreaterThan(40);
    }
  });

  it("every in-app link points at a page that exists", () => {
    for (const e of ACH_LEGAL_LIBRARY) {
      expect(e.appLink.startsWith("/admin")).toBe(true);
      expect(existsSync(pageFileFor(e.appLink)), `${e.id} -> ${e.appLink}`).toBe(true);
    }
  });

  it("the generator is idempotent: re-running reproduces the checked-in file byte-for-byte", () => {
    const out = join(mkdtempSync(join(tmpdir(), "r40-legal-")), "lib.ts");
    execFileSync("python3", [join(ROOT, "scripts", "r40", "gen-legal-library.py")], {
      env: { ...process.env, R40_LEGAL_OUT: out },
      stdio: "pipe",
    });
    expect(readFileSync(out, "utf8")).toBe(readFileSync(join(ROOT, "src", "lib", "payments", "ach-legal-library.ts"), "utf8"));
  });

  it("verified reporter citations only: Patco and Choice Escrow cite F.3d; the unpublished ones cite docket numbers", () => {
    const byId = Object.fromEntries(ACH_LEGAL_LIBRARY.map((e) => [e.id, e]));
    expect(byId["case-patco-one-size-fits-all"].citation).toContain("684 F.3d 197");
    expect(byId["case-choice-escrow-declined-dual-control"].citation).toContain("754 F.3d 611");
    expect(byId["case-apache-call-number-on-file"].citation).not.toMatch(/F\. ?App/);
    expect(byId["case-beau-townsend-best-position"].citation).not.toMatch(/F\. ?App/);
  });
});
