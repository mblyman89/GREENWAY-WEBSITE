/**
 * src/lib/inventory/coa-from-cultivera-store.ts   (D200, steps 1 + 2 of D199)
 *
 * The I/O half of the two Fix later buttons:
 *
 *   startCoaFetch   "Fetch COAs from Cultivera": reads which Cultivera
 *                   transfers still have stocked lots with no COA, asks the
 *                   crawler to fetch ONLY those vendor WCIA files (read-only
 *                   against Cultivera, saved credentials on the crawler),
 *                   remembers the run in site_settings, audits.
 *   attachAllCoas   "Attach all COAs": saves the fetched files under each
 *                   manifest's own import key (where the import keeps them),
 *                   runs the existing attachWciaLabResults per manifest, then
 *                   fills what is still missing from the WCIA JSONs already
 *                   crawled from Gmail (cultivera_mail_docs, barcode overlap).
 *                   A dry run reads everything and writes nothing.
 *
 * Writes (real run only): pos-raw storage files, lab_results inserts,
 * inventory_lots.lab_result_id where EMPTY (+ updated_by), manifest_events
 * notes, site_settings (the run marker), audit rows. Never a status,
 * quantity, cost, CCRS field, price or menu card. Never throws to the caller.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import { recordAudit } from "@/lib/auth/audit";
import { parseVendorJson, type ParsedLine } from "@/lib/inventory/intake-parser";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import { applyWciaLinkPlan, attachWciaLabResults, loadWciaText, saveWciaFiles } from "@/lib/inventory/cultivera-wcia-store";
import { CULTIVERA_WCIA_EVENT, emptyWciaResult, planWciaLabLinks, wciaAttachNote, type WciaAttachResult } from "@/lib/inventory/cultivera-wcia-core";
import { getPosRun, loadWciaRunRecords, startWciaRun } from "@/lib/pos/cultivera-fetch-client";
import type { CrawlerRun } from "@/lib/pos/cultivera-fetch-button-core";
import {
  COA_ATTACH_AUDIT,
  COA_ATTACH_BUDGET_MS,
  COA_FETCH_AUDIT,
  COA_RUN_SETTING_KEY,
  COA_RUN_SETTING_LABEL,
  MAIL_BARCODE_CHUNK,
  chunk,
  emptyCoaTotals,
  groupFetchedFiles,
  isMailHarvestKey,
  mailLinesForBarcodes,
  parseCoaRunSetting,
  planCoaTargets,
  pushError,
  type CoaAttachTotals,
  type CoaLotRow,
  type CoaManifestRow,
  type CoaRunSetting,
  type CoaTargets,
} from "@/lib/inventory/coa-from-cultivera-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

// --- reads ------------------------------------------------------------------------

type TargetsRead = { ok: true; lots: CoaLotRow[]; targets: CoaTargets } | { ok: false; error: string };

/** Every stocked lot with no COA, and the rebuilt Cultivera manifests they sit on. */
export async function readCoaTargets(admin: Admin): Promise<TargetsRead> {
  const lotsRead = await pagedAllChecked<CoaLotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, manifest_id, lot_code, status, lab_result_id, on_hand_qty")
      .gt("on_hand_qty", 0)
      .is("lab_result_id", null)
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) console.error("[coa-from-cultivera] lots read failed:", error.message);
    return { ok: !error, rows: (data as CoaLotRow[] | null) ?? [] };
  });
  if (!lotsRead.verdict.complete) return { ok: false, error: `the lots with no COA could not be read in full (${lotsRead.verdict.message})` };
  const manifestIds = [...new Set(lotsRead.rows.map((l) => l.manifest_id).filter((x): x is string => Boolean(x)))];
  let readError: string | null = null;
  const manifests = await chunkedIn<string, CoaManifestRow>(manifestIds, async (ids, from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, import_id:raw_payload->>import_id, cultivera_transfer_id:raw_payload->>cultivera_transfer_id, kind:raw_payload->>kind")
      .in("id", ids)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) readError ??= short(error);
    return (data as CoaManifestRow[] | null) ?? [];
  });
  if (readError) return { ok: false, error: `the manifests could not be read (${readError})` };
  return { ok: true, lots: lotsRead.rows, targets: planCoaTargets(lotsRead.rows, manifests, RECONSTRUCTED_MANIFEST_KIND) };
}

async function readRunSetting(admin: Admin): Promise<{ ok: true; setting: CoaRunSetting | null } | { ok: false; error: string }> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", COA_RUN_SETTING_KEY).maybeSingle();
  if (error) return { ok: false, error: short(error) };
  return { ok: true, setting: parseCoaRunSetting((data as { value_json?: unknown } | null)?.value_json) };
}

async function writeRunSetting(admin: Admin, setting: CoaRunSetting, actorId: string | null): Promise<string | null> {
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: COA_RUN_SETTING_KEY, label: COA_RUN_SETTING_LABEL, value_json: setting, updated_by: actorId }, { onConflict: "key" });
  return error ? short(error) : null;
}

