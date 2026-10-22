/**
 * R74 S10 — the email step's executor, PURE core (Wave 2, owner decision #5).
 *
 * S6 (`planMailMatch`) says, for every Cultivera lot the crawler's transfer match left open, which
 * ONE emailed manifest it came on, or that it goes on the ONE "Unmatched Cultivera stock"
 * (`CV-UNMATCHED`) manifest. This core turns that into writes, the same way the R50 re-home does:
 *
 *   1. one inbound_manifests row per emailed manifest that holds at least one lot, plus the one
 *      CV-UNMATCHED row (idempotent by dedupe_key; `kind: cultivera-reconstructed`, so it is
 *      accounting-inert and counted in this import's lineage like every rebuilt manifest);
 *   2. guarded lot moves. A lot only ever moves FROM:
 *        - the import's POS-IMPORT manifest (the re-home has not run yet), or
 *        - one of this import's manifests rebuilt from Received dates (session / day / undated:
 *          the re-home already ran and parked the lot there for lack of a transfer), or
 *        - this import's CV-UNMATCHED manifest, when a later harvest found its emailed manifest
 *          (an upgrade; never the other way round).
 *      A lot already on a DIFFERENT emailed manifest is left where it is and reported (never
 *      downgraded, never guessed). A lot on one of this import's real Cultivera transfer manifests,
 *      or on a manifest from anywhere else, refuses the whole plan (fail loud);
 *   3. control totals (lots, on-hand, received, cost value in cents) identical before and after.
 *
 * Survivorship facts from the manifest line (name, type, unit cost in cents, qty: "manifest wins on
 * name, type, cost") are written into the manifest's lineage per barcode for Wave 3. No lot field
 * other than manifest_id is ever touched; Cultivera keeps category and quantity.
 *
 * Nothing here talks to the database.
 */
import { RECONSTRUCTED_MANIFEST_KIND, RECONSTRUCTED_NUMBER_PREFIX, shortHash } from "@/lib/inventory/cultivera-manifest-group-core";
import {
  FALLBACK_GROUP_KINDS,
  REHOME_MOVE_BATCH,
  compareTotals,
  controlTotals,
  sharedVendorId,
  transferDateDay,
  type ControlTotals,
  type ManifestInsertRow,
  type RehomeLot,
} from "@/lib/inventory/cultivera-rehome-core";
import {
  MAIL_MATCH_RULE_VERSION,
  UNMATCHED_MANIFEST_LABEL,
  UNMATCHED_MANIFEST_NUMBER,
  planMailMatch,
  type MailMatchPlan,
  type ManifestLineFacts,
} from "@/lib/pos/cultivera-mail-match-core";

export const MAIL_APPLY_RULE_VERSION = 1;
/** raw_payload.group_kind values written here (cultivera-rehome-core MAIL_STEP_GROUP_KINDS reads them). */
export const EMAIL_GROUP_KIND = "email" as const;
export const UNMATCHED_GROUP_KIND = "unmatched" as const;
/** manifest_number prefix for an emailed manifest whose document carries no number. */
export const EMAIL_NUMBERLESS_PREFIX = `${RECONSTRUCTED_NUMBER_PREFIX}EMAIL-`;

/** Dedupe keys. "|EMAIL|" keeps them apart from transfer keys (`NUM|VENDOR|IMPORT-id`). */
export function emailDedupeKey(importId: string, g: { key: string; manifestNumber: string | null }): string {
  if (g.manifestNumber) return `${g.key.toUpperCase()}|EMAIL|IMPORT-${importId}`;
  return `${EMAIL_NUMBERLESS_PREFIX}${shortHash(g.key)}|EMAIL|IMPORT-${importId}`;
}
export function unmatchedDedupeKey(importId: string): string {
  return `${UNMATCHED_MANIFEST_NUMBER}|IMPORT-${importId}`;
}

/* ------------------------------------------------------------------ *
 *  Shapes
 * ------------------------------------------------------------------ */

/** One of this import's manifests (or one holding a planned key), flat; barcodes = raw_payload.barcodes. */
export type ApplyManifestInfo = {
  id: string;
  dedupe_key: string | null;
  payload_kind: string | null;
  payload_import_id: string | null;
  payload_group_kind: string | null;
  /** Lineage barcodes (null = not an array / not read). */
  barcodes: string[] | null;
};

export type MailApplyInput = {
  importId: string;
  source: { id: string; manifestNumber: string };
  /** S6's plan over this import's open lots; null = the harvested documents could not be read (0293 missing). */
  mail: MailMatchPlan | null;
  gatePass: boolean;
  gateProblems?: readonly string[];
  /** Every lot on any manifest of this import. */
  lots: readonly RehomeLot[];
  /** This import's rebuilt manifests + any manifest holding a planned key. */
  manifests: readonly ApplyManifestInfo[];
  /** Kept PDFs / spreadsheets not read yet (S9). Warned, not refused: a later Apply upgrades. */
  unreadDocs?: number;
  /** Cultivera vendor label per barcode (for the vendor-label fallback). */
  cultiveraVendorOf?: ReadonlyMap<string, string>;
  actorId?: string | null;
};

