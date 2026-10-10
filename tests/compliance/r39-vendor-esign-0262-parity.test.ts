/**
 * tests/compliance/r39-vendor-esign-0262-parity.test.ts  (R39 S7)
 *
 * Migration 0262 enforces the vendor e-sign rules in the database;
 * src/lib/payments/vendor-esign-core.ts enforces the same rules in the app.
 * If they disagree, the vendor would be offered a step the database refuses
 * (a dead end for a vendor we want on ACH), or the database would accept
 * something the app means to refuse.
 *
 * BEHAVIOUR is proven against real Postgres by
 * scripts/recon/vendor-esign-0262-pg-check.sql (CI runs it via
 * POST_APPLY_CHECKS) and by 84 SQL mutants in scripts/r39/mutate-0262-sql.py.
 * This file shows the two texts state the SAME numbers and lists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import {
  CONSENT_FRESH_MS,
  INVITE_MAX_DAYS,
  INVITE_TTL_DAYS,
  OPEN_STATES,
  PROOF_KINDS,
  VENDOR_ESIGN_STATES,
  VENDOR_OTP_MAX_ATTEMPTS,
  VENDOR_OTP_MAX_SENDS,
  VENDOR_PROOF_MAX_BYTES,
  canMoveVendorEsign,
  checkSigner,
  proofDocKind,
} from "@/lib/payments/vendor-esign-core";
import { DOC_MIME_TYPES, MAX_DOC_BYTES } from "@/lib/payments/ach-document-intake-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = read("supabase/migrations/0262_vendor_ach_esign.sql");
const RB = read("supabase/rollbacks/0262_vendor_ach_esign.rollback.sql");
const RUNBOOK = read("docs/MIGRATIONS_TO_RUN.md");
const MUT_LOG = read("scripts/r39/mutate-0262-sql.last.log");

/** Remove `--` comments so a rule written in a comment cannot satisfy a test. */
const code = (s: string) =>
  s
    .split("\n")
    .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
    .join("\n");
const SQLC = code(SQL);
const quoted = (s: string) => [...s.matchAll(/'([a-z_/]+)'/g)].map((m) => m[1]);

describe("0262 states and moves agree with vendor-esign-core", () => {
  it("the state CHECK lists exactly VENDOR_ESIGN_STATES", () => {
    const m = /check \(state in \(([^)]*)\)\)/.exec(SQLC);
    expect(m, "state CHECK not found").not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...VENDOR_ESIGN_STATES].sort());
  });

  it("every move the trigger allows is allowed by canMoveVendorEsign, and vice versa", () => {
    const sqlMoves: Record<string, string[]> = {};
    for (const m of SQLC.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) sqlMoves[m[1]] = quoted(m[2]);
    expect(Object.keys(sqlMoves).sort()).toEqual(["code_sent", "consented", "sent", "signed"]);
    let compared = 0;
    for (const from of VENDOR_ESIGN_STATES) {
      for (const to of VENDOR_ESIGN_STATES) {
        if (from === to) continue;
        expect(canMoveVendorEsign(from, to), `${from}->${to}`).toBe((sqlMoves[from] ?? []).includes(to));
        compared++;
      }
    }
    expect(compared).toBe(42); // 7 x 6: the loop really ran
    expect(SQLC).toContain("if old.state in ('countersigned', 'rejected', 'cancelled') then");
  });

  it("the one-open-invite index covers exactly OPEN_STATES", () => {
    const m = /vendor_esign_one_open_per_vendor[\s\S]*?where state in \(([^)]*)\)/.exec(SQLC);
    expect(m).not.toBeNull();
    expect(quoted(m![1]).sort()).toEqual([...OPEN_STATES].sort());
  });
});

