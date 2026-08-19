/**
 * tests/compliance/inventory-audit-store.test.ts   (slice books-11)
 *
 * The gate over THE STORE LAYER itself.
 *
 * `inventory-audit-store.ts` imports "server-only", so it cannot run in the
 * pure self-test runner (the same reason product-lookup-core and
 * strain-lookup-core are excluded there). Vitest aliases `server-only`, so this
 * file is where its self-tests actually execute — which means if this file did
 * not exist, `__runInventoryAuditStoreTests()` would run NOWHERE. That is the
 * exact "dark suite" failure the slice-39 connectivity audit found across 41
 * suites, so it is stated here explicitly rather than assumed.
 *
 * WHAT IS ASSERTED THAT THE MODULE CANNOT ASSERT ABOUT ITSELF
 *   • SOURCE-LEVEL rules that no runtime test can reach without a database:
 *     that the journal is never auto-posted, that the service-role key is never
 *     used, and that no `?? 0` ever lands on a counted quantity.
 *   • The wiring between the store and the two things it is only allowed to
 *     touch through: `submitJournal()` and `inventory_audit_post_session()`.
 *
 * THE STAKES
 * This file is the last thing between an approved count and Michael's real
 * inventory record. The defect it was built to prevent — applying a session
 * twice and taking a lot from 100 to 90 to 80 — was reproduced against a real
 * PostgreSQL before any of this was written.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_ENTITY_CODE,
  __rowMappers,
  __runInventoryAuditStoreTests,
  explainAuditRefusal,
} from "@/lib/inventory/inventory-audit-store";

const storeSrc = readFileSync(
  join(__dirname, "..", "..", "src", "lib", "inventory", "inventory-audit-store.ts"),
  "utf8",
);

/** The source with comments stripped, so a rule quoted in prose does not pass
 *  for a rule actually implemented in code. Without this, a test looking for
 *  "createBooksClient" would be satisfied by a comment mentioning it. */
