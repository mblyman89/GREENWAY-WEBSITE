/**
 * src/lib/accounting/migration-stock-core.ts — R50 S2a (bible §1.4, §2 rule 6)
 *
 * ONE answer to "is this delivery a purchase?" for stock that came from the
 * one-time Cultivera migration.
 *
 * Michael, verbatim (R50 §0.1): "it shouldn't mess up accounting, or vendor
 * pay, or things of that nature." The stock was bought and paid for under
 * Cultivera, years ago in some cases. Opening inventory is booked once, by the
 * cut-over opening balance (cutover-inventory-core.ts), never as a purchase.
 *
 * MEASURED, not assumed (2026-10-12): before this slice, NONE of the four
 * money doors excluded the import's synthetic manifest. `POS-IMPORT-<id8>` is
 * written with status 'accepted' (import-service.ts) and its lots carry the
 * export's unit costs, so
 *   vendor-payables-store  listVendorPayables  .in("status", accepted…)  → "owed"
 *   sage-exports           buildSagePurchasesExport  same filter           → a Sage purchase
 *   vendor-bill-service    postManifestVendorBill   by id, no kind check   → an A/P bill
 *   receipt-service        postManifestReceipt      by id, no kind check   → capitalised twice
 * would all treat migrated stock as a fresh delivery. R50 S2 splits that one
 * manifest into ~680 real-looking ones with real vendor names, which would
 * make the payables screen look like money is owed to every vendor at once.
 *
 * The decision is by raw_payload.kind ONLY (the same discriminator as
 * cultivera-manifest-group-core): a real vendor's manifest number may start
 * with "CV-" or "POS-IMPORT", and calling a real delivery "not a purchase"
 * would HIDE money owed. Excluding is only ever done on the kind we wrote.
 *
 * The PostgREST filter was verified on a real PostgREST 12.2.3 + PostgreSQL 15
 * (2026-10-12, rows: wcia, pos-import, reconstructed, null payload, {}, [],
 * "str", kind null, kind 5):
 *   .not("raw_payload->>kind","in","(…)")                → [wcia, 5]  WRONG — SQL
 *       `NULL NOT IN (…)` is NULL, so every manifest without a kind (most
 *       native deliveries) would vanish from payables. Never use it.
 *   .or("raw_payload->>kind.is.null,raw_payload->>kind.not.in.(…)")
 *                                                        → everything but the two
 *       migration kinds. That is NOT_MIGRATION_OR below.
 * Readers ALSO select `payload_kind:raw_payload->>kind` and filter in code with
 * isMigrationKind, so a reader that loses the server filter still excludes.
 *
 * PURE: no I/O, so it runs in the tsx self-test runner.
 */
import {
  POS_IMPORT_MANIFEST_KIND,
  RECONSTRUCTED_MANIFEST_KIND,
} from "../inventory/cultivera-manifest-group-core";

/** The raw_payload.kind values written by the Cultivera migration (and only by it). */
export const MIGRATION_MANIFEST_KINDS: readonly string[] = Object.freeze([
  POS_IMPORT_MANIFEST_KIND,
  RECONSTRUCTED_MANIFEST_KIND,
]);

/** Select alias every money reader adds: `payload_kind:raw_payload->>kind`. */
export const PAYLOAD_KIND_SELECT = "payload_kind:raw_payload->>kind";

/**
 * PostgREST `.or()` argument keeping every manifest that is NOT migration
 * stock, including those with no kind at all. Verified on a real PostgREST
 * (header). Kinds are plain [a-z-] so no quoting is needed; the self-test
 * pins that, because a comma or parenthesis would break the grammar.
 */
export const NOT_MIGRATION_OR = `raw_payload->>kind.is.null,raw_payload->>kind.not.in.(${MIGRATION_MANIFEST_KINDS.join(",")})`;

/** True when a `raw_payload->>kind` text is one of the migration kinds. Exact match (the writer is ours). */
export function isMigrationKind(kind: unknown): boolean {
  return typeof kind === "string" && MIGRATION_MANIFEST_KINDS.includes(kind);
}

/** Drop migration manifests from rows that carry `payload_kind` (defence in depth behind NOT_MIGRATION_OR). */
export function withoutMigrationManifests<T extends { payload_kind?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isMigrationKind(r.payload_kind));
}