describe("0262 numbers agree with vendor-esign-core", () => {
  it("code sends and attempts", () => {
    expect(SQLC).toContain(`check (otp_sends between 0 and ${VENDOR_OTP_MAX_SENDS})`);
    expect(SQLC).toContain(`check (otp_attempts between 0 and ${VENDOR_OTP_MAX_ATTEMPTS})`);
  });

  it("link lifetime: the app's 14 days is inside the database's 30-day ceiling", () => {
    expect(SQLC).toContain(`expires_at <= invited_at + interval '${INVITE_MAX_DAYS} days'`);
    expect(INVITE_TTL_DAYS).toBeLessThanOrEqual(INVITE_MAX_DAYS);
  });

  it("consent freshness: 24 hours in both", () => {
    expect(CONSENT_FRESH_MS).toBe(24 * 60 * 60 * 1000);
    expect(SQLC).toContain("if s.code_verified_at < now() - interval '24 hours' then");
  });

  it("bank proof: mime list, kinds and size agree; the app's 4 MB is under the database's 25 MB", () => {
    const mm = /proof_mime in \(([^)]*)\)/.exec(SQLC);
    expect(mm).not.toBeNull();
    expect(quoted(mm![1]).sort()).toEqual([...DOC_MIME_TYPES].sort());
    const km = /proof_kind in \(([^)]*)\)/.exec(SQLC);
    expect(km).not.toBeNull();
    expect([...new Set(PROOF_KINDS.map(proofDocKind))].sort()).toEqual(quoted(km![1]).sort());
    expect(SQLC).toContain(`proof_byte_size <= ${MAX_DOC_BYTES}`);
    expect(VENDOR_PROOF_MAX_BYTES).toBeLessThan(MAX_DOC_BYTES);
    expect(VENDOR_PROOF_MAX_BYTES).toBeLessThan(4.5 * 1000 * 1000); // Vercel Functions request body limit
  });

  it("signer name and title: the app never accepts what the function refuses", () => {
    const sqlName = (n: string) => n.trim().length >= 3 && n.trim().length <= 120 && n.trim().includes(" ");
    const sqlTitle = (t: string) => t.trim().length >= 2 && t.trim().length <= 80;
    expect(SQLC).toContain("position(' ' in trim(p_signer_name)) = 0");
    expect(SQLC).toContain("length(trim(p_signer_title)) > 80");
    for (const [n, t] of [["Ann Lee", "Owner"], ["Ann", "Owner"], ["Ann Lee", "O"], ["A B", "CF"], ["x".repeat(121) + " y", "Owner"], ["Ann Lee", "t".repeat(81)]]) {
      const app = checkSigner(n, t).ok;
      if (app) expect(sqlName(n) && sqlTitle(t), `${n}/${t}`).toBe(true);
      if (!(sqlName(n) && sqlTitle(t))) expect(app, `${n}/${t}`).toBe(false);
    }
  });
});

describe("0262 guard of the guards", () => {
  it("the trigger covers DELETE as well as UPDATE, and signed rows are kept", () => {
    expect(SQLC).toMatch(/before update or delete on public\.vendor_esign_invites/);
    expect(SQLC).toContain("VENDOR_ESIGN_KEEP");
  });

  it("the transition check runs before the frozen-signed check (so signed->cancelled says TRANSITION)", () => {
    expect(SQLC.indexOf("VENDOR_ESIGN_TRANSITION")).toBeGreaterThan(-1);
    expect(SQLC.indexOf("VENDOR_ESIGN_TRANSITION")).toBeLessThan(SQLC.indexOf("VENDOR_ESIGN_SIGNED"));
  });

  it("all three functions are service_role only and NOT security definer", () => {
    expect(SQLC).not.toMatch(/security definer/i);
    for (const fn of ["vendor_esign_complete", "vendor_esign_countersign", "vendor_esign_reject"]) {
      expect(SQLC).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQLC).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
    }
  });

  it("the rollback refuses once anything is signed, before it drops anything", () => {
    const rb = code(RB);
    expect(rb).toContain("ROLLBACK REFUSED: vendor_esign_invites holds signed invites");
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop function"));
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop table"));
  });

  it("CI runs the behavioural check, after 0261's, and it prints its all-clear line", () => {
    const c = POST_APPLY_CHECKS.find((x) => x.file === "scripts/recon/vendor-esign-0262-pg-check.sql");
    expect(c?.mustPrint).toBe("VENDOR 0262 CHECK PASSED");
    expect(read(c!.file)).toContain("VENDOR 0262 CHECK PASSED");
    const files = POST_APPLY_CHECKS.map((x) => x.file);
    expect(files.indexOf(c!.file)).toBeGreaterThan(files.indexOf("scripts/recon/ach-esign-0261-pg-check.sql"));
    expect(files.indexOf("scripts/recon/ach-esign-0261-pg-check.sql")).toBeGreaterThan(-1);
  });

  it("the last recorded SQL mutation run killed every mutant", () => {
    const m = /killed (\d+)\/(\d+) survivors \[\]/.exec(MUT_LOG);
    expect(m, "mutation log has no clean summary").not.toBeNull();
    expect(Number(m![1])).toBe(Number(m![2]));
    expect(Number(m![2])).toBeGreaterThanOrEqual(84);
  });

  it("the runbook tells the owner how to run, check and roll back 0262", () => {
    const i = RUNBOOK.indexOf("## R39 — 0262");
    expect(i, "MIGRATIONS_TO_RUN.md has no 0262 section").toBeGreaterThan(-1);
    const j = RUNBOOK.indexOf("\n## ", i + 5);
    const sec = RUNBOOK.slice(i, j === -1 ? undefined : j);
    for (const h of ["**Without it:**", "**Run it, then:**", "**Check:**", "**Rollback (only if needed):**"]) expect(sec, h).toContain(h);
    expect(sec).toContain("supabase/rollbacks/0262_vendor_ach_esign.rollback.sql");
    expect(sec).toContain("AFTER 0258, 0259, 0260 and 0261");
    expect(sec).toContain("VENDOR 0262 CHECK PASSED");
  });
});