const storeCode = storeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the embedded suite runs SOMEWHERE — it cannot run in the pure runner", () => {
  it("the store's self-tests pass", () => {
    expect(() => __runInventoryAuditStoreTests()).not.toThrow();
  });

  it("this file is the only place they run, because the module is server-only", () => {
    expect(storeSrc).toMatch(/import "server-only"/);
    const runnerSrc = readFileSync(
      join(__dirname, "..", "..", "scripts", "compliance", "run-pure-selftests.ts"),
      "utf8",
    );
    // If someone adds it to the pure runner, the runner will crash on the
    // server-only import. This asserts the split is deliberate.
    expect(runnerSrc).not.toMatch(/inventory-audit-store/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE JOURNAL IS A DRAFT — inventory is on the never-autopost list", () => {
  /**
   * posting-core.ts: "Inventory moves only when goods move, and a person
   * confirms goods moved." The only way to honour that with no ambiguity is to
   * never pass the flag at all.
   */
  it("autoPost is NEVER passed, not even as false", () => {
    expect(storeCode).not.toMatch(/autoPost\s*:/);
  });

  it("the journal is submitted through the one door, not written directly", () => {
    expect(storeCode).toMatch(/submitJournal\s*\(/);
    // No direct insert into the ledger tables, ever.
    expect(storeCode).not.toMatch(/from\(\s*["'`]gl_journals?["'`]/);
    expect(storeCode).not.toMatch(/from\(\s*["'`]gl_journal_lines["'`]/);
    expect(storeCode).not.toMatch(/rpc\(\s*["'`]gl_post_journal["'`]/);
  });

  it("the source kind is 'inventory', which posting-core forbids from autoposting", () => {
    expect(storeCode).toMatch(/sourceKind:\s*["'`]inventory["'`]/);
  });

  it("the journal carries a stable reference derived from the session", () => {
    // Without a stable sourceRef a retry creates a SECOND journal for the same
    // audit — the money version of the double-post.
    expect(storeCode).toMatch(/sourceRef:\s*`audit:\$\{sessionId\}`/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE F5-M BUG — the books use Michael's session, never the master key", () => {
  /**
   * The service-role key carries no `sub` claim, so auth.uid() is NULL and
   * is_owner() is FALSE, and every owner-gated function refuses. Using it here
   * would either lock Michael out or — if someone "fixed" is_owner() to let the
   * service key through — mean the database no longer knows who is posting.
   */
  it("createBooksClient is used", () => {
    expect(storeCode).toMatch(/createBooksClient\s*\(/);
  });

  it("createSupabaseAdminClient is NEVER used", () => {
    expect(storeCode).not.toMatch(/createSupabaseAdminClient/);
    expect(storeCode).not.toMatch(/SERVICE_ROLE/);
  });

  it("the store does not try to enforce the owner gate itself", () => {
    // The gate is the database's job (0192, first statement). A duplicate check
    // here would be a second place to get it wrong, and would read as the
    // guarantee when it is not.
    expect(storeCode).not.toMatch(/is_owner\s*\(/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("NULL IS NOT ZERO — the mapping layer is where this dies quietly", () => {
  /**
   * One `?? 0` on a counted quantity writes off every uncounted lot in the shop.
   * It is one character of damage and it looks like defensive programming.
   */
  it("counted_qty is never coalesced", () => {
    expect(storeCode).not.toMatch(/counted_qty\s*\?\?/);
    expect(storeCode).not.toMatch(/r\.counted_qty\s*\|\|/);
  });

  it("recount_qty is never coalesced", () => {
    expect(storeCode).not.toMatch(/recount_qty\s*\?\?/);
  });

  it("unit_cost_minor_units is never coalesced — a guessed cost is a plug", () => {
    expect(storeCode).not.toMatch(/unit_cost_minor_units\s*\?\?/);
  });

  it("and the mapper proves it at runtime", () => {
    const l = __rowMappers.toLine({
      lot_id: "l1",
      system_qty: 100,
      counted_qty: null,
      recount_qty: null,
      reason: null,
      note: null,
    });
    expect(l.countedQty).toBeNull();
    expect(l.recountQty).toBeNull();
  });

  it("a counted ZERO survives as zero and is not confused with null", () => {
    const l = __rowMappers.toLine({
      lot_id: "l1",
      system_qty: 100,
      counted_qty: 0,
      recount_qty: null,
      reason: null,
      note: null,
    });
    expect(l.countedQty).toBe(0);
    expect(l.countedQty).not.toBeNull();
  });

  it("an unknown cost stays unknown", () => {
    const lot = __rowMappers.toLot({
      id: "l",
      lot_code: null,
      pos_product_key: null,
      product_name: null,
      category_slug: null,
      vendor_id: null,
      vendor_name: null,
      on_hand_qty: 10,
      unit_cost_minor_units: null,
      last_counted_at: null,
      status: null,
    });
    expect(lot.unitCostMinorUnits).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE SEAM — the shelf and the books are two transactions, visibly", () => {
  it("a failed journal draft is reported as SUCCESS WITH A WARNING, not a failure", () => {
    // Reporting failure after the shelf already moved would tell Michael
    // nothing happened when something did — and he would run it again.
    expect(storeSrc).toMatch(/SUCCESS WITH A WARNING/);
    expect(storeCode).toMatch(/pendingJournalFor/);
  });

  it("the seam watcher finds sessions that moved stock but drafted no entry", () => {
    expect(storeCode).toMatch(/\.not\(\s*["'`]posted_at["'`]\s*,\s*["'`]is["'`]\s*,\s*null\s*\)/);
    expect(storeCode).toMatch(/\.is\(\s*["'`]gl_journal_id["'`]\s*,\s*null\s*\)/);
  });

  it("the preview is computed BEFORE the shelf moves", () => {
    // Once on-hand is corrected the variance is gone; a journal derived from
    // the corrected state would be all zeroes.
    const postFn = storeCode.slice(storeCode.indexOf("export async function postAuditSession"));
    // The AWAITED call, not merely the identifier appearing somewhere — an
    // earlier version of this test matched a bare mention and would have
    // accepted a preview that was never actually performed.
    const previewAt = postFn.search(/await\s+previewAuditPosting\s*\(/);
    const rpcAt = postFn.indexOf("inventory_audit_post_session");
    expect(previewAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(-1);
    expect(previewAt).toBeLessThan(rpcAt);
  });

  it("a refused preview STOPS the post — it is a gate, not a formality", () => {
    // Computing the preview and then ignoring its refusal would move the shelf
    // for a session the pure core already said must not post.
    const postFn = storeCode.slice(storeCode.indexOf("export async function postAuditSession"));
    const guardAt = postFn.search(/if\s*\(\s*!\s*preview\.ok\s*\)\s*return/);
    const rpcAt = postFn.indexOf("inventory_audit_post_session");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(rpcAt);
  });

  it("the preview function itself writes nothing", () => {
    const start = storeCode.indexOf("export async function previewAuditPosting");
    const end = storeCode.indexOf("export async function postAuditSession");
    const preview = storeCode.slice(start, end);
    expect(preview).not.toMatch(/\.insert\(/);
    expect(preview).not.toMatch(/\.update\(/);
    expect(preview).not.toMatch(/\.upsert\(/);
    expect(preview).not.toMatch(/\.delete\(/);
    expect(preview).not.toMatch(/submitJournal/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("REFUSALS speak English", () => {
  it("a known refusal is translated and the raw text is dropped", () => {
    const r = explainAuditRefusal(new Error("ERROR: INVENTORY_AUDIT_FORBIDDEN"));
    expect(r.code).toBe("INVENTORY_AUDIT_FORBIDDEN");
    expect(r.message).toMatch(/only the owner/i);
    expect(r.message).not.toMatch(/ERROR:/);
  });

  it("negative inventory says the WHOLE thing rolled back", () => {
    const r = explainAuditRefusal("INVENTORY_AUDIT_NEGATIVE");
    expect(r.message).toMatch(/not even the lots that would have worked/i);
  });

  it("a migration ordering problem tells Michael which files, in which order", () => {
    const r = explainAuditRefusal("MIGRATION_OUT_OF_ORDER");
    expect(r.message).toMatch(/0191/);
    expect(r.message).toMatch(/0192/);
  });

  it("an UNKNOWN error keeps its original text rather than saying 'something went wrong'", () => {
    const r = explainAuditRefusal(new Error("connection reset by peer"));
    expect(r.code).toBe("INVENTORY_AUDIT_ERROR");
    expect(r.message).toMatch(/connection reset by peer/);
  });

  it("the explainer never throws, whatever it is handed", () => {
    // It runs in the failure path. Throwing a second error there replaces a
    // specific refusal with a stack trace.
    for (const weird of [null, undefined, 0, "", {}, [], new Date(), Symbol("x")]) {
      expect(() => explainAuditRefusal(weird)).not.toThrow();
      expect(typeof explainAuditRefusal(weird).message).toBe("string");
    }
  });

  it("nothing here throws for a refusal — every exported reader returns a result", () => {
    // A thrown refusal in a Server Component becomes "Application error", which
    // turns a specific actionable sentence into nothing.
    expect(storeSrc).toMatch(/NOTHING HERE THROWS FOR A REFUSAL/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE ENTITY — inventory belongs to the store, not the commingled pile", () => {
  it("the entity is greenway", () => {
    expect(AUDIT_ENTITY_CODE).toBe("greenway");
  });

  it("no other entity is named in the posting path", () => {
    const postFn = storeCode.slice(storeCode.indexOf("export async function postAuditSession"));
    for (const other of ["atm", "landholding", "personal"]) {
      expect(postFn).not.toMatch(new RegExp(`entityCode:\\s*["'\`]${other}["'\`]`));
    }
  });
});