export type MailApplyExceptionCode =
  | "open_barcode_without_lot"
  | "kept_on_email_manifest"
  | "lot_on_transfer_manifest"
  | "lot_on_foreign_manifest"
  | "several_manifests"
  | "vendor_differs";

export type MailApplyException = { code: MailApplyExceptionCode; detail: string };

export type MailPlannedManifest = {
  dedupeKey: string;
  kind: typeof EMAIL_GROUP_KIND | typeof UNMATCHED_GROUP_KIND;
  title: string;
  existingId: string | null;
  /** The row to insert (new) or whose raw_payload / accepted_lot_count to refresh (lineageGrows). */
  row: ManifestInsertRow;
  /** Lots that belong here (already here or to be moved). */
  lotIds: string[];
  /** Existing manifest whose lineage barcodes must grow before lots move onto it. */
  lineageGrows: boolean;
};

export type MailMoveBatch = { targetDedupeKey: string; fromManifestId: string; lotIds: string[] };

export type MailApplyPlan = {
  ok: boolean;
  refusals: string[];
  /** Loud but not blocking. */
  warnings: string[];
  manifests: MailPlannedManifest[];
  moves: MailMoveBatch[];
  exceptions: MailApplyException[];
  totals: ControlTotals;
  /** Rebuilt-from-dates manifests lots move off (the store removes them if left empty with no work). */
  fallbackSources: string[];
  summary: {
    emailManifests: number;
    unmatchedManifest: boolean;
    manifestsToCreate: number;
    manifestsAlreadyCreated: number;
    lineageUpdates: number;
    lotsToMove: number;
    lotsAlreadyHome: number;
    lotsKeptOnEmail: number;
    movesFromImport: number;
    movesFromRebuilt: number;
    movesFromUnmatched: number;
    lotsToEmail: number;
    lotsToUnmatched: number;
    vendorIdsSet: number;
    exceptionCounts: Record<MailApplyExceptionCode, number>;
  };
};