export type CoaPanel = {
  ok: boolean;
  error: string | null;
  missingLots: number;
  transferIds: number[];
  lotsOffCultivera: number;
  setting: CoaRunSetting | null;
  run: CrawlerRun | null;
  runError: string | null;
};

/** What the Fix later panel shows (never throws). */
export async function readCoaPanel(): Promise<CoaPanel> {
  const empty: CoaPanel = { ok: false, error: null, missingLots: 0, transferIds: [], lotsOffCultivera: 0, setting: null, run: null, runError: null };
  if (!isSupabaseServiceConfigured) return { ...empty, error: "the database is not configured" };
  try {
    const admin = createSupabaseAdminClient();
    const [t, s] = await Promise.all([readCoaTargets(admin), readRunSetting(admin)]);
    if (!t.ok) return { ...empty, error: t.error };
    const panel: CoaPanel = {
      ...empty,
      ok: true,
      missingLots: t.targets.missingLots,
      transferIds: t.targets.transferIds,
      lotsOffCultivera: t.targets.lotsOffCultivera,
      setting: s.ok ? s.setting : null,
      error: s.ok ? null : `the last crawl could not be read (${s.error})`,
    };
    if (panel.setting) {
      try {
        panel.run = await getPosRun(panel.setting.runId);
        if (!panel.run) panel.runError = "The crawler no longer has this crawl (it was redeployed or pruned). Click Fetch again.";
      } catch (e) {
        panel.runError = `The crawler could not be reached: ${short(e)}`;
      }
    }
    return panel;
  } catch (e) {
    return { ...empty, error: short(e) };
  }
}

// --- button 1: fetch ----------------------------------------------------------------

export async function startCoaFetch(actorId: string | null): Promise<{ ok: true; runId: string; transfers: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "the database is not configured" };
  try {
    const admin = createSupabaseAdminClient();
    const t = await readCoaTargets(admin);
    if (!t.ok) return { ok: false, error: t.error };
    if (t.targets.transferIds.length === 0) return { ok: false, error: "No stocked lot without a COA is on a Cultivera transfer: nothing to fetch." };
    const run = await startWciaRun(t.targets.transferIds);
    const setting: CoaRunSetting = { runId: run.runId, transferIds: t.targets.transferIds, startedAt: new Date().toISOString(), savedAt: null };
    const werr = await writeRunSetting(admin, setting, actorId);
    if (werr) console.error("[coa-from-cultivera] run marker not saved:", werr);
    await recordAudit({
      actorId,
      action: COA_FETCH_AUDIT,
      entityType: "inventory_lot",
      entityId: null,
      after: { run_id: run.runId, transfer_ids: t.targets.transferIds, missing_lots: t.targets.missingLots, marker_error: werr },
    }).catch((e: unknown) => console.error("[coa-from-cultivera] audit failed:", e));
    return { ok: true, runId: run.runId, transfers: t.targets.transferIds.length };
  } catch (e) {
    return { ok: false, error: short(e) };
  }
}

// --- button 2: attach -------------------------------------------------------------------

type MailDocRow = { storage_key: string | null };

export type CoaAttachOptions = { dryRun?: boolean; admin?: Admin; now?: () => number; budgetMs?: number };

