/**
 * src/lib/inventory/intake-lot-facts-core.ts  (R25 A, owner-reported)
 *
 * Owner (R25, verbatim): "Something I noticed about the products I received
 * via intake, the strain type and receive date is not getting recorded to the
 * inventory table. The inventory page and or the system is not saving the
 * receive date for products we received through intake. The receive date
 * should be the date the manifest was accepted into the system via
 * receiving. Also, the strain type did not get saved to the inventory page,
 * or it is unaware of them. I entered the strain type for all products in
 * onboarding."
 *
 * VERIFIED ROOT CAUSES (read in the tree, not assumed)
 * ----------------------------------------------------
 *  1. RECEIVED DATE. Migration 0214 added inventory_lots.received_on with the
 *     provenance vocabulary 'pos_import' | 'manifest' | 'owner_entered'. The
 *     Cultivera importer writes 'pos_import' and the owner's form writes
 *     'owner_entered', but NOTHING ever wrote 'manifest': stageManifest
 *     (intake-store.ts) inserts the lot without received_on and
 *     finalizeManifestDispositions activates it with only
 *     { status, disposition, updated_by }. Every intake lot therefore reads
 *     "unknown" on the inventory page, lands on the received-date worklist,
 *     and CCRS Inventory.CreatedDate falls back to created_at (the STAGING
 *     instant, which can be days before the product was accepted).
 *
 *  2. STRAIN TYPE. The approver's pick at Product Onboarding is saved to
 *     catalog_product_drafts.chosen_strain_type (0146), to kb_strains (the
 *     attach door) and to menu_items.strain_type (staging, survivorship
 *     chosen > attached > enrichment). It was never copied to
 *     inventory_lots.strain_type, which is the column the inventory page and
 *     the lot detail page read. planClassificationMirror only mirrors the
 *     four compliance classification columns.
 *
 * WHAT THIS CORE DECIDES (pure; no I/O; the store applies it)
 * ----------------------------------------------------------
 *  A. planReceivedOnStamp: the Pacific calendar day of the ACCEPT instant
 *     (the moment the reviewer pressed Finalize), source 'manifest'. The
 *     store writes it with `.is("received_on", null)`, so a date a person
 *     typed or the POS export supplied is NEVER overwritten (fill-only, the
 *     same rule planLotFactFill follows). A date outside 0214's sane window
 *     (before 2014-07-08 or after Pacific today + 1) is refused here rather
 *     than bounced by the database CHECK.
 *     received_on_set_by is NULL: 0214 documents NULL for machine-derived
 *     values. The reviewer who accepted is on the manifest timeline.
 *
 *  B. planLotStrainTypeMirror: the approver's pick (a HUMAN answer) is
 *     copied onto the lot with fact_provenance.strain_type = "reviewer" (the
 *     repo's existing word for a named human source, intake-fact-review-core
 *     REVIEWER_PROVENANCE). No pick = no write (the lot keeps the manifest's
 *     stated fact). A pick that already matches the lot (canonically) = no
 *     write. A junk value can never be written: it must canonicalise.
 *
 * Rule: never guess. A missing instant, an unparseable instant, an empty pick
 * or a missing lot all produce a named "no write" code, never a fallback.
 */
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { addPacificDays, pacificDayKey } from "@/lib/reports/timezone";
import { RECEIVED_DATE_FLOOR, isRealCalendarDate } from "@/lib/inventory/received-date-core";

// ---------------------------------------------------------------------------
// A. The received date from the manifest acceptance
// ---------------------------------------------------------------------------

/** manifest_events.event_type when the stamp could not be saved (no CHECK on the column, 0032). */
export const RECEIVED_DATE_STAMP_ERROR_EVENT = "received_date_stamp_error";

/** The provenance written for an accept-derived date (0214 vocabulary). */
export const MANIFEST_RECEIVED_SOURCE = "manifest" as const;

/**
 * The Pacific calendar day of an accept instant, or null when the instant is
 * missing / unparseable / outside 0214's sane window.
 */
