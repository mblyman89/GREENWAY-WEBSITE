/**
 * tests/compliance/r39-vault-0259-parity.test.ts  (R39 S3)
 *
 * Migration 0259 enforces the vendor-vault release rules in the database;
 * releaseVerdict() in src/lib/payments/ach-authorization-core.ts enforces the
 * same rules in the app. If the two disagree, the app would offer a release
 * the database then refuses (or, worse, the database would accept one the app
 * would have refused if someone used the SQL editor).
 *
 * Rule 141: the BEHAVIOUR of the trigger is proven against real Postgres by
 * scripts/recon/vendor-vault-0259-pg-check.sql (run by CI through
 * POST_APPLY_CHECKS) and by 31 mutants in scripts/r39/mutate-0259-sql.sh.
 * Only reading both texts can show they state the SAME numbers, so this does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import {
  CALLBACK_METHODS,
  MIN_CALLBACK_NOTE_CHARS,
  MIN_SOLO_REASON_CHARS,
  releaseVerdict,
} from "@/lib/payments/ach-authorization-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = read("supabase/migrations/0259_vendor_vault_change_control.sql");
const RB = read("supabase/rollbacks/0259_vendor_vault_change_control.rollback.sql");
const RUNBOOK = read("docs/MIGRATIONS_TO_RUN.md");

/** Remove `--` comments so a rule written in a comment cannot satisfy a test. */
const code = (s: string) =>
  s
    .split("\n")
    .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
    .join("\n");
const SQLC = code(SQL);

const base = {
  actorUserId: "s",
  actorCanManage: true,
  changeEnteredByUserId: "m",
  callback: { done: true, method: "phone" as const, numberUnchangedForDays: 400, note: "x".repeat(MIN_CALLBACK_NOTE_CHARS) },
  reason: "",
};

describe("0259 and releaseVerdict() state the same rules", () => {
  it("the callback-note minimum is the same number in both, and the boundary agrees", () => {
    expect(MIN_CALLBACK_NOTE_CHARS).toBe(10);
    expect(SQLC).toMatch(/length\(trim\(new\.release_callback_note\)\), 0\) < 10 then/);
    expect(releaseVerdict(base).ok).toBe(true);
    expect(releaseVerdict({ ...base, callback: { ...base.callback, note: "x".repeat(9) } }).ok).toBe(false);
  });

  it("the solo-reason minimum is the same number in both, and the boundary agrees", () => {
    expect(MIN_SOLO_REASON_CHARS).toBe(20);
    expect(SQLC).toMatch(/is_solo and coalesce\(length\(trim\(new\.release_reason\)\), 0\) < 20 then/);
    const solo = { ...base, actorUserId: "m" };
    expect(releaseVerdict({ ...solo, reason: "r".repeat(20) })).toMatchObject({ ok: true, mode: "solo" });
    expect(releaseVerdict({ ...solo, reason: "r".repeat(19) }).ok).toBe(false);
  });

  it("the callback-method list is identical, in both directions", () => {
    const m = SQLC.match(/release_callback_method in \(([^)]*)\)/);
    expect(m, "vbd_release_method_shape not found").not.toBeNull();
    const sql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(sql).toEqual([...CALLBACK_METHODS].sort());
  });

  it("the release-mode list is exactly the modes releaseVerdict can return", () => {
    const m = SQLC.match(/release_mode in \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const sql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    const modes = new Set<string>();
    for (const actor of ["m", "s"]) {
      for (const author of ["m", null]) {
        const v = releaseVerdict({ ...base, actorUserId: actor, changeEnteredByUserId: author, reason: "r".repeat(25) });
        if (v.ok) modes.add(v.mode);
      }
    }
    expect([...modes].sort()).toEqual(sql);
  });

  it("an unknown author is solo in both (never a silent dual release)", () => {
    expect(SQLC).toMatch(/is_solo := new\.change_entered_by is null or new\.change_entered_by = new\.released_by;/);
    const v = releaseVerdict({ ...base, changeEnteredByUserId: null, reason: "r".repeat(25) });
    expect(v).toMatchObject({ ok: true, mode: "solo", notifyOther: true });
    expect(releaseVerdict({ ...base, changeEnteredByUserId: null }).ok).toBe(false);
  });

  it("the status list the trigger knows equals the 0258 status check", () => {
    const g = SQLC.match(/new\.status not in \(([^)]*)\)/);
    expect(g).not.toBeNull();
    const trig = [...g![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    const s58 = code(read("supabase/migrations/0258_ach_authorizations.sql"));
    const c = s58.match(/vendor_bank_details_status_check\s+check \(status in \(([^)]*)\)\)/);
    expect(c, "0258 vendor_bank_details status check not found").not.toBeNull();
    expect(trig).toEqual([...c![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());
  });
});

describe("0259 guard of the guards", () => {
  it("the trigger covers DELETE as well as insert/update (archive, never delete)", () => {
    expect(SQLC).toMatch(/before insert or update or delete on public\.vendor_bank_details/);
    expect(SQLC).toContain("VAULT_ARCHIVE_ONLY");
  });

  it("the rollback refuses once history exists, before it drops anything, via dynamic SQL", () => {
    const rb = code(RB);
    expect(rb).toContain("ROLLBACK REFUSED: vendor banking change/release/archive history exists");
    expect(rb.indexOf("ROLLBACK REFUSED")).toBeLessThan(rb.indexOf("drop trigger"));
    expect(rb).toMatch(/execute 'select count\(\*\) from public\.vendor_bank_details/);
  });

  it("CI runs the behavioural check and it prints its all-clear line (rule 48)", () => {
    const c = POST_APPLY_CHECKS.find((x) => x.file === "scripts/recon/vendor-vault-0259-pg-check.sql");
    expect(c?.mustPrint).toBe("VAULT 0259 CHECK PASSED");
    expect(read(c!.file)).toContain("VAULT 0259 CHECK PASSED");
    // The check runs AFTER 0258's check (0259 needs 0258's status list).
    const files = POST_APPLY_CHECKS.map((x) => x.file);
    expect(files.indexOf(c!.file)).toBeGreaterThan(files.indexOf("scripts/recon/ach-authorizations-pg-check.sql"));
  });

  it("the runbook tells the owner how to run, check and roll back 0259", () => {
    const i = RUNBOOK.indexOf("## R39 — 0259");
    expect(i, "MIGRATIONS_TO_RUN.md has no 0259 section").toBeGreaterThan(-1);
    const sec = RUNBOOK.slice(i, RUNBOOK.indexOf("\n## ", i + 5) === -1 ? undefined : RUNBOOK.indexOf("\n## ", i + 5));
    for (const h of ["**Without it:**", "**Run it, then:**", "**Check:**", "**Rollback (only if needed):**"]) {
      expect(sec, h).toContain(h);
    }
    expect(sec).toContain("supabase/rollbacks/0259_vendor_vault_change_control.rollback.sql");
    expect(sec).toContain("AFTER 0258");
  });
});