/** Count of rows a reader dropped, for its warning line (never silent: rule 48). */
export function migrationManifestCount(rows: readonly { payload_kind?: unknown }[]): number {
  return rows.filter((r) => isMigrationKind(r.payload_kind)).length;
}

/** The Sage purchases export's warning line when it left migration manifests out. */
export function migrationSkippedWarning(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n} Cultivera migration manifest${n === 1 ? "" : "s"} left out: that stock was paid for before the switch and is in the opening inventory balance, not a purchase.`;
}

/** Plain-English refusal for the bill / receipt doors (written for Michael). */
export function migrationStockRefusal(door: "bill" | "receipt", manifestNumber: string | null | undefined): string {
  const n = (manifestNumber ?? "").trim() || "this delivery";
  const what = door === "bill" ? "No vendor bill was recorded" : "Nothing was posted to the books";
  return (
    `${what}: ${n} holds stock moved over from Cultivera, which was bought and paid for before the switch. ` +
    "That stock is counted once, in the opening inventory balance, never as a new purchase."
  );
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runMigrationStockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ migration-stock-core: ${label}`);
    }
  };

  ok(MIGRATION_MANIFEST_KINDS.length === 2, "two kinds");
  ok(MIGRATION_MANIFEST_KINDS.includes("pos-import-migration"), "pos import kind literal");
  ok(MIGRATION_MANIFEST_KINDS.includes("cultivera-reconstructed"), "reconstructed kind literal");
  ok(Object.isFrozen(MIGRATION_MANIFEST_KINDS), "kinds frozen");
  ok(MIGRATION_MANIFEST_KINDS.every((k) => /^[a-z-]+$/.test(k)), "kinds need no PostgREST quoting");

  ok(
    NOT_MIGRATION_OR ===
      "raw_payload->>kind.is.null,raw_payload->>kind.not.in.(pos-import-migration,cultivera-reconstructed)",
    "or-filter exact (verified shape)",
  );
  ok(NOT_MIGRATION_OR.startsWith("raw_payload->>kind.is.null,"), "null kinds kept (NOT IN alone drops them)");
  ok(PAYLOAD_KIND_SELECT === "payload_kind:raw_payload->>kind", "select alias");

  ok(isMigrationKind("pos-import-migration"), "pos import is migration");
  ok(isMigrationKind("cultivera-reconstructed"), "reconstructed is migration");
  ok(!isMigrationKind("wcia"), "wcia is a purchase");
  ok(!isMigrationKind(null) && !isMigrationKind(undefined) && !isMigrationKind(""), "absent kind is a purchase");
  ok(!isMigrationKind("POS-IMPORT-MIGRATION"), "exact case (writer is ours)");
  ok(!isMigrationKind(" pos-import-migration"), "exact, no trim");
  ok(!isMigrationKind(5) && !isMigrationKind(["pos-import-migration"]), "non-strings are purchases");

  const rows = [
    { id: "a", payload_kind: "wcia" },
    { id: "b", payload_kind: "pos-import-migration" },
    { id: "c", payload_kind: null },
    { id: "d", payload_kind: "cultivera-reconstructed" },
    { id: "e" },
  ];
  ok(withoutMigrationManifests(rows).map((r) => r.id).join() === "a,c,e", "filter keeps purchases in order");
  ok(migrationManifestCount(rows) === 2, "count dropped");
  ok(withoutMigrationManifests([]).length === 0 && migrationManifestCount([]) === 0, "empty");

  const bill = migrationStockRefusal("bill", " POS-IMPORT-ab12cd34 ");
  ok(bill.startsWith("No vendor bill was recorded: POS-IMPORT-ab12cd34 holds"), "bill text + trimmed number");
  ok(bill.includes("opening inventory balance"), "bill says where it is counted");
  const rec = migrationStockRefusal("receipt", null);
  ok(rec.startsWith("Nothing was posted to the books: this delivery holds"), "receipt text + fallback name");
  ok(migrationStockRefusal("receipt", "  ").includes("this delivery"), "blank number falls back");

  ok(migrationSkippedWarning(1).startsWith("1 Cultivera migration manifest left out:"), "warning singular");
  ok(migrationSkippedWarning(680).startsWith("680 Cultivera migration manifests left out:"), "warning plural");
  ok(migrationSkippedWarning(2.7).startsWith("2 Cultivera migration manifests"), "warning floors");
  ok(migrationSkippedWarning(Number.NaN).startsWith("0 Cultivera"), "warning junk → 0");

  return { passed, failed };
}
