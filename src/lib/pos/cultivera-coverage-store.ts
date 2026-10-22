/**
 * src/lib/pos/cultivera-coverage-store.ts — R74 S8. Reads for the per-lot coverage report.
 *
 * Read-only. Builds the SAME transfer plan the rebuild page and Apply use (loadRehomeSources +
 * planFromSources), then reads only the harvested documents (cultivera_mail_docs, 0293) that list at
 * least one of the lots the transfer match left open (barcodes && open, GIN index), pages through
 * every match (fail closed: a short page read is an error, never a silent subset), and hands both to
 * the pure buildCoverageReport. Before 0293 is applied the report says the email was NOT checked.
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadRehomeSources, type RehomeSources } from "@/lib/inventory/cultivera-rehome-store";
import { planFromSources } from "@/lib/inventory/cultivera-rehome-core";
import { HARVEST_DOCS_TABLE, mailDocsFromRows, type StoredDocFacts } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { buildCoverageReport, openBarcodes, type CoverageReport } from "@/lib/pos/cultivera-coverage-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Barcodes per overlap query (kept short for the URL) and rows per page. */
export const COVERAGE_BARCODE_CHUNK = 150;
export const COVERAGE_PAGE = 500;

const DOC_SELECT = "id, gmail_id, email_at, filename, status, source_format, manifest_number, vendor_label, vendor_license, transfer_date, lines";

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache|could not find the table/i.test(err.message ?? "");
}

/** Parsed harvested documents that list any of these barcodes; null = the table is not there yet (0293). */
export async function readDocsForBarcodes(admin: Admin, barcodes: readonly string[]): Promise<StoredDocFacts[] | null> {
  const unique = [...new Set(barcodes.filter(Boolean))].sort();
  const byId = new Map<string, StoredDocFacts>();
  if (unique.length === 0) {
    // Still prove the table exists, so "not checked" and "nothing found" are never confused.
    const { error } = await admin.from(HARVEST_DOCS_TABLE).select("id", { head: true, count: "exact" }).limit(1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(`reading harvested email documents: ${error.message}`);
    }
    return [];
  }
  for (let i = 0; i < unique.length; i += COVERAGE_BARCODE_CHUNK) {
    const chunk = unique.slice(i, i + COVERAGE_BARCODE_CHUNK);
    for (let from = 0; ; from += COVERAGE_PAGE) {
      const { data, error } = await admin
        .from(HARVEST_DOCS_TABLE)
        .select(DOC_SELECT)
        .eq("status", "parsed")
        .overlaps("barcodes", chunk)
        .order("id", { ascending: true })
        .range(from, from + COVERAGE_PAGE - 1);
      if (error) {
        if (isMissingTable(error)) return null;
        throw new Error(`reading harvested email documents: ${error.message}`);
      }
      const rows = (data ?? []) as (StoredDocFacts & { id: string })[];
      for (const r of rows) byId.set(r.id, r);
      if (rows.length < COVERAGE_PAGE) break;
    }
  }
  return [...byId.values()];
}

export type CoverageLoad = { ok: true; report: CoverageReport } | { ok: false; error: string };

/** `sources` lets a page that also previews the email step (S10) read the workbooks once. */
export async function loadCoverage(admin: Admin, importId: string, given?: RehomeSources): Promise<CoverageLoad> {
  try {
    const sources = given ?? (await loadRehomeSources(admin, importId));
    const { plan } = planFromSources(sources.lotSources, sources.transfers, sources.links, sources.pacificToday, sources.indexSkipped ?? 0);
    const rows = await readDocsForBarcodes(admin, openBarcodes(sources.lotSources, plan));
    const docs = rows === null ? null : mailDocsFromRows(rows);
    return { ok: true, report: buildCoverageReport(sources.lotSources, plan, docs) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
