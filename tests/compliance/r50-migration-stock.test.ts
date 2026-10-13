/**
 * tests/compliance/r50-migration-stock.test.ts   (R50 S2a, bible §1.4)
 *
 * Stock moved over from Cultivera (raw_payload.kind = pos-import-migration or
 * cultivera-reconstructed) was bought and paid for before the switch. It is
 * counted ONCE, in the opening inventory balance. Four money doors must never
 * treat it as a purchase: vendor payables, the Sage purchases export, the
 * vendor bill and the goods receipt. This file pins:
 *
 *   1. the pure core's behaviour (including the PostgREST null trap),
 *   2. that each door is actually wired (reachability, by source), and
 *   3. that the intake actions treat the refusal as "none needed", not an
 *      error banner, and log the quiet event.
 *
 * The real-database before/after is in scripts/recon/r50-s2a (measured on
 * PG15 + PostgREST 12 with all migrations applied).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MIGRATION_MANIFEST_KINDS,
  NOT_MIGRATION_OR,
  PAYLOAD_KIND_SELECT,
  isMigrationKind,
  migrationManifestCount,
  migrationSkippedWarning,
  migrationStockRefusal,
  withoutMigrationManifests,
  __runMigrationStockCoreTests,
} from "../../src/lib/accounting/migration-stock-core";
import {
  POS_IMPORT_MANIFEST_KIND,
  RECONSTRUCTED_MANIFEST_KIND,
} from "../../src/lib/inventory/cultivera-manifest-group-core";
import {
  MIGRATION_STOCK_CODES,
  accountingStatus,
  booksResultText,
  isMigrationStockResult,
  isKnownEventType,
  labelForEvent,
  receiptEventFor,
} from "../../src/lib/inventory/manifest-event-labels-core";
import { VENDOR_BILL_SERVICE_CODES } from "../../src/lib/accounting/vendor-bill-service";
import { RECEIPT_SERVICE_CODES } from "../../src/lib/accounting/receipt-service";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("migration-stock-core (pure)", () => {
  it("self-tests all pass and meet the registered floor", () => {
    const r = __runMigrationStockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(31);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(
      /assertRan\("migration-stock-core", __runMigrationStockCoreTests\(\), 31\)/,
    );
  });

  it("kinds are exactly the two the migration writes", () => {
    expect([...MIGRATION_MANIFEST_KINDS].sort()).toEqual(
      [POS_IMPORT_MANIFEST_KIND, RECONSTRUCTED_MANIFEST_KIND].sort(),
    );
    expect(Object.isFrozen(MIGRATION_MANIFEST_KINDS)).toBe(true);
  });

  it("isMigrationKind is an exact string match", () => {
    expect(isMigrationKind("pos-import-migration")).toBe(true);
    expect(isMigrationKind("cultivera-reconstructed")).toBe(true);
    for (const k of [null, undefined, "", "wcia", "POS-IMPORT-MIGRATION", " pos-import-migration", 1, {}]) {
      expect(isMigrationKind(k)).toBe(false);
    }
  });

  it("the server filter keeps null kinds (the NOT IN trap) and names both kinds", () => {
    expect(NOT_MIGRATION_OR).toBe(
      "raw_payload->>kind.is.null,raw_payload->>kind.not.in.(pos-import-migration,cultivera-reconstructed)",
    );
    expect(PAYLOAD_KIND_SELECT).toBe("payload_kind:raw_payload->>kind");
  });

  it("filters and counts rows; null and odd kinds stay", () => {
    const rows = [
      { id: "a", payload_kind: "wcia" },
      { id: "b", payload_kind: null },
      { id: "c", payload_kind: "pos-import-migration" },
      { id: "d", payload_kind: "cultivera-reconstructed" },
      { id: "e" },
    ];
    expect(withoutMigrationManifests(rows).map((r) => r.id)).toEqual(["a", "b", "e"]);
    expect(migrationManifestCount(rows)).toBe(2);
  });

  it("messages are plain English and name the delivery", () => {
    expect(migrationSkippedWarning(1)).toMatch(/^1 Cultivera migration manifest left out: /);
    expect(migrationSkippedWarning(2)).toMatch(/^2 Cultivera migration manifests left out: /);
    expect(migrationStockRefusal("bill", "0001108")).toMatch(/^No vendor bill was recorded: 0001108 holds stock moved over from Cultivera/);
    expect(migrationStockRefusal("receipt", "  ")).toMatch(/^Nothing was posted to the books: this delivery holds/);
  });
});

describe("event labels: migration is quiet, never a problem", () => {
  it("both codes are declared by their services", () => {
    expect([...MIGRATION_STOCK_CODES].sort()).toEqual(["BILL_MIGRATION_STOCK", "RECEIPT_MIGRATION_STOCK"]);
    expect(VENDOR_BILL_SERVICE_CODES).toContain("BILL_MIGRATION_STOCK");
    expect(RECEIPT_SERVICE_CODES).toContain("RECEIPT_MIGRATION_STOCK");
  });

  it("isMigrationStockResult needs a refusal with a migration code", () => {
    expect(isMigrationStockResult({ ok: false, code: "BILL_MIGRATION_STOCK" })).toBe(true);
    expect(isMigrationStockResult({ ok: false, code: "RECEIPT_MIGRATION_STOCK" })).toBe(true);
    expect(isMigrationStockResult({ ok: true, code: "BILL_MIGRATION_STOCK" })).toBe(false);
    expect(isMigrationStockResult({ ok: false, code: "BILL_POST_FAILED" })).toBe(false);
  });

  it("receiptEventFor routes the migration refusal to its own event", () => {
    expect(receiptEventFor({ ok: false, code: "RECEIPT_MIGRATION_STOCK", message: "x" }).eventType).toBe(
      "receipt_migration_stock",
    );
    expect(receiptEventFor({ ok: false, code: "RECEIPT_POST_FAILED", message: "x" }).eventType).toBe("receipt_refused");
  });

  it("labels exist, are accounting, and are not problems", () => {
    for (const t of ["receipt_migration_stock", "vendor_bill_migration_stock"]) {
      expect(isKnownEventType(t)).toBe(true);
      const l = labelForEvent(t);
      expect(l.group).toBe("accounting");
      expect(l.problem).toBe(false);
    }
  });

  it("accountingStatus shows migration for both steps", () => {
    const s = accountingStatus([
      { event_type: "receipt_migration_stock", created_at: "2026-10-12T10:00:00Z" },
      { event_type: "vendor_bill_migration_stock", created_at: "2026-10-12T10:00:01Z" },
    ] as never);
    expect(s.receipt).toBe("migration");
    expect(s.bill).toBe("migration");
  });

  it("booksResultText says nothing was recorded, on purpose", () => {
    expect(booksResultText("BILL_MIGRATION_STOCK")).toMatch(/on purpose/);
    expect(booksResultText("RECEIPT_MIGRATION_STOCK")).toMatch(/on purpose/);
  });
});

describe("wiring: every money door excludes migration stock", () => {
  it("vendor payables filters on the server (null-safe) AND in code", () => {
    const s = src("src/lib/payments/vendor-payables-store.ts");
    expect(s).toMatch(/\.select\(`id, manifest_number, vendor_id, vendor_label, status, accepted_at, \$\{PAYLOAD_KIND_SELECT\}`\)/);
    expect(s).toMatch(/\.in\("status", statuses\)\s*(\/\/[^\n]*\n\s*)*\.or\(NOT_MIGRATION_OR\)/);
    expect(s).toMatch(/const mrows = withoutMigrationManifests\(mrowsAll\);/);
    // The trap form must never appear.
    expect(s).not.toMatch(/\.not\(\s*"raw_payload->>kind"/);
  });

  it("Sage purchases export drops them and says so in both paths", () => {
    const s = src("src/lib/accounting/sage-exports.ts");
    expect(s).toMatch(/created_at, \$\{PAYLOAD_KIND_SELECT\}`\)/);
    expect(s).toMatch(/const manifests = withoutMigrationManifests\(manifestsAll\);/);
    expect(s).toMatch(/if \(migrationNote\) empty\.warnings\.push\(migrationNote\);/);
    expect(s).toMatch(/if \(migrationNote\) result\.warnings\.push\(migrationNote\);/);
  });

  it("R50 S11: Sage adjustments export leaves the Oct 30 count on migration stock out and says so in both paths", () => {
    const s = src("src/lib/accounting/sage-exports.ts");
    expect(s).toMatch(/const adjustments = adjustmentsAll\.filter\(\(a\) => !isMigrationCountAdjustment\(a\)\);/);
    expect(s).toMatch(/if \(countNote\) empty\.warnings\.push\(countNote\);/);
    expect(s).toMatch(/if \(countNote\) result\.warnings\.push\(countNote\);/);
    // The writer of those notes is the count core; the exclusion matches exactly its shape.
    const core = src("src/lib/pos/cultivera-count-core.ts");
    expect(core).toContain("return `R50 Oct-30 count ${sessionId}: barcode ${line.lotCode} counted");
  });

  for (const [file, code, door] of [
    ["src/lib/accounting/vendor-bill-service.ts", "BILL_MIGRATION_STOCK", "bill"],
    ["src/lib/accounting/receipt-service.ts", "RECEIPT_MIGRATION_STOCK", "receipt"],
  ] as const) {
    it(`${door}: refuses before any lot is read`, () => {
      const s = src(file);
      expect(s).toMatch(/vendor_label, \$\{PAYLOAD_KIND_SELECT\}`\)/);
      const guard = s.indexOf(`return fail("${code}", migrationStockRefusal("${door}", manifest.manifest_number));`);
      const check = s.indexOf("if (isMigrationKind((manifest as { payload_kind?: unknown }).payload_kind))");
      const lots = s.indexOf('.from("inventory_lots")');
      expect(check).toBeGreaterThan(0);
      expect(guard).toBeGreaterThan(check);
      expect(lots).toBeGreaterThan(guard);
    });
  }

  it("intake actions: migration is 'none needed', with its own quiet event", () => {
    const s = src("src/app/admin/inventory/intake/actions.ts");
    expect(s).toMatch(/booksNote = billed\.ok \|\| isMigrationStockResult\(billed\)/);
    expect(s).toMatch(/booksNote = booked\.ok \|\| isMigrationStockResult\(booked\)/);
    expect(s).toMatch(/return booked\.ok \|\| isMigrationStockResult\(booked\) \? "" :/);
    expect(s).toMatch(
      /if \(isMigrationStockResult\(billed\)\) \{[\s\S]{0,300}logManifestEvent\(manifestId, "vendor_bill_migration_stock"/,
    );
  });
});