function emptyCounts(): Record<MailApplyExceptionCode, number> {
  return { open_barcode_without_lot: 0, kept_on_email_manifest: 0, lot_on_transfer_manifest: 0, lot_on_foreign_manifest: 0, several_manifests: 0, vendor_differs: 0 };
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ *
 *  The plan
 * ------------------------------------------------------------------ */

type Where = "import" | "fallback" | "transfer" | "email" | "unmatched" | "foreign";

export function planMailApply(input: MailApplyInput): MailApplyPlan {
  const refusals: string[] = [];
  const warnings: string[] = [];
  const exceptions: MailApplyException[] = [];
  const counts = emptyCounts();
  const addEx = (code: MailApplyExceptionCode, detail: string) => {
    counts[code] += 1;
    if (exceptions.length < 500) exceptions.push({ code, detail });
  };
  const importId = input.importId;

  if (!input.source.id) refusals.push("the import's POS-IMPORT manifest was not found");
  if (!input.gatePass) refusals.push(`the Cultivera transfer plan failed its checks, so the lots left for email are not known: ${(input.gateProblems ?? []).join("; ") || "see the rebuild page"}`);
  if (!input.mail) refusals.push("the harvested email documents could not be read: apply database update 0293 and run the harvest first");
  else if (input.mail.summary.documents === 0 && input.mail.summary.openLots > 0)
    refusals.push("no harvested email document lists any of these lots yet: run the harvest (and read the kept files) before putting lots on the unmatched manifest");
  if ((input.unreadDocs ?? 0) > 0)
    warnings.push(`${input.unreadDocs} kept PDF/spreadsheet file(s) have not been read yet. Lots they list will sit on "${UNMATCHED_MANIFEST_LABEL}" until you read them and apply again.`);

  // Where each manifest id sits.
  const infoById = new Map<string, ApplyManifestInfo>();
  const infoByKey = new Map<string, ApplyManifestInfo>();
  for (const m of input.manifests) {
    infoById.set(m.id, m);
    if (m.dedupe_key) infoByKey.set(m.dedupe_key, m);
  }
  const ours = (m: ApplyManifestInfo) => m.payload_kind === RECONSTRUCTED_MANIFEST_KIND && m.payload_import_id === importId;
  const whereOf = (manifestId: string | null): Where => {
    if (!manifestId) return "foreign";
    if (manifestId === input.source.id) return "import";
    const m = infoById.get(manifestId);
    if (!m || !ours(m)) return "foreign";
    const k = m.payload_group_kind ?? "";
    if (k === EMAIL_GROUP_KIND) return "email";
    if (k === UNMATCHED_GROUP_KIND) return "unmatched";
    if (FALLBACK_GROUP_KINDS.includes(k)) return "fallback";
    if (k === "transfer") return "transfer";
    return "foreign";
  };

  // Lots by barcode.
  const byBarcode = new Map<string, RehomeLot[]>();
  const seen = new Set<string>();
  for (const l of input.lots) {
    if (seen.has(l.id)) {
      refusals.push(`lot ${l.id} was read twice`);
      continue;
    }
    seen.add(l.id);
    const b = clean(l.ccrs_inventory_external_id);
    if (!b) continue;
    byBarcode.set(b, [...(byBarcode.get(b) ?? []), l]);
  }

  const mail = input.mail;
  const manifests: MailPlannedManifest[] = [];
  const pending = new Map<string, Map<string, string[]>>(); // dedupe key -> from manifest -> lot ids
  const fallbackSources = new Set<string>();
  const keys = new Set<string>();
  let lotsToMove = 0;
  let lotsAlreadyHome = 0;
  let lotsKeptOnEmail = 0;
  let movesFromImport = 0;
  let movesFromRebuilt = 0;
  let movesFromUnmatched = 0;
  let lotsToEmail = 0;
  let lotsToUnmatched = 0;
  let vendorIdsSet = 0;

  if (mail) {
    const dupes = mail.decisions.map((d) => d.barcode).filter((b) => (byBarcode.get(b)?.length ?? 0) > 1);
    if (dupes.length > 0) refusals.push(`${dupes.length} barcodes are on more than one lot (${dupes.slice(0, 5).join(", ")})`);
    for (const d of mail.decisions) {
      if (d.outcome === "several_manifests") addEx("several_manifests", `${d.barcode}: ${d.candidates.slice(0, 4).join(" / ")}`);
      if (d.outcome === "email" && !d.vendorAgrees) addEx("vendor_differs", d.barcode);
    }
    const factsOf = new Map<string, ManifestLineFacts>();
    for (const d of mail.decisions) if (d.outcome === "email") factsOf.set(d.barcode, d.facts);

    type Target = { key: string; kind: MailPlannedManifest["kind"]; barcodes: string[]; build: (lots: RehomeLot[], barcodes: string[]) => { row: ManifestInsertRow; title: string } };
    const targets: Target[] = [];
    const lineageBase = { kind: RECONSTRUCTED_MANIFEST_KIND, import_id: importId, source_manifest_id: input.source.id, source_manifest_number: input.source.manifestNumber, rule_version: MAIL_MATCH_RULE_VERSION, executor_rule_version: MAIL_APPLY_RULE_VERSION };
    for (const g of mail.groups) {
      const key = emailDedupeKey(importId, g);
      targets.push({
        key,
        kind: EMAIL_GROUP_KIND,
        barcodes: g.barcodes,
        build: (lots, barcodes) => {
          const number = g.manifestNumber ?? key.split("|")[0];
          const cvLabels = [...new Set(barcodes.map((b) => clean(input.cultiveraVendorOf?.get(b))).filter(Boolean))];
          const vendorLabel = g.vendorLabel ?? (cvLabels.length === 1 ? cvLabels[0] : "Vendor not named on the emailed manifest");
          const lineFacts: Record<string, ManifestLineFacts> = {};
          for (const b of barcodes) {
            const f = factsOf.get(b);
            if (f) lineFacts[b] = f;
          }
          const vendorDiffers = barcodes.filter((b) => mail.decisions.some((d) => d.barcode === b && d.outcome === "email" && !d.vendorAgrees));
          const row: ManifestInsertRow = {
            manifest_number: number,
            vendor_id: sharedVendorId(lots, 0),
            vendor_label: vendorLabel,
            transfer_date: transferDateDay(g.transferDate),
            status: "accepted",
            accepted_at: null,
            received_at: null,
            accepted_lot_count: lots.length,
            dedupe_key: key,
            raw_payload: {
              ...lineageBase,
              group_key: g.key,
              group_kind: EMAIL_GROUP_KIND,
              rule: "cultivera-email",
              email_manifest_number: g.manifestNumber,
              vendor_license: g.vendorLicense,
              source_formats: [...g.sourceFormats],
              message_ids: [...g.messageIds],
              files: [...g.files],
              other_lines: g.otherLines,
              lot_count: barcodes.length,
              barcodes,
              line_facts: lineFacts,
              vendor_differs: vendorDiffers,
            },
            notes:
              `Rebuilt from the vendor's emailed manifest ${g.manifestNumber ?? "(no number on the document)"} (${g.files.slice(0, 3).join(", ")}) found in the stephen@ harvest ` +
              `during the one-time Cultivera migration; Cultivera had no transfer for these lots. Opening inventory, not a purchase: payables, Sage and vendor bills skip it.`,
            created_by: input.actorId ?? null,
            updated_by: input.actorId ?? null,
          };
          return { row, title: `${vendorLabel} · ${number} · ${lots.length} item${lots.length === 1 ? "" : "s"} (email)` };
        },
      });
    }
    const uKey = unmatchedDedupeKey(importId);
    targets.push({
      key: uKey,
      kind: UNMATCHED_GROUP_KIND,
      barcodes: mail.unmatched.barcodes,
      build: (lots, barcodes) => {
        const several: Record<string, string[]> = {};
        for (const d of mail.decisions) if (d.outcome === "several_manifests" && barcodes.includes(d.barcode)) several[d.barcode] = [...d.candidates];
        const row: ManifestInsertRow = {
          manifest_number: UNMATCHED_MANIFEST_NUMBER,
          vendor_id: null,
          vendor_label: UNMATCHED_MANIFEST_LABEL,
          transfer_date: null,
          status: "accepted",
          accepted_at: null,
          received_at: null,
          accepted_lot_count: lots.length,
          dedupe_key: uKey,
          raw_payload: {
            ...lineageBase,
            group_key: UNMATCHED_MANIFEST_NUMBER,
            group_kind: UNMATCHED_GROUP_KIND,
            rule: "cultivera-unmatched",
            lot_count: barcodes.length,
            barcodes,
            by_vendor: { ...mail.unmatched.byVendor },
            several_manifests: several,
          },
          notes:
            `Cultivera stock that neither a Cultivera transfer nor any harvested vendor email could place (owner rule #5). ` +
            `These lots likely do not exist and belong in the CCRS clean-up. Opening inventory, not a purchase.`,
          created_by: input.actorId ?? null,
          updated_by: input.actorId ?? null,
        };
        return { row, title: `${UNMATCHED_MANIFEST_LABEL} · ${lots.length} item${lots.length === 1 ? "" : "s"}` };
      },
    });

    for (const t of targets) {
      if (keys.has(t.key)) {
        refusals.push(`two emailed manifests share the dedupe key ${t.key}`);
        continue;
      }
      keys.add(t.key);
      const ex = infoByKey.get(t.key) ?? null;
      if (ex && (!ours(ex) || ex.payload_group_kind !== t.kind)) {
        refusals.push(`manifest ${ex.id} already holds the key ${t.key} but is not this import's ${t.kind} manifest`);
        continue;
      }
      if (ex && !ex.barcodes) {
        refusals.push(`manifest ${ex.id} has no barcode lineage; the email step refuses to guess which lots are ours`);
        continue;
      }
      const home: RehomeLot[] = [];
      const movers: RehomeLot[] = [];
      for (const b of t.barcodes) {
        const ls = byBarcode.get(b);
        if (!ls || ls.length === 0) {
          addEx("open_barcode_without_lot", b);
          continue;
        }
        const l = ls[0];
        if (ex && l.manifest_id === ex.id) {
          home.push(l);
          continue;
        }
        const w = whereOf(l.manifest_id);
        if (w === "import" || w === "fallback" || (w === "unmatched" && t.kind === EMAIL_GROUP_KIND)) {
          movers.push(l);
          continue;
        }
        if (w === "email" || w === "unmatched") {
          lotsKeptOnEmail += 1;
          addEx("kept_on_email_manifest", `${b} stays on ${l.manifest_id}`);
          continue;
        }
        if (w === "transfer") addEx("lot_on_transfer_manifest", `${b} is on ${l.manifest_id}`);
        else addEx("lot_on_foreign_manifest", `${b} is on ${l.manifest_id ?? "no manifest"}`);
      }
      const lots = [...home, ...movers];
      if (lots.length === 0) continue;
      const placed = lots.map((l) => clean(l.ccrs_inventory_external_id)).sort();
      const union = [...new Set([...(ex?.barcodes ?? []), ...placed])].sort();
      const lineageGrows = Boolean(ex) && union.length > (ex?.barcodes?.length ?? 0);
      const built = t.build(lots, ex ? union : placed);
      if (built.row.vendor_id) vendorIdsSet += 1;
      manifests.push({ dedupeKey: t.key, kind: t.kind, title: built.title, existingId: ex?.id ?? null, row: built.row, lotIds: lots.map((l) => l.id).sort(), lineageGrows });
      lotsAlreadyHome += home.length;
      for (const l of movers) {
        const from = l.manifest_id as string;
        const w = whereOf(from);
        if (w === "import") movesFromImport += 1;
        else if (w === "fallback") {
          movesFromRebuilt += 1;
          fallbackSources.add(from);
        } else movesFromUnmatched += 1;
        if (t.kind === EMAIL_GROUP_KIND) lotsToEmail += 1;
        else lotsToUnmatched += 1;
        lotsToMove += 1;
        const byFrom = pending.get(t.key) ?? new Map<string, string[]>();
        byFrom.set(from, [...(byFrom.get(from) ?? []), l.id]);
        pending.set(t.key, byFrom);
      }
    }
  }
  if (counts.lot_on_transfer_manifest > 0)
    refusals.push(`${counts.lot_on_transfer_manifest} lot(s) the transfer plan leaves open sit on one of this import's Cultivera transfer manifests: the plan changed since the rebuild; open Rebuild manifests and check it first`);
  if (counts.lot_on_foreign_manifest > 0) refusals.push(`${counts.lot_on_foreign_manifest} lot(s) sit on a manifest that is not from this import; nothing is moved off a native delivery`);

  const moves: MailMoveBatch[] = [];
  for (const m of manifests) {
    const byFrom = pending.get(m.dedupeKey);
    if (!byFrom) continue;
    for (const from of [...byFrom.keys()].sort()) {
      const ids = byFrom.get(from)!.slice().sort();
      for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) moves.push({ targetDedupeKey: m.dedupeKey, fromManifestId: from, lotIds: ids.slice(i, i + REHOME_MOVE_BATCH) });
    }
  }
  const toCreate = manifests.filter((m) => !m.existingId).length;
  return {
    ok: refusals.length === 0,
    refusals,
    warnings,
    manifests,
    moves,
    exceptions,
    totals: controlTotals(input.lots),
    fallbackSources: [...fallbackSources].sort(),
    summary: {
      emailManifests: manifests.filter((m) => m.kind === EMAIL_GROUP_KIND).length,
      unmatchedManifest: manifests.some((m) => m.kind === UNMATCHED_GROUP_KIND),
      manifestsToCreate: toCreate,
      manifestsAlreadyCreated: manifests.length - toCreate,
      lineageUpdates: manifests.filter((m) => m.lineageGrows).length,
      lotsToMove,
      lotsAlreadyHome,
      lotsKeptOnEmail,
      movesFromImport,
      movesFromRebuilt,
      movesFromUnmatched,
      lotsToEmail,
      lotsToUnmatched,
      vendorIdsSet,
      exceptionCounts: counts,
    },
  };
}

