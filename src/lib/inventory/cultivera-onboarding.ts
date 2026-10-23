/**
 * R50 S3 - start a Cultivera-rebuilt manifest through Product Onboarding.
 *
 * Owner: "as I work through each Cultivera manifest, it should save
 * everything to the kb as we do for intaking and onboarding products ... so
 * everything is cataloged and reusable."
 *
 * The rebuilt manifests (S2) describe stock that is ALREADY selling, so the
 * native finalize never gave them onboarding rows (every key matched the live
 * menu). This runs the SAME native chain a finalize runs, in the same order,
 * with one difference - drafts are seeded in re-onboarding mode (one per live
 * card key; live price, no floor):
 *
 *   0. attachWciaLabResults (R50 S3b): the vendor's lab results from the
 *      manifest's own Cultivera transfer file, fill-only lab links.
 *   1. seedDraftsForManifest(..., { reonboard: true })   (concurrently with)
 *      archiveCoasForManifest -> extractCoasForManifest  (no-op until S6
 *                                                          links certificates)
 *      promoteManifestToKb                               (KB write-back)
 *   2. linkKbProductsToDrafts                            (lots + drafts -> KB)
 *   3. attachLabFactsToManifestDrafts                    (certificate facts)
 *   4. the Cultivera THC/CBD as an attached fact, source "cultivera"
 *      (shown on the row, never counted as reviewed), with provenance.
 *   4b. R74 S14 field survivorship: the vendor's manifest line (transfer file
 *      or emailed manifest) wins on name, type and cost on the OPEN rows;
 *      Cultivera keeps category and quantity (cultivera-survivorship.ts).
 *   5. one timeline note + one audit row.
 *
 * WHAT IT NEVER DOES (standing rule "sellable stays sellable"): change a lot's
 * status, quantity, cost or CCRS fields; build, stage or publish a menu
 * version; change a live card. The writes are drafts, KB rows, fact columns,
 * kb_product_id links, the timeline and the audit trail. Menu staging is
 * separately guarded (intake-menu-staging.ts skips rebuilt manifests).
 *
 * Re-runnable: the planner skips keys with an open or approved draft, the KB
 * promote and link are idempotent merges, and an unchanged fact is not
 * re-written.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { seedDraftsForManifest } from "@/lib/inventory/catalog-drafts";
import { archiveCoasForManifest } from "@/lib/inventory/coa-archive";
import { extractCoasForManifest } from "@/lib/inventory/coa-extract";
import { promoteManifestToKb } from "@/lib/inventory/manifest-kb-bridge";
import { linkKbProductsToDrafts } from "@/lib/inventory/kb-link-store";
import { attachLabFactsToManifestDrafts } from "@/lib/catalog/lab-facts-attach";
import { LAB_FACTS_ATTACH_EVENT, labFactsAttachNote } from "@/lib/catalog/lab-facts-attach-core";
import {
  DRAFT_FACT_COLUMNS,
  DRAFT_FACT_SELECT,
  PROVENANCE_TABLE,
  buildProvenanceRow,
  isMissingAttachedFactsError,
  mergeDraftAttachedFacts,
} from "@/lib/catalog/attach-facts-core";
import { identityForDraft } from "@/lib/catalog/product-identity-core";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import { attachWciaLabResults } from "@/lib/inventory/cultivera-wcia-store";
import { applyManifestSurvivorship } from "@/lib/inventory/cultivera-survivorship";
import { SURVIVORSHIP_EVENT, emptySurvivorshipRun, survivorshipNote, type SurvivorshipRun } from "@/lib/inventory/cultivera-survivorship-core";
import { CULTIVERA_WCIA_EVENT, emptyWciaResult, wciaAttachNote, type WciaAttachResult } from "@/lib/inventory/cultivera-wcia-core";
import {
  CULTIVERA_ONBOARDING_AUDIT,
  CULTIVERA_ONBOARDING_EVENT,
  CULTIVERA_SECTION_PAGE_SIZE,
  cultiveraManifestRows,
  cultiveraOnboardingNote,
  cultiveraPotencyFact,
  tallyCultiveraDrafts,
  type CultiveraManifestRow,
  type CultiveraRowView,
} from "@/lib/inventory/cultivera-onboarding-core";

/** The certificate read gets less time than a finalize: this runs in a click. */
const COA_EXTRACT_START_BUDGET_MS = 60_000;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 140);

