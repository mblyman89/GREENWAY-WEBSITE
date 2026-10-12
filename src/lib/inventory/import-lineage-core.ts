/**
 * src/lib/inventory/import-lineage-core.ts — R50 S2b (bible §1.3).
 *
 * "Which manifests hold THIS Cultivera import's lots?"
 *
 * Before R50 the answer was one row: the synthetic manifest numbered
 * `POS-IMPORT-<id8>` (import-service.ts createImportLots). R50 S2c re-homes
 * those lots onto rebuilt manifests (raw_payload.kind
 * `cultivera-reconstructed`, raw_payload.import_id = the import). Every reader
 * that found an import's lots by that one number would silently lose them
 * after the move: the received-date bulk page, the legacy-lot removal, the
 * backfill count and the classification source tab.
 *
 * This core gives those readers one shared answer, keyed on the import id:
 *
 *   * the import's own POS-IMPORT manifest (by number, exactly as before; if
 *     the row also records an import id, it must be THIS import, which fixes
 *     the latent 8-character prefix collision between two imports), and
 *   * every migration manifest whose raw_payload.import_id is this import.
 *
 * PURE: no I/O. The stores run ONE PostgREST read with `importManifestOr()`
 * and pass the rows to `manifestIdsForImport()`.
 */
import { MIGRATION_MANIFEST_KINDS } from "@/lib/accounting/migration-stock-core";
import { POS_IMPORT_MANIFEST_KIND } from "./cultivera-manifest-group-core";

/** import-service.ts stamps `POS-IMPORT-${importId.slice(0, 8)}`. */
export const POS_IMPORT_NUMBER_PREFIX = "POS-IMPORT-";

/** Columns every lineage read selects (aliases keep the row flat). */
export const LINEAGE_MANIFEST_SELECT =
  "id, manifest_number, payload_kind:raw_payload->>kind, payload_import_id:raw_payload->>import_id";

export type LineageManifestRow = {
  id: string;
  manifest_number: string | null;
  payload_kind?: string | null;
  payload_import_id?: string | null;
};

/** The synthetic manifest number one import gets (byte-identical to import-service.ts). */
export function posImportManifestNumber(importId: string): string {
  return `${POS_IMPORT_NUMBER_PREFIX}${importId.slice(0, 8)}`;
}

// pos_imports.id is a uuid. Anything else is refused rather than spliced into
// a PostgREST filter (a comma or parenthesis would change the grammar).
const SAFE_IMPORT_ID = /^[0-9a-fA-F-]{8,64}$/;

/** True when the id can be used in a filter string. */
export function isSafeImportId(importId: unknown): importId is string {
  return typeof importId === "string" && SAFE_IMPORT_ID.test(importId);
}

/**
 * PostgREST `.or()` argument: the POS-IMPORT number OR any manifest stamped
 * with this import id. Null for an unsafe id (the caller refuses).
 */