export async function attachAllCoas(actorId: string | null, opts: CoaAttachOptions = {}): Promise<CoaAttachTotals> {
  const dryRun = opts.dryRun === true;
  const totals = emptyCoaTotals(dryRun);
  if (!opts.admin && !isSupabaseServiceConfigured) {
    pushError(totals, "the database is not configured");
    return totals;
  }
  const admin = opts.admin ?? createSupabaseAdminClient();
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? COA_ATTACH_BUDGET_MS;
  const t0 = now();
  try {
    const read = await readCoaTargets(admin);
    if (!read.ok) {
      pushError(totals, read.error);
      return totals;
    }
    totals.missingBefore = read.targets.missingLots;
    totals.manifests = read.targets.manifests.length;

    // 1. The files the crawl fetched from Cultivera (if any), saved where the import keeps them.
    let byTransfer = new Map<number, string>();
    const s = await readRunSetting(admin);
    if (!s.ok) pushError(totals, `the last crawl could not be read (${s.error})`);
    else if (s.setting) {
      const run = await getPosRun(s.setting.runId).catch(() => null);
      const status = run?.state?.status;
      if (run?.active || status === "running") pushError(totals, "the Cultivera crawl is still running; its files were not used yet (click again when it says done)");
      else {
        const loaded = await loadWciaRunRecords(s.setting.runId);
        if (loaded.kind === "error") pushError(totals, `the crawl's files could not be read (${loaded.error})`);
        else if (loaded.kind === "ok") {
          const g = groupFetchedFiles(loaded.records, read.targets.manifests);
          byTransfer = g.byTransfer;
          totals.fetchedFiles = g.byTransfer.size;
          if (!dryRun) {
            for (const [importId, records] of g.byImport) {
              const r = await saveWciaFiles(admin, importId, records);
              totals.filesSaved += r.saved;
              if (r.failed > 0) pushError(totals, `${r.failed} Cultivera files could not be saved (${r.firstError ?? "?"})`);
            }
            const werr = await writeRunSetting(admin, { ...s.setting, savedAt: new Date().toISOString() }, actorId);
            if (werr) console.error("[coa-from-cultivera] run marker not updated:", werr);
          }
        }
        // "missing": the crawler lost the run; the files saved by an earlier click are still read below.
      }
    }

    // 2. The existing attach, per rebuilt manifest that still has no-COA lots.
    const linked = new Set<string>();
    for (const m of read.targets.manifests) {
      const r: WciaAttachResult = await attachWciaLabResults(
        admin,
        m.id,
        { import_id: m.importId, cultivera_transfer_id: String(m.transferId) },
        actorId,
        { dryRun, text: byTransfer.get(m.transferId) },
      ).catch((reason: unknown) => emptyWciaResult("error", [short(reason)]));
      totals.linkedFromCultivera += r.linked;
      totals.created += r.created;
      totals.reused += r.reused;
      totals.skippedChanged += r.skippedChanged;
      totals.ambiguous += r.outcomes.ambiguous;
      for (const id of r.linkedLotIds ?? []) linked.add(id);
      for (const e of r.errors) pushError(totals, `${m.manifestNumber ?? m.id.slice(0, 8)}: ${e}`);
      const note = wciaAttachNote(r);
      if (!dryRun && note && (r.linked > 0 || r.created > 0 || r.errors.length > 0)) {
        const { error } = await admin.from("manifest_events").insert({ manifest_id: m.id, event_type: CULTIVERA_WCIA_EVENT, note, actor_id: actorId });
        if (error) console.error("[coa-from-cultivera] timeline note failed:", error.message);
      }
    }

    // 3. What is still missing: the WCIA JSONs already crawled from Gmail (D199 step 1).
    const rest = read.lots.filter((l) => !linked.has(l.id) && (l.lot_code ?? "").trim());
    const barcodes = new Set(rest.map((l) => (l.lot_code ?? "").trim()));
    if (rest.length > 0) {
      const keys = new Set<string>();
      for (const part of chunk([...barcodes].sort(), MAIL_BARCODE_CHUNK)) {
        const { data, error } = await admin
          .from("cultivera_mail_docs")
          .select("storage_key")
          .eq("source_format", "wcia")
          .eq("status", "parsed")
          .overlaps("barcodes", part)
          .limit(1000);
        if (error) {
          pushError(totals, `the Gmail files could not be searched (${short(error)})`);
          continue;
        }
        for (const row of (data as MailDocRow[] | null) ?? []) if (isMailHarvestKey(row.storage_key)) keys.add(row.storage_key);
      }
      const docs: ParsedLine[][] = [];
      for (const key of [...keys].sort()) {
        if (now() - t0 > budget) {
          totals.stoppedForTime = true;
          break;
        }
        const loaded = await loadWciaText(admin, key);
        if (loaded.kind !== "ok") continue; // not a WCIA document / gone: nothing to read
        const parsed = parseVendorJson(loaded.text);
        if (!parsed.ok) continue;
        totals.mailDocsRead += 1;
        docs.push(parsed.manifest.lines);
      }
      const lines = mailLinesForBarcodes(docs, barcodes);
      if (lines.length > 0) {
        const plan = planWciaLabLinks(
          rest.map((l) => ({ id: l.id, lot_code: l.lot_code, status: l.status, lab_result_id: l.lab_result_id })),
          { lines },
        );
        totals.ambiguous += plan.outcomes.ambiguous;
        const r = await applyWciaLinkPlan(admin, plan, "wcia", actorId, emptyWciaResult("attached"), { dryRun }).catch((reason: unknown) =>
          emptyWciaResult("error", [short(reason)]),
        );
        totals.linkedFromMail += r.linked;
        totals.created += r.created;
        totals.reused += r.reused;
        totals.skippedChanged += r.skippedChanged;
        for (const e of r.errors) pushError(totals, `Gmail files: ${e}`);
      }
    }

    // 4. The honest count after the run.
    if (dryRun) totals.stillMissing = Math.max(0, totals.missingBefore - totals.linkedFromCultivera - totals.linkedFromMail);
    else {
      const after = await readCoaTargets(admin);
      totals.stillMissing = after.ok ? after.targets.missingLots : Math.max(0, totals.missingBefore - totals.linkedFromCultivera - totals.linkedFromMail);
    }
  } catch (e) {
    pushError(totals, short(e));
  }
  if (!dryRun) {
    await recordAudit({
      actorId,
      action: COA_ATTACH_AUDIT,
      entityType: "inventory_lot",
      entityId: null,
      after: { ...totals },
    }).catch((e: unknown) => console.error("[coa-from-cultivera] audit failed:", e));
  }
  return totals;
}