export type CultiveraStartResult =
  | { ok: true; note: string; seeded: number }
  | { ok: false; error: string };

async function logEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  manifestId: string,
  eventType: string,
  note: string,
  actorId: string | null,
): Promise<void> {
  try {
    await admin.from("manifest_events").insert({ manifest_id: manifestId, event_type: eventType, note, actor_id: actorId });
  } catch (err) {
    console.error("[cultivera-onboarding] timeline note failed:", err);
  }
}

export async function startCultiveraManifestOnboarding(
  manifestId: string,
  actorId: string | null,
): Promise<CultiveraStartResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  if (!manifestId) return { ok: false, error: "No manifest." };
  const admin = createSupabaseAdminClient();

  // 0. Only a manifest REBUILT from the Cultivera export. A real delivery goes
  //    through Receiving; the single POS-import migration manifest is not a
  //    delivery at all. Unreadable = refuse (never guess which rules apply).
  const { data: mRow, error: mErr } = await admin
    .from("inbound_manifests")
    .select(
      "id, status, payload_kind:raw_payload->>kind, group_kind:raw_payload->>group_kind, import_id:raw_payload->>import_id, cultivera_transfer_id:raw_payload->>cultivera_transfer_id",
    )
    .eq("id", manifestId)
    .maybeSingle();
  if (mErr) return { ok: false, error: `The manifest could not be read: ${short(mErr)}` };
  const m = mRow as {
    id: string;
    status: string | null;
    payload_kind: string | null;
    group_kind?: string | null;
    import_id?: string | null;
    cultivera_transfer_id?: string | null;
  } | null;
  if (!m) return { ok: false, error: "That manifest does not exist." };
  if (m.payload_kind !== RECONSTRUCTED_MANIFEST_KIND) {
    return { ok: false, error: "Only manifests rebuilt from the Cultivera export can be started here." };
  }

  const errors: string[] = [];

  // 0b. R50 S3b: the vendor's own lab results, from the manifest's OWN Cultivera transfer file,
  //     BEFORE the chain - so seeding, the certificate archive/read and the lab facts below see the
  //     lab links exactly as on a received delivery. Fill-only; never throws (errors are reported).
  const wcia = await attachWciaLabResults(admin, manifestId, m, actorId).catch(
    (reason: unknown): WciaAttachResult => emptyWciaResult("error", [short(reason)]),
  );
  errors.push(...wcia.errors.map((e) => `vendor lab results: ${e}`));
  const wciaNote = wciaAttachNote(wcia);
  if (wciaNote) await logEvent(admin, manifestId, CULTIVERA_WCIA_EVENT, wciaNote, actorId);

  // 1. The native fan-out (same chores, same isolation as a finalize).
  const [draftsRes, coasRes, kbRes] = await Promise.allSettled([
    seedDraftsForManifest(manifestId, actorId, { reonboard: true }),
    (async () => {
      const archive = await archiveCoasForManifest(manifestId).then(
        () => null,
        (reason: unknown) => reason,
      );
      const extract = await extractCoasForManifest(manifestId, actorId, { budgetMs: COA_EXTRACT_START_BUDGET_MS }).catch(
        (reason: unknown) => ({ thrown: reason }) as const,
      );
      return { archiveError: archive, extract };
    })(),
    promoteManifestToKb(manifestId, actorId),
  ]);

  let seeded = 0;
  let skippedOpen = 0;
  let skippedOnboarded = 0;
  let sameCard = 0;
  if (draftsRes.status === "fulfilled") {
    const r = draftsRes.value;
    seeded = r.draftsCreated;
    skippedOpen = r.reonboard?.skippedOpen ?? 0;
    skippedOnboarded = r.reonboard?.skippedOnboarded ?? 0;
    sameCard = r.reonboard?.sameCard ?? 0;
    if (r.draftsFailed > 0) errors.push(`${r.draftsFailed} onboarding row(s) could not be created: ${r.firstError ?? "unknown error"}`);
    else if (r.firstError) errors.push(`onboarding rows: ${r.firstError}`);
  } else {
    errors.push(`onboarding rows could not be created: ${short(draftsRes.reason)}`);
  }
  if (coasRes.status === "rejected") errors.push(`lab certificates: ${short(coasRes.reason)}`);
  else if ("thrown" in coasRes.value.extract) errors.push(`lab certificates could not be read: ${short(coasRes.value.extract.thrown)}`);

  let kbPromoted: number | null = null;
  if (kbRes.status === "rejected") errors.push(`knowledge base: ${short(kbRes.reason)}`);
  else if (!kbRes.value.ok) errors.push(`knowledge base: ${kbRes.value.error}`);
  else kbPromoted = kbRes.value.outcome.promoted;

  // 2. Link lots + drafts to kb_products (after both settled, as in finalize).
  let kbLinked: number | null = null;
  if (draftsRes.status === "fulfilled" && draftsRes.value.lotIdentities) {
    const link = await linkKbProductsToDrafts(manifestId, draftsRes.value.lotIdentities, actorId, { restockHints: 0 });
    if (link.status === "linked") kbLinked = link.linkedProducts;
    else if (link.status === "error") errors.push(`knowledge-base link: ${link.error}`);
  }

  // 3. Certificate facts (same first-pass attach as a finalize).
  let labFacts = 0;
  if (draftsRes.status === "fulfilled") {
    const labRun = await attachLabFactsToManifestDrafts(manifestId, actorId).catch((reason: unknown) => {
      errors.push(`lab facts: ${short(reason)}`);
      return null;
    });
    if (labRun) {
      labFacts = labRun.facts;
      const labNote = labFactsAttachNote(labRun);
      if (labNote) await logEvent(admin, manifestId, LAB_FACTS_ATTACH_EVENT, labNote, actorId);
    }
  }

  // 4. Cultivera potency as an attached fact.
  const cv = await attachCultiveraPotencyFacts(admin, manifestId, actorId);
  errors.push(...cv.errors);

  // 4b. R74 S14 field survivorship: the vendor's manifest line wins on name, type and cost
  //     (the open onboarding rows only); Cultivera keeps category and quantity. Lots untouched.
  let surv: SurvivorshipRun = emptySurvivorshipRun(null);
  if (draftsRes.status === "fulfilled") {
    surv = await applyManifestSurvivorship(admin, manifestId, m, actorId).catch(
      (reason: unknown): SurvivorshipRun => ({ ...emptySurvivorshipRun(null), errors: [short(reason)] }),
    );
    errors.push(...surv.errors.map((e) => `manifest values: ${e}`));
    const survNote = survivorshipNote(surv);
    if (survNote) await logEvent(admin, manifestId, SURVIVORSHIP_EVENT, survNote, actorId);
  }

  // 5. Timeline + audit.
  const note = cultiveraOnboardingNote({
    seeded,
    skippedOpen,
    skippedOnboarded,
    sameCard,
    kbPromoted,
    kbLinked,
    labFacts,
    cultiveraFacts: cv.facts,
    vendorLabLinked: wcia.linked,
    manifestValues: surv.updated,
    errors,
  });
  await logEvent(admin, manifestId, CULTIVERA_ONBOARDING_EVENT, note, actorId);
  await recordAudit({
    actorId,
    action: CULTIVERA_ONBOARDING_AUDIT,
    entityType: "inbound_manifest",
    entityId: manifestId,
    after: {
      seeded,
      skipped_open: skippedOpen,
      skipped_onboarded: skippedOnboarded,
      same_card: sameCard,
      kb_promoted: kbPromoted,
      kb_linked: kbLinked,
      lab_facts: labFacts,
      cultivera_facts: cv.facts,
      vendor_lab: {
        status: wcia.status,
        linked: wcia.linked,
        created: wcia.created,
        reused: wcia.reused,
        skipped_changed: wcia.skippedChanged,
        outcomes: wcia.outcomes,
      },
      manifest_values: {
        source: surv.source,
        updated: surv.updated,
        unchanged: surv.unchanged,
        no_line: surv.noLine,
        ambiguous: surv.ambiguous,
        kept_human: surv.keptHuman,
        changed: surv.changedByField,
      },
      errors: errors.slice(0, 10),
      live_menu_changed: false,
    },
  }).catch(() => {});

  return { ok: true, note, seeded };
}