export function manifestReceivedOn(
  acceptedAtIso: string | null | undefined,
  todayPacific: string,
): string | null {
  const raw = String(acceptedAtIso ?? "").trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  const day = pacificDayKey(new Date(t));
  if (!isRealCalendarDate(day)) return null;
  if (day < RECEIVED_DATE_FLOOR) return null;
  if (!isRealCalendarDate(todayPacific)) return null;
  if (day > addPacificDays(todayPacific, 1)) return null;
  return day;
}

export type ReceivedOnStampPatch = {
  received_on: string;
  received_on_source: typeof MANIFEST_RECEIVED_SOURCE;
  received_on_set_by: null;
  received_on_set_at: string;
};

export type ReceivedOnStampPlan =
  | { write: false; code: "no_lots" | "no_accept_instant" | "date_out_of_range"; reason: string }
  | { write: true; lotIds: string[]; patch: ReceivedOnStampPatch };

/**
 * Plan the received-date stamp for the lots accepted in ONE finalize. The
 * store must apply it with `.in("id", lotIds).is("received_on", null)`.
 */
export function planReceivedOnStamp(input: {
  acceptedAtIso: string | null | undefined;
  todayPacific: string;
  lotIds: readonly (string | null | undefined)[];
}): ReceivedOnStampPlan {
  const lotIds = Array.from(
    new Set(input.lotIds.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0)),
  );
  if (lotIds.length === 0) {
    return { write: false, code: "no_lots", reason: "No lot was accepted in this finalize." };
  }
  const raw = String(input.acceptedAtIso ?? "").trim();
  if (!raw || !Number.isFinite(Date.parse(raw))) {
    return { write: false, code: "no_accept_instant", reason: "The accept instant is missing, so no date is evidenced." };
  }
  const day = manifestReceivedOn(raw, input.todayPacific);
  if (!day) {
    return {
      write: false,
      code: "date_out_of_range",
      reason: `The accept instant ${raw} falls outside the sane received-date window (${RECEIVED_DATE_FLOOR} to Pacific today + 1).`,
    };
  }
  return {
    write: true,
    lotIds,
    patch: {
      received_on: day,
      received_on_source: MANIFEST_RECEIVED_SOURCE,
      received_on_set_by: null,
      received_on_set_at: new Date(Date.parse(raw)).toISOString(),
    },
  };
}

/** A database without 0214 has no received_on columns. */
export function isMissingReceivedOnColumns(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  return (err.code === "42703" || err.code === "PGRST204") && /received_on/i.test(err.message ?? "");
}

// ---------------------------------------------------------------------------
// B. The approver's strain-type pick, mirrored onto the lot
// ---------------------------------------------------------------------------

/** fact_provenance value for a named human answer (REVIEWER_PROVENANCE). */
export const LOT_STRAIN_TYPE_HUMAN_PROVENANCE = "reviewer" as const;

export type LotStrainTypeMirrorPlan =
  | { write: false; code: "no_lot" | "no_pick" | "already_set"; reason: string }
  | {
      write: true;
      lotId: string;
      patch: { strain_type: string; fact_provenance: Record<string, unknown> };
      before: string | null;
    };

function provenanceObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };
  return {};
}