/** After Apply, from the database: totals identical, every planned lot on its planned manifest. */
export function verifyMailApply(args: { before: ControlTotals; afterLots: readonly RehomeLot[]; manifestIdByKey: ReadonlyMap<string, string>; plan: Pick<MailApplyPlan, "manifests"> }): string[] {
  const problems = compareTotals(args.before, controlTotals(args.afterLots));
  const byId = new Map<string, RehomeLot>();
  for (const l of args.afterLots) {
    if (byId.has(l.id)) problems.push(`lot ${l.id} appears twice`);
    byId.set(l.id, l);
  }
  let missing = 0;
  let misplaced = 0;
  for (const m of args.plan.manifests) {
    const target = args.manifestIdByKey.get(m.dedupeKey);
    if (!target) {
      problems.push(`manifest for ${m.dedupeKey} was not created`);
      continue;
    }
    for (const id of m.lotIds) {
      const l = byId.get(id);
      if (!l) missing += 1;
      else if (l.manifest_id !== target) misplaced += 1;
    }
  }
  if (missing > 0) problems.push(`${missing} planned lots were not found after Apply`);
  if (misplaced > 0) problems.push(`${misplaced} lots are not on their planned manifest`);
  return problems;
}

/* ------------------------------------------------------------------ *
 *  Screen helpers
 * ------------------------------------------------------------------ */