type FactDraftRow = {
  id: string;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  chosen_website_category: string | null;
  strain_name: string | null;
  lot_id: string | null;
  pos_product_key: string | null;
  inventory_type: string | null;
} & Record<string, unknown>;

/**
 * The Cultivera THC/CBD of each draft's lot (migration 0241 pos_* columns)
 * as a "potency" attached fact with source "cultivera". Survivorship is the
 * shared merge: a person's value is never replaced, a certificate value is
 * never replaced by this one. A value already stored is not re-written.
 */
async function attachCultiveraPotencyFacts(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  manifestId: string,
  actorId: string | null,
): Promise<{ facts: number; errors: string[] }> {
  const errors: string[] = [];
  const dr = await admin
    .from("catalog_product_drafts")
    .select(
      `id, name, brand_name, vendor_name, category, chosen_website_category, strain_name, lot_id, pos_product_key, inventory_type, ${DRAFT_FACT_SELECT}`,
    )
    .eq("manifest_id", manifestId)
    .in("status", ["draft", "approved"]);
  if (dr.error) {
    if (isMissingAttachedFactsError(dr.error)) return { facts: 0, errors: ["Cultivera potency not attached: migration 0235 (attached facts) is not applied"] };
    return { facts: 0, errors: [`Cultivera potency: onboarding rows could not be read: ${short(dr.error)}`] };
  }
  const drafts = ((dr.data as unknown as FactDraftRow[] | null) ?? []).filter((d) => d.lot_id);
  if (drafts.length === 0) return { facts: 0, errors };

  const lotIds = Array.from(new Set(drafts.map((d) => d.lot_id as string)));
  const lots = new Map<string, { pos_thc: unknown; pos_cbd: unknown; pos_potency_unit: unknown }>();
  const CHUNK = 150;
  for (let i = 0; i < lotIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, pos_thc, pos_cbd, pos_potency_unit")
      .in("id", lotIds.slice(i, i + CHUNK));
    if (error) {
      // 0241 not applied, or a read failure: say so; nothing is invented.
      return { facts: 0, errors: [`Cultivera potency could not be read: ${short(error)}`] };
    }
    for (const l of (data as { id: string; pos_thc: unknown; pos_cbd: unknown; pos_potency_unit: unknown }[] | null) ?? []) {
      lots.set(l.id, l);
    }
  }

  const at = new Date().toISOString();
  let facts = 0;
  const provRows: unknown[] = [];
  for (const d of drafts) {
    const lot = lots.get(d.lot_id as string);
    if (!lot) continue;
    const fact = cultiveraPotencyFact(lot);
    if (!fact) continue;
    const existing = (d[DRAFT_FACT_COLUMNS[0]] ?? {}) as Record<string, { value?: unknown; source?: unknown } | undefined>;
    const cur = existing && typeof existing === "object" ? existing[fact.field] : undefined;
    if (cur && cur.source === fact.source && cur.value === fact.value) continue; // unchanged
    const merged = mergeDraftAttachedFacts({
      existingFacts: d[DRAFT_FACT_COLUMNS[0]],
      existingProvenance: d[DRAFT_FACT_COLUMNS[1]],
      landed: [fact],
      at,
      by: actorId,
      urls: [],
    });
    if (!merged.patch) continue;
    const up = await admin.from("catalog_product_drafts").update(merged.patch).eq("id", d.id);
    if (up.error) {
      errors.push(`${(d.name ?? "a row").slice(0, 60)}: ${short(up.error)}`);
      continue;
    }
    facts += 1;
    const built = buildProvenanceRow({
      identityKey: identityForDraft(d).identityKey,
      field: fact.field,
      value: fact.value,
      source: fact.source,
      confidence: null,
      draftId: d.id,
      lotId: d.lot_id,
      posProductKey: d.pos_product_key,
      actorId,
    });
    if (built.ok) provRows.push(built.row);
  }
  if (provRows.length > 0) {
    try {
      const { error } = await admin.from(PROVENANCE_TABLE).insert(provRows as never);
      if (error && !isMissingAttachedFactsError(error)) errors.push(`fact history not recorded: ${short(error)}`);
    } catch (err) {
      errors.push(`fact history not recorded: ${short(err)}`);
    }
  }
  return { facts, errors };
}