export function planLotStrainTypeMirror(input: {
  lotId: string | null | undefined;
  humanPick: string | null | undefined;
  lotStrainType: string | null | undefined;
  lotFactProvenance: unknown;
}): LotStrainTypeMirrorPlan {
  const lotId = String(input.lotId ?? "").trim();
  if (!lotId) return { write: false, code: "no_lot", reason: "This draft is not linked to an inventory lot." };
  const pickRaw = String(input.humanPick ?? "").trim();
  const pick = pickRaw ? canonicalStrainType(pickRaw) : "unknown";
  if (pick === "unknown") {
    return { write: false, code: "no_pick", reason: "No strain type was picked at approval; the lot keeps its own value." };
  }
  const beforeRaw = input.lotStrainType == null ? null : String(input.lotStrainType);
  const before = beforeRaw && beforeRaw.trim() ? beforeRaw : null;
  const prov = provenanceObject(input.lotFactProvenance);
  if (
    before !== null &&
    before.trim().toLowerCase() === pick &&
    prov.strain_type === LOT_STRAIN_TYPE_HUMAN_PROVENANCE
  ) {
    return { write: false, code: "already_set", reason: `The lot already carries ${pick} from a person.` };
  }
  return {
    write: true,
    lotId,
    patch: { strain_type: pick, fact_provenance: { ...prov, strain_type: LOT_STRAIN_TYPE_HUMAN_PROVENANCE } },
    before,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure). Registered in scripts/compliance/run-pure-selftests.ts.
// ---------------------------------------------------------------------------
export function __runIntakeLotFactsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL intake-lot-facts-core: " + msg);
    }
  };
  const TODAY = "2026-07-15";

  // manifestReceivedOn: the PACIFIC day, not the UTC day.
  ok(manifestReceivedOn("2026-07-15T18:00:00.000Z", TODAY) === "2026-07-15", "11am Pacific -> same day");
  ok(manifestReceivedOn("2026-07-15T06:30:00.000Z", TODAY) === "2026-07-14", "11:30pm Pacific the night before (UTC next day) -> Pacific day");
  ok(manifestReceivedOn("2026-01-15T07:59:00.000Z", TODAY) === "2026-01-14", "winter PST offset (-8)");
  ok(manifestReceivedOn("2026-01-15T08:00:00.000Z", TODAY) === "2026-01-15", "winter PST midnight boundary");
  ok(manifestReceivedOn(null, TODAY) === null, "null instant -> null");
  ok(manifestReceivedOn("", TODAY) === null, "empty instant -> null");
  ok(manifestReceivedOn("not a date", TODAY) === null, "junk instant -> null");
  ok(manifestReceivedOn("2014-07-07T19:00:00.000Z", TODAY) === null, "before the legal floor -> null");
  ok(manifestReceivedOn("2014-07-08T19:00:00.000Z", TODAY) === "2014-07-08", "the floor itself is allowed");
  ok(manifestReceivedOn("2026-07-16T19:00:00.000Z", TODAY) === "2026-07-16", "today + 1 allowed (0214 CHECK)");
  ok(manifestReceivedOn("2026-07-17T19:00:00.000Z", TODAY) === null, "today + 2 refused");
  ok(manifestReceivedOn("2026-07-15T18:00:00.000Z", "bogus") === null, "bad today -> null, never guessed");

  // planReceivedOnStamp
  const p = planReceivedOnStamp({ acceptedAtIso: "2026-07-15T18:00:00.000Z", todayPacific: TODAY, lotIds: ["a", "b", "a", " ", null] });
  ok(p.write === true, "stamp plan writes");
  if (p.write) {
    ok(p.lotIds.length === 2 && p.lotIds[0] === "a" && p.lotIds[1] === "b", "ids de-duplicated, blanks dropped, order kept");
    ok(p.patch.received_on === "2026-07-15", "date");
    ok(p.patch.received_on_source === "manifest", "source is manifest");
    ok(p.patch.received_on_set_by === null, "machine-derived: set_by null (0214)");
    ok(p.patch.received_on_set_at === "2026-07-15T18:00:00.000Z", "set_at is the accept instant");
    ok(Object.keys(p.patch).length === 4, "patch touches only the four 0214 columns");
  }
  const none = planReceivedOnStamp({ acceptedAtIso: "2026-07-15T18:00:00.000Z", todayPacific: TODAY, lotIds: [] });
  ok(!none.write && none.code === "no_lots", "no lots -> no_lots");
  const noAt = planReceivedOnStamp({ acceptedAtIso: null, todayPacific: TODAY, lotIds: ["a"] });
  ok(!noAt.write && noAt.code === "no_accept_instant", "no instant -> no_accept_instant");
  const junkAt = planReceivedOnStamp({ acceptedAtIso: "yesterday", todayPacific: TODAY, lotIds: ["a"] });
  ok(!junkAt.write && junkAt.code === "no_accept_instant", "junk instant -> no_accept_instant");
  const future = planReceivedOnStamp({ acceptedAtIso: "2030-01-01T18:00:00.000Z", todayPacific: TODAY, lotIds: ["a"] });
  ok(!future.write && future.code === "date_out_of_range", "future -> date_out_of_range");

  ok(RECEIVED_DATE_STAMP_ERROR_EVENT === "received_date_stamp_error", "event name");
  // isMissingReceivedOnColumns
  ok(isMissingReceivedOnColumns({ code: "42703", message: 'column "received_on" does not exist' }), "42703");
  ok(isMissingReceivedOnColumns({ code: "PGRST204", message: "Could not find the 'received_on' column of 'inventory_lots' in the schema cache" }), "PGRST204");
  ok(!isMissingReceivedOnColumns({ code: "23514", message: "violates check constraint inventory_lots_received_on_sane_chk" }), "a CHECK violation is a real failure");
  ok(!isMissingReceivedOnColumns(null), "null error");
  ok(!isMissingReceivedOnColumns({ code: "42703", message: 'column "strain_type" does not exist' }), "another column missing is not 0214");

  // planLotStrainTypeMirror
  const m = planLotStrainTypeMirror({ lotId: "L1", humanPick: "hybrid", lotStrainType: null, lotFactProvenance: { package_thc_mg: "name" } });
  ok(m.write === true, "pick onto an empty lot writes");
  if (m.write) {
    ok(m.lotId === "L1", "lot id");
    ok(m.patch.strain_type === "hybrid", "value");
    ok(m.patch.fact_provenance.strain_type === "reviewer", "provenance reviewer");
    ok(m.patch.fact_provenance.package_thc_mg === "name", "other provenance keys kept");
    ok(m.before === null, "before null");
  }
  const flip = planLotStrainTypeMirror({ lotId: "L1", humanPick: "indica", lotStrainType: "hybrid", lotFactProvenance: null });
  ok(flip.write === true && flip.patch.strain_type === "indica" && flip.before === "hybrid", "a person's pick replaces the manifest's value (before kept for audit)");
  const lean = planLotStrainTypeMirror({ lotId: "L1", humanPick: "Indica-Hybrid", lotStrainType: null, lotFactProvenance: {} });
  ok(lean.write === true && lean.patch.strain_type === "indica-hybrid", "pick canonicalised");
  const same = planLotStrainTypeMirror({ lotId: "L1", humanPick: "hybrid", lotStrainType: "Hybrid", lotFactProvenance: { strain_type: "reviewer" } });
  ok(!same.write && same.code === "already_set", "already the same from a person -> no write");
  const sameMachine = planLotStrainTypeMirror({ lotId: "L1", humanPick: "hybrid", lotStrainType: "hybrid", lotFactProvenance: {} });
  ok(sameMachine.write === true, "same value but machine provenance -> written so the lot records the person");
  const noPick = planLotStrainTypeMirror({ lotId: "L1", humanPick: "", lotStrainType: "sativa", lotFactProvenance: {} });
  ok(!noPick.write && noPick.code === "no_pick", "no pick -> lot keeps its value");
  const unk = planLotStrainTypeMirror({ lotId: "L1", humanPick: "unknown", lotStrainType: null, lotFactProvenance: {} });
  ok(!unk.write && unk.code === "no_pick", "'unknown' is not a pick");
  const junk = planLotStrainTypeMirror({ lotId: "L1", humanPick: "banana", lotStrainType: null, lotFactProvenance: {} });
  ok(!junk.write && junk.code === "no_pick", "junk never written");
  const noLot = planLotStrainTypeMirror({ lotId: null, humanPick: "hybrid", lotStrainType: null, lotFactProvenance: {} });
  ok(!noLot.write && noLot.code === "no_lot", "no lot -> no_lot");
  const arrProv = planLotStrainTypeMirror({ lotId: "L1", humanPick: "sativa", lotStrainType: null, lotFactProvenance: ["x"] });
  ok(arrProv.write === true && Object.keys(arrProv.patch.fact_provenance).length === 1, "malformed provenance treated as empty");

  return { passed, failed };
}