export function importManifestOr(importId: string): string | null {
  if (!isSafeImportId(importId)) return null;
  return `manifest_number.eq.${posImportManifestNumber(importId)},raw_payload->>import_id.eq.${importId}`;
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The manifest ids that hold this import's lots, sorted, unique. Exact rules:
 *   1. number === POS-IMPORT-<id8> and (no recorded import id, or it is this
 *      import): the original synthetic manifest;
 *   2. kind is a migration kind and recorded import id === this import:
 *      a manifest R50 rebuilt from it (or the synthetic one, stamped).
 * A real delivery is never matched: it has neither the number nor a
 * migration kind.
 */
export function manifestIdsForImport(rows: readonly LineageManifestRow[], importId: string): string[] {
  if (!isSafeImportId(importId)) return [];
  const number = posImportManifestNumber(importId);
  const ids = new Set<string>();
  for (const r of rows) {
    const id = clean(r.id);
    if (!id) continue;
    const recorded = clean(r.payload_import_id);
    const kind = clean(r.payload_kind);
    const byNumber = clean(r.manifest_number) === number && (recorded === "" || recorded === importId);
    const byLineage = MIGRATION_MANIFEST_KINDS.includes(kind) && recorded === importId;
    if (byNumber || byLineage) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Provenance: did this manifest come from the Cultivera migration (either
 * shape)? Used by the classification source tab. The number prefix is kept
 * for rows written before raw_payload.kind existed.
 */
export function isCultiveraMigrationRow(r: Pick<LineageManifestRow, "manifest_number" | "payload_kind"> | null | undefined): boolean {
  if (!r) return false;
  if (MIGRATION_MANIFEST_KINDS.includes(clean(r.payload_kind))) return true;
  return clean(r.manifest_number).toUpperCase().startsWith(POS_IMPORT_NUMBER_PREFIX);
}

/** The original synthetic manifest (by kind or number), as opposed to a rebuilt one. */
export function isPosImportRow(r: Pick<LineageManifestRow, "manifest_number" | "payload_kind"> | null | undefined): boolean {
  if (!r) return false;
  if (clean(r.payload_kind) === POS_IMPORT_MANIFEST_KIND) return true;
  return clean(r.manifest_number).toUpperCase().startsWith(POS_IMPORT_NUMBER_PREFIX);
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runImportLineageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL - ${name}`);
    }
  };

  const IMP = "abcd1234-0000-4000-8000-000000000001";
  const OTHER = "abcd1234-9999-4000-8000-000000000002"; // same 8-char prefix
  ok(posImportManifestNumber(IMP) === "POS-IMPORT-abcd1234", "number = import-service shape");
  ok(LINEAGE_MANIFEST_SELECT.includes("payload_kind:raw_payload->>kind"), "select carries kind");
  ok(LINEAGE_MANIFEST_SELECT.includes("payload_import_id:raw_payload->>import_id"), "select carries import id");

  ok(isSafeImportId(IMP), "uuid safe");
  ok(!isSafeImportId("abc,def"), "comma unsafe");
  ok(!isSafeImportId("abcd1234)"), "paren unsafe");
  ok(!isSafeImportId(""), "blank unsafe");
  ok(!isSafeImportId(null), "null unsafe");
  ok(!isSafeImportId("abc"), "too short unsafe");

  ok(
    importManifestOr(IMP) === `manifest_number.eq.POS-IMPORT-abcd1234,raw_payload->>import_id.eq.${IMP}`,
    "or filter exact",
  );
  ok(importManifestOr("x,y") === null, "or filter refuses unsafe id");

  const rows: LineageManifestRow[] = [
    { id: "m-pos", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: IMP },
    { id: "m-legacy", manifest_number: " POS-IMPORT-abcd1234 ", payload_kind: null, payload_import_id: null },
    { id: "m-other-pos", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: OTHER },
    { id: "m-rebuilt", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: IMP },
    { id: "m-rebuilt-other", manifest_number: "0001109", payload_kind: "cultivera-reconstructed", payload_import_id: OTHER },
    { id: "m-native", manifest_number: "WCIA-1", payload_kind: "wcia", payload_import_id: IMP },
    { id: "m-native-null", manifest_number: "0421", payload_kind: null, payload_import_id: null },
    { id: "", manifest_number: "POS-IMPORT-abcd1234", payload_kind: null, payload_import_id: null },
    { id: "m-rebuilt", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: IMP },
  ];
  const got = manifestIdsForImport(rows, IMP);
  ok(got.join(",") === "m-legacy,m-pos,m-rebuilt", "ids: synthetic + legacy + rebuilt, sorted, unique");
  ok(!got.includes("m-other-pos"), "same prefix, other import refused (collision fix)");
  ok(!got.includes("m-rebuilt-other"), "rebuilt for another import refused");
  ok(!got.includes("m-native"), "native with stray import_id refused (kind gate)");
  ok(!got.includes("m-native-null"), "native delivery never matched");
  ok(manifestIdsForImport(rows, OTHER).join(",") === "m-legacy,m-other-pos,m-rebuilt-other", "other import sees its own + legacy");
  ok(manifestIdsForImport(rows, "bad,id").length === 0, "unsafe id -> none");
  ok(manifestIdsForImport([], IMP).length === 0, "no rows -> none");
  ok(
    manifestIdsForImport([{ id: "x", manifest_number: "pos-import-abcd1234", payload_kind: null }], IMP).length === 0,
    "number match is exact case (import-service writes upper)",
  );

  ok(isCultiveraMigrationRow({ manifest_number: "0001108", payload_kind: "cultivera-reconstructed" }), "provenance: rebuilt");
  ok(isCultiveraMigrationRow({ manifest_number: "X", payload_kind: "pos-import-migration" }), "provenance: kind only");
  ok(isCultiveraMigrationRow({ manifest_number: " pos-import-1", payload_kind: null }), "provenance: legacy number");
  ok(!isCultiveraMigrationRow({ manifest_number: "0421", payload_kind: null }), "provenance: native");
  ok(!isCultiveraMigrationRow({ manifest_number: "CV-1", payload_kind: "wcia" }), "provenance: CV- number is not enough");
  ok(!isCultiveraMigrationRow(null), "provenance: null");

  ok(isPosImportRow({ manifest_number: "POS-IMPORT-1", payload_kind: null }), "pos row by number");
  ok(isPosImportRow({ manifest_number: "Z", payload_kind: "pos-import-migration" }), "pos row by kind");
  ok(!isPosImportRow({ manifest_number: "0001108", payload_kind: "cultivera-reconstructed" }), "rebuilt is not the pos row");
  ok(!isPosImportRow(undefined), "pos row: undefined");

  return { passed, failed };
}