export type CultiveraSection =
  | { ok: true; rows: CultiveraRowView[]; total: number; page: number; pageCount: number }
  | { ok: false; error: string };

/**
 * The "Cultivera manifests" section: rebuilt manifests (newest received
 * first), one page at a time, each with its onboarding progress. A failed
 * draft tally shows "Unknown", never "Not started".
 */
export async function loadCultiveraManifestSection(page: number): Promise<CultiveraSection> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const size = CULTIVERA_SECTION_PAGE_SIZE;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const from = (safePage - 1) * size;
  const { data, error, count } = await admin
    .from("inbound_manifests")
    .select("id, manifest_number, vendor_label, transfer_date, accepted_at, accepted_lot_count", { count: "exact" })
    .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
    .order("accepted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + size - 1);
  if (error) return { ok: false, error: short(error) };
  const manifests = (data as CultiveraManifestRow[] | null) ?? [];
  const total = count ?? manifests.length;
  let tally: ReturnType<typeof tallyCultiveraDrafts> | null = null;
  if (manifests.length > 0) {
    // Paged (PostgREST caps a response): a truncated read would under-count
    // and could show "Not started" on a manifest that is in review.
    const all: { manifest_id: string | null; status: string | null }[] = [];
    let failed = false;
    const PAGE = 1000;
    for (let off = 0; off < 100_000; off += PAGE) {
      const { data: dRows, error: dErr } = await admin
        .from("catalog_product_drafts")
        .select("id, manifest_id, status")
        .in(
          "manifest_id",
          manifests.map((m) => m.id),
        )
        .order("id", { ascending: true })
        .range(off, off + PAGE - 1);
      if (dErr) {
        failed = true;
        break;
      }
      const got = (dRows as { manifest_id: string | null; status: string | null }[] | null) ?? [];
      all.push(...got);
      if (got.length < PAGE) break;
    }
    if (!failed) tally = tallyCultiveraDrafts(all);
  }
  return {
    ok: true,
    rows: cultiveraManifestRows(manifests, tally),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * Which of these manifests were rebuilt from the Cultivera export (their
 * onboarding rows are already-selling cards: no price field, live price).
 * On a read failure returns null - the page then shows the ordinary row, and
 * the server still applies the right rule at approval (it re-reads the kind).
 */
export async function loadRebuiltManifestIds(ids: readonly (string | null)[]): Promise<Set<string> | null> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  const out = new Set<string>();
  if (unique.length === 0 || !isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const CHUNK = 150;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, payload_kind:raw_payload->>kind")
      .in("id", unique.slice(i, i + CHUNK));
    if (error) return null;
    for (const r of (data as { id: string; payload_kind: string | null }[] | null) ?? []) {
      if (r.payload_kind === RECONSTRUCTED_MANIFEST_KIND) out.add(r.id);
    }
  }
  return out;
}
