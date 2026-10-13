/**
 * src/lib/inventory/cultivera-received-flag-core.ts — R50 S3d.
 *
 * Owner (follow-up #4): migrated products must look the same as received
 * ones on the Inventory list and the lot page, "with the exception of having
 * a flag set to them saying they were received by Cultivera".
 *
 * ONE rule decides the flag, used by both pages. Evidence, either of:
 *   1. the lot's manifest is a Cultivera migration manifest — the shared
 *      lineage predicate `isCultiveraMigrationRow` (raw_payload.kind is a
 *      migration kind, or the legacy POS-IMPORT- number). This is the rule
 *      the classification source tab already uses;
 *   2. the lot's notes carry MIGRATION_MARKER, which import-lot-core writes
 *      on every imported lot. Re-homing only moves manifest_id, so the marker
 *      survives, and it still holds when the manifest read fails.
 * Nothing else: a real delivery has neither, so it never gets the flag.
 *
 * Pure: no I/O.
 */
import { MIGRATION_MARKER } from "@/lib/inventory/bulk-fill-core";
import { isCultiveraMigrationRow, type LineageManifestRow } from "@/lib/inventory/import-lineage-core";

export const CULTIVERA_FLAG_LABEL = "via Cultivera";
export const CULTIVERA_FLAG_TITLE =
  "Received via Cultivera: this lot came over in the Cultivera migration and was rebuilt by our onboarding. It can be sold while onboarding finishes.";

/** raw_payload.kind of a manifest row read with select("*"), or null. */
export function manifestPayloadKind(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const k = (rawPayload as Record<string, unknown>).kind;
  return typeof k === "string" ? k : null;
}

export type CultiveraFlagLot = { notes?: string | null; manifest_id?: string | null };

/** True when this lot came from the Cultivera migration (see header). */
export function isReceivedViaCultivera(
  lot: CultiveraFlagLot,
  manifest: Pick<LineageManifestRow, "manifest_number" | "payload_kind"> | null | undefined,
): boolean {
  if (manifest && isCultiveraMigrationRow(manifest)) return true;
  return typeof lot.notes === "string" && lot.notes.includes(MIGRATION_MARKER);
}

/** Manifest ids (from a lineage read) that are migration manifests. */
export function cultiveraManifestIdSet(rows: readonly LineageManifestRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (id && isCultiveraMigrationRow(r)) out.add(id);
  }
  return out;
}

/** List-page form: the lot's manifest is in the migration set, or the notes marker. */
export function lotFlaggedCultivera(lot: CultiveraFlagLot, migrationManifestIds: ReadonlySet<string>): boolean {
  const mid = typeof lot.manifest_id === "string" ? lot.manifest_id.trim() : "";
  if (mid && migrationManifestIds.has(mid)) return true;
  return isReceivedViaCultivera(lot, null);
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraReceivedFlagCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-received-flag-core: " + m);
    }
  };
  const rebuilt = { manifest_number: "0001108", payload_kind: "cultivera-reconstructed" };
  const pos = { manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration" };
  const legacy = { manifest_number: "POS-IMPORT-abcd1234", payload_kind: null };
  const native = { manifest_number: "0421", payload_kind: null };
  const wcia = { manifest_number: "CV-1", payload_kind: "wcia" };
  const marker = `${MIGRATION_MARKER} Received 2026-06-17.`;

  ok(isReceivedViaCultivera({ notes: null }, rebuilt), "rebuilt manifest -> flag");
  ok(isReceivedViaCultivera({ notes: null }, pos), "pos-import manifest -> flag");
  ok(isReceivedViaCultivera({ notes: null }, legacy), "legacy POS-IMPORT number -> flag");
  ok(!isReceivedViaCultivera({ notes: null }, native), "native delivery -> no flag");
  ok(!isReceivedViaCultivera({ notes: "Received via intake" }, wcia), "wcia delivery -> no flag");
  ok(isReceivedViaCultivera({ notes: marker }, native), "marker survives a native-looking manifest");
  ok(isReceivedViaCultivera({ notes: marker }, null), "marker alone (manifest read failed) -> flag");
  ok(!isReceivedViaCultivera({ notes: "Cultivera migration" }, null), "partial marker is not evidence");
  ok(!isReceivedViaCultivera({}, undefined), "nothing -> no flag");

  ok(manifestPayloadKind({ kind: "cultivera-reconstructed" }) === "cultivera-reconstructed", "kind read");
  ok(manifestPayloadKind({ kind: 5 }) === null, "non-string kind -> null");
  ok(manifestPayloadKind(Object.assign(["x"], { kind: "cultivera-reconstructed" })) === null, "array (even with a kind prop) -> null");
  ok(manifestPayloadKind(null) === null, "null -> null");

  const set = cultiveraManifestIdSet([
    { id: "m-r", ...rebuilt },
    { id: " m-p ", ...pos },
    { id: "m-n", ...native },
    { id: "", ...rebuilt },
  ]);
  ok([...set].sort().join(",") === "m-p,m-r", "set: migration ids only, trimmed, blank skipped");
  ok(lotFlaggedCultivera({ manifest_id: "m-r", notes: null }, set), "list: manifest in set");
  ok(lotFlaggedCultivera({ manifest_id: " m-p", notes: null }, set), "list: id trimmed");
  ok(!lotFlaggedCultivera({ manifest_id: "m-n", notes: null }, set), "list: native not flagged");
  ok(lotFlaggedCultivera({ manifest_id: "m-n", notes: marker }, set), "list: marker fallback");
  ok(!lotFlaggedCultivera({ manifest_id: null, notes: null }, set), "list: no manifest, no marker");
  ok(CULTIVERA_FLAG_LABEL === "via Cultivera", "label pinned");
  return { passed, failed };
}