export const MAIL_APPLY_AUDIT = {
  applied: "cultivera_mail_apply.applied",
  applyProblems: "cultivera_mail_apply.applied_with_problems",
  applyRefused: "cultivera_mail_apply.refused",
  rolledBack: "cultivera_mail_apply.rolled_back",
} as const;

export function coverageHref(importId: string, q: { done?: string; error?: string } = {}): string {
  const base = `/admin/menu-imports/${encodeURIComponent(importId)}/coverage`;
  const p = new URLSearchParams();
  if (q.done) p.set("done", q.done);
  if (q.error) p.set("error", q.error);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export const MAIL_APPLY_EXCEPTION_TEXT: Record<MailApplyExceptionCode, { title: string; action: string }> = {
  open_barcode_without_lot: { title: "Barcode left for email but no lot on this import", action: "Someone already moved or removed that lot. Nothing is invented." },
  kept_on_email_manifest: { title: "Lot already on a different emailed manifest", action: "It stays where it is (never downgraded or guessed). Move it by hand if that is wrong." },
  lot_on_transfer_manifest: { title: "Lot sits on one of this import's Cultivera transfer manifests", action: "Blocks Apply: the transfer plan changed since the rebuild. Check Rebuild manifests." },
  lot_on_foreign_manifest: { title: "Lot sits on a manifest from somewhere else", action: "Blocks Apply, so nothing is moved off a native delivery." },
  several_manifests: { title: "Lot on two or more emailed manifests", action: "Not guessed: it goes on the unmatched manifest with the candidates recorded." },
  vendor_differs: { title: "Emailed vendor name differs from Cultivera's", action: "Barcodes are state-issued, so the barcode decides. Shown so you can eyeball it." },
};

export type MailApplyStage = "nothing" | "ready" | "partial" | "done" | "refused";

export function mailApplyStage(plan: Pick<MailApplyPlan, "ok" | "summary" | "manifests">): MailApplyStage {
  const s = plan.summary;
  if (!plan.ok) return "refused";
  if (plan.manifests.length === 0) return "nothing";
  if (s.manifestsToCreate === 0 && s.lotsToMove === 0 && s.lineageUpdates === 0) return "done";
  if (s.manifestsAlreadyCreated > 0 || s.lotsAlreadyHome > 0) return "partial";
  return "ready";
}

export function mailApplySummaryText(r: { ok: boolean; created: number; reused: number; moved: number; skippedByGuard: number; removedEmpty: number; warnings: string[]; problems: string[]; before: ControlTotals }): string {
  const head = r.ok
    ? `Created ${r.created} manifest(s)${r.reused > 0 ? ` (${r.reused} already existed)` : ""} and moved ${r.moved} lot(s) onto the emailed and unmatched manifests. Verified against the database: ${r.before.lots} lots, ${r.before.onHandUnits} units on hand, ${r.before.costValueCents}¢ at cost, unchanged.`
    : `Stopped with ${r.problems.length} problem(s): ${r.problems.join("; ")}. Run Apply again to resume; nothing is duplicated.`;
  const removed = r.removedEmpty > 0 ? ` Removed ${r.removedEmpty} rebuilt-from-dates manifest(s) left empty.` : "";
  const guard = r.skippedByGuard > 0 ? ` ${r.skippedByGuard} lot(s) were moved by someone else meanwhile and were left alone.` : "";
  const warn = r.warnings.length > 0 ? ` ${r.warnings.join(" ")}` : "";
  return head + removed + guard + warn;
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraMailApplyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ cultivera-mail-apply-core: ${name}`);
    }
  };
  const IMP = "imp-1";
  const SRC = { id: "src", manifestNumber: "POS-IMPORT-imp-1" };
  const lot = (id: string, bc: string, man: string | null, oh = 1, cost = 100, vendor: string | null = "v1"): RehomeLot => ({ id, manifest_id: man, ccrs_inventory_external_id: bc, vendor_id: vendor, on_hand_qty: oh, received_qty: oh, unit_cost_minor_units: cost, status: "active" });
  const line = (bc: string, qty = 1, cost: number | null = 500) => ({ lot_code: bc, received_qty: qty, product_name: `P ${bc}`, inventory_type: "Usable Marijuana", unit_cost_minor_units: cost });
  const doc = (msg: string, number: string | null, lines: ReturnType<typeof line>[], vendor = "Grow Co", license: string | null = "412345") => ({
    messageId: msg,
    emailAt: null,
    filename: `${msg}.json`,
    manifest: { manifest_number: number, vendor_label: vendor, vendor_license: license, transfer_date: "2024-08-30", source_format: "wcia" as const, lines: lines as never },
  });
  const open = (bcs: string[], vendor = "Grow Co") => bcs.map((b) => ({ barcode: b, vendorLabel: vendor, product: `p${b}`, units: 1 }));
  const mail = planMailMatch(open(["A", "B", "C", "D", "E"]), [doc("m1", "0001", [line("A"), line("B", 2, 250)]), doc("m2", null, [line("C")], "Leaf"), doc("m3", "0003", [line("D")]), doc("m4", "0004", [line("D")])]);
  const base = (over: Partial<MailApplyInput> = {}): MailApplyInput => ({
    importId: IMP,
    source: SRC,
    mail,
    gatePass: true,
    lots: [lot("1", "A", "src"), lot("2", "B", "src", 2, 250), lot("3", "C", "fb-1"), lot("4", "D", "src"), lot("5", "E", "src", 3, 0, null), lot("6", "T", "tr-1")],
    manifests: [
      { id: "fb-1", dedupe_key: "CV-DAY|LEAF|IMPORT-imp-1", payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: IMP, payload_group_kind: "day", barcodes: ["C"] },
      { id: "tr-1", dedupe_key: "9|GROW|IMPORT-imp-1", payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: IMP, payload_group_kind: "transfer", barcodes: ["T"] },
    ],
    actorId: "staff-1",
    ...over,
  });

  // Keys
  ok(emailDedupeKey(IMP, { key: "0001|412345", manifestNumber: "0001" }) === "0001|412345|EMAIL|IMPORT-imp-1", "numbered email key");
  ok(/^CV-EMAIL-[0-9A-Z]{6}\|EMAIL\|IMPORT-imp-1$/.test(emailDedupeKey(IMP, { key: "doc|m2|m2.json", manifestNumber: null })), "numberless email key is short + hashed");
  ok(unmatchedDedupeKey(IMP) === "CV-UNMATCHED|IMPORT-imp-1", "unmatched key");
  ok(emailDedupeKey(IMP, { key: "0001|grow co", manifestNumber: "0001" }) !== "0001|GROW CO|IMPORT-imp-1", "email key never equals a transfer key");

  const p = planMailApply(base());
  ok(p.ok && p.refusals.length === 0, "clean plan ok");
  ok(p.summary.emailManifests === 2 && p.summary.unmatchedManifest, "2 emailed manifests + unmatched");
  const m1 = p.manifests.find((m) => m.row.manifest_number === "0001")!;
  ok(m1 && m1.lotIds.join() === "1,2" && m1.row.accepted_lot_count === 2, "0001 holds A, B");
  ok(m1.row.raw_payload.kind === RECONSTRUCTED_MANIFEST_KIND && m1.row.raw_payload.import_id === IMP && m1.row.raw_payload.group_kind === "email", "email lineage kind/import/group");
  ok(JSON.stringify(m1.row.raw_payload.barcodes) === '["A","B"]' && m1.row.raw_payload.lot_count === 2, "lineage barcodes");
  const facts = m1.row.raw_payload.line_facts as Record<string, ManifestLineFacts>;
  ok(facts.B.unitCostCents === 250 && facts.B.productName === "P B" && facts.B.inventoryType === "Usable Marijuana" && facts.B.qty === 2, "survivorship facts in cents");
  ok(m1.row.transfer_date === "2024-08-30" && m1.row.accepted_at === null && m1.row.received_at === null, "transfer day kept; no invented acceptance time");
  ok(m1.row.vendor_label === "Grow Co" && m1.row.vendor_id === "v1" && m1.row.status === "accepted", "manifest vendor label + shared vendor id");
  ok((m1.row.raw_payload.message_ids as string[]).join() === "m1" && m1.row.raw_payload.vendor_license === "412345", "message ids + license in lineage");
  const nn = p.manifests.find((m) => m.row.manifest_number.startsWith(EMAIL_NUMBERLESS_PREFIX))!;
  ok(nn && nn.lotIds.join() === "3" && nn.row.raw_payload.email_manifest_number === null, "numberless document gets a CV-EMAIL number");
  const u = p.manifests.find((m) => m.kind === UNMATCHED_GROUP_KIND)!;
  ok(u.row.manifest_number === "CV-UNMATCHED" && u.row.vendor_label === UNMATCHED_MANIFEST_LABEL && u.row.vendor_id === null, "unmatched number + label, no vendor");
  ok(u.lotIds.join() === "4,5" && JSON.stringify((u.row.raw_payload.several_manifests as Record<string, string[]>).D) === '["0003|412345","0004|412345"]', "several-manifest lot on unmatched with candidates");
  ok(p.summary.exceptionCounts.several_manifests === 1, "several counted");
  ok(p.summary.lotsToMove === 5 && p.summary.movesFromImport === 4 && p.summary.movesFromRebuilt === 1 && p.summary.lotsToEmail === 3 && p.summary.lotsToUnmatched === 2, "move counts by origin + target");
  ok(p.fallbackSources.join() === "fb-1", "fallback source recorded for empty clean-up");
  ok(p.moves.some((b) => b.fromManifestId === "fb-1" && b.lotIds.join() === "3") && p.moves.every((b) => b.lotIds.length > 0), "moves carry their guard manifest");
  ok(!p.manifests.some((m) => m.lotIds.includes("6")), "transfer-placed lot untouched");
  ok(p.totals.lots === 6 && p.totals.costValueCents === 100 + 500 + 100 + 100 + 0 + 100, "control totals over all import lots");

  // Refusals
  ok(!planMailApply(base({ gatePass: false, gateProblems: ["x"] })).ok, "gate fail refuses");
  ok(planMailApply(base({ mail: null })).refusals.some((r) => r.includes("0293")), "docs not readable refuses");
  const noDocs = planMailMatch(open(["A"]), []);
  ok(planMailApply(base({ mail: noDocs })).refusals.some((r) => r.includes("no harvested email")), "zero documents refuses (would dump everything on unmatched)");
  ok(!planMailApply(base({ source: { id: "", manifestNumber: "" } })).ok, "missing source refuses");
  ok(!planMailApply(base({ lots: [...base().lots, lot("9", "A", "src")] })).ok, "barcode on two lots refuses");
  ok(!planMailApply(base({ lots: [lot("1", "A", "src"), lot("1", "A", "src")] })).ok, "lot read twice refuses");
  const onTr = planMailApply(base({ lots: base().lots.map((l) => (l.id === "1" ? { ...l, manifest_id: "tr-1" } : l)) }));
  ok(!onTr.ok && onTr.summary.exceptionCounts.lot_on_transfer_manifest === 1, "open lot on a transfer manifest refuses");
  const onForeign = planMailApply(base({ lots: base().lots.map((l) => (l.id === "1" ? { ...l, manifest_id: "native-9" } : l)) }));
  ok(!onForeign.ok && onForeign.summary.exceptionCounts.lot_on_foreign_manifest === 1, "lot on a native manifest refuses");
  const otherImp = planMailApply(base({ manifests: base().manifests.map((m) => (m.id === "fb-1" ? { ...m, payload_import_id: "imp-2" } : m)) }));
  ok(!otherImp.ok, "another import's rebuilt manifest is foreign");
  const k = m1.dedupeKey;
  ok(planMailApply(base({ manifests: [...base().manifests, { id: "x", dedupe_key: k, payload_kind: "wcia", payload_import_id: null, payload_group_kind: null, barcodes: [] }] })).refusals.some((r) => r.includes("already holds the key")), "key held elsewhere refuses");
  ok(!planMailApply(base({ manifests: [...base().manifests, { id: "x", dedupe_key: k, payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: IMP, payload_group_kind: "unmatched", barcodes: [] }] })).ok, "key held with the wrong group kind refuses");
  ok(!planMailApply(base({ manifests: [...base().manifests, { id: "x", dedupe_key: k, payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: IMP, payload_group_kind: "email", barcodes: null }] })).ok, "existing manifest without lineage refuses");
  const warn = planMailApply(base({ unreadDocs: 3 }));
  ok(warn.ok && warn.warnings.length === 1 && warn.warnings[0].includes("3 kept"), "unread files warn, do not block");

  // Resume / idempotency / upgrades
  const after = base().lots.map((l) => {
    const m = p.manifests.find((x) => x.lotIds.includes(l.id));
    return m ? { ...l, manifest_id: `id-${m.kind}-${m.row.manifest_number}` } : l;
  });
  const created: ApplyManifestInfo[] = p.manifests.map((m) => ({ id: `id-${m.kind}-${m.row.manifest_number}`, dedupe_key: m.dedupeKey, payload_kind: RECONSTRUCTED_MANIFEST_KIND, payload_import_id: IMP, payload_group_kind: m.kind, barcodes: m.row.raw_payload.barcodes as string[] }));
  const again = planMailApply(base({ lots: after, manifests: [...base().manifests, ...created] }));
  ok(again.ok && again.moves.length === 0 && again.summary.manifestsToCreate === 0 && again.summary.lotsAlreadyHome === 5 && again.summary.lineageUpdates === 0, "second Apply is a no-op");
  ok(mailApplyStage(again) === "done" && mailApplyStage(p) === "ready", "stage done / ready");
  const half = planMailApply(base({ lots: after.map((l) => (l.id === "2" ? { ...l, manifest_id: "src" } : l)), manifests: [...base().manifests, ...created] }));
  ok(half.ok && half.summary.lotsToMove === 1 && half.moves[0].lotIds.join() === "2" && mailApplyStage(half) === "partial", "resume moves only the rest");
  // Later harvest finds E's manifest: upgrade from CV-UNMATCHED onto the (existing) 0001.
  const mail2 = planMailMatch(open(["A", "B", "C", "D", "E"]), [doc("m1", "0001", [line("A"), line("B", 2, 250)]), doc("m5", "0001", [line("E")]), doc("m2", null, [line("C")], "Leaf"), doc("m3", "0003", [line("D")]), doc("m4", "0004", [line("D")])]);
  const up = planMailApply(base({ mail: mail2, lots: after, manifests: [...base().manifests, ...created] }));
  const m1b = up.manifests.find((m) => m.row.manifest_number === "0001")!;
  ok(up.ok && up.summary.movesFromUnmatched === 1 && m1b.lineageGrows && JSON.stringify(m1b.row.raw_payload.barcodes) === '["A","B","E"]', "upgrade from unmatched grows the lineage first");
  ok(up.moves.length === 1 && up.moves[0].fromManifestId === "id-unmatched-CV-UNMATCHED" && mailApplyStage(up) === "partial", "upgrade move is guarded by the unmatched manifest");
  // A second document for D's only manifest makes it "several": the lot stays on its email manifest (never downgraded).
  const placedD = after.map((l) => (l.id === "4" ? { ...l, manifest_id: "id-email-0001" } : l));
  const down = planMailApply(base({ lots: placedD, manifests: [...base().manifests, ...created] }));
  ok(down.ok && down.summary.lotsKeptOnEmail === 1 && down.summary.exceptionCounts.kept_on_email_manifest === 1, "never downgraded from an email manifest");
  const gone = planMailApply(base({ lots: base().lots.filter((l) => l.id !== "5") }));
  ok(gone.ok && gone.summary.exceptionCounts.open_barcode_without_lot === 1, "open barcode without a lot is logged, not invented");

  // Batching
  const many = Array.from({ length: 320 }, (_, i) => `Z${String(i).padStart(4, "0")}`);
  const bigMail = planMailMatch(open(many), [doc("mz", "0099", many.map((b) => line(b)))]);
  const big = planMailApply(base({ mail: bigMail, lots: many.map((b, i) => lot(`L${String(i).padStart(4, "0")}`, b, "src")) }));
  ok(big.moves.length === 3 && big.moves.every((b) => b.lotIds.length <= REHOME_MOVE_BATCH) && big.moves.reduce((n, b) => n + b.lotIds.length, 0) === 320, "batches ≤ 150, complete");

  // Verify
  const ids = new Map(p.manifests.map((m) => [m.dedupeKey, `id-${m.kind}-${m.row.manifest_number}`]));
  ok(verifyMailApply({ before: p.totals, afterLots: after, manifestIdByKey: ids, plan: p }).length === 0, "verify passes after the move");
  ok(verifyMailApply({ before: p.totals, afterLots: base().lots, manifestIdByKey: ids, plan: p }).some((x) => x.includes("not on their planned")), "verify catches unmoved lots");
  ok(verifyMailApply({ before: p.totals, afterLots: after.slice(1), manifestIdByKey: ids, plan: p }).some((x) => x.includes("lot count")), "verify catches a lost lot");
  ok(verifyMailApply({ before: p.totals, afterLots: after, manifestIdByKey: new Map(), plan: p }).some((x) => x.includes("was not created")), "verify catches a missing manifest");

  // Screen helpers
  ok(coverageHref("a b", { done: "x & y" }) === "/admin/menu-imports/a%20b/coverage?done=x+%26+y", "coverage href");
  ok(Object.keys(MAIL_APPLY_EXCEPTION_TEXT).length === Object.keys(emptyCounts()).length, "every exception explained");
  const good = mailApplySummaryText({ ok: true, created: 3, reused: 0, moved: 5, skippedByGuard: 0, removedEmpty: 1, warnings: [], problems: [], before: p.totals });
  ok(good.startsWith("Created 3 manifest(s) and moved 5 lot(s)") && good.includes("Removed 1 rebuilt"), "ok sentence");
  const bad = mailApplySummaryText({ ok: false, created: 0, reused: 1, moved: 0, skippedByGuard: 2, removedEmpty: 0, warnings: ["w"], problems: ["p"], before: p.totals });
  ok(bad.includes("Stopped with 1 problem(s): p") && bad.includes("2 lot(s) were moved by someone else") && bad.endsWith(" w"), "problem sentence");
  ok(mailApplyStage({ ok: false, summary: p.summary, manifests: p.manifests }) === "refused" && mailApplyStage({ ok: true, summary: p.summary, manifests: [] }) === "nothing", "stage refused / nothing");
  return { passed, failed };
}
