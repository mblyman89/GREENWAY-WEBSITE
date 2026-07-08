/**
 * src/lib/inventory/kb-backfill-core.ts — Slice H12g, PURE core.
 *
 * Owner: "I clicked the button on the promote all to kb, I'm not sure if it
 * works, I don't get a confirmation and I'm not sure where I should look on
 * the kb page to see if I promoted anything to it."
 *
 * Why the old confirmation was missable: the backfill action swept up to
 * 1000 manifests in ONE serverless call and only then redirected with the
 * banner — a big backlog can outlive the function timeout, so the redirect
 * (and its banner) never lands. Fix: the intake page now runs the backfill
 * from a client panel in SMALL CHUNKS (live progress, per-chunk server
 * calls that always finish fast) and ends with an unmissable success card
 * linking straight to the KB Review inbox where the drafts appear.
 *
 * These helpers are pure so tests/compliance can pin the chunking and the
 * exact wording of the confirmation.
 */

/** Manifests promoted per server call — small enough to never time out. */
export const KB_BACKFILL_CHUNK_SIZE = 5;

/** Where promoted drafts appear — the KB Review inbox (drafts lane). */
export const KB_REVIEW_INBOX_PATH = "/admin/knowledge-base/review";

/** Split manifest ids into promotion chunks, dropping blanks/dupes. */
export function chunkManifestIds(ids: string[]): string[][] {
  const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += KB_BACKFILL_CHUNK_SIZE) {
    chunks.push(clean.slice(i, i + KB_BACKFILL_CHUNK_SIZE));
  }
  return chunks;
}

/** One manifest's promotion result, as returned by the chunk action. */
export type KbChunkOutcome = {
  manifestId: string;
  ok: boolean;
  promoted: number;
  strainsEnriched: number;
  vendorLicenseFilled: boolean;
  error: string | null;
};

/** Totals across the whole run — what the confirmation card shows. */
export type KbBackfillSummary = {
  manifestsProcessed: number;
  promoted: number;
  strainsEnriched: number;
  vendorLicensesFilled: number;
  errors: number;
};

export function summarizeKbBackfill(outcomes: KbChunkOutcome[]): KbBackfillSummary {
  const s: KbBackfillSummary = {
    manifestsProcessed: outcomes.length,
    promoted: 0,
    strainsEnriched: 0,
    vendorLicensesFilled: 0,
    errors: 0,
  };
  for (const o of outcomes) {
    if (!o.ok) {
      s.errors += 1;
      continue;
    }
    s.promoted += o.promoted;
    s.strainsEnriched += o.strainsEnriched;
    if (o.vendorLicenseFilled) s.vendorLicensesFilled += 1;
  }
  return s;
}

/** The confirmation sentence — plain language, pinned in tests. */
export function kbBackfillMessage(s: KbBackfillSummary): string {
  const parts = [
    `Done — ${s.manifestsProcessed} manifest${s.manifestsProcessed === 1 ? "" : "s"} processed, ` +
      `${s.promoted} product fact${s.promoted === 1 ? "" : "s"} promoted as KB drafts`,
  ];
  if (s.strainsEnriched > 0) parts.push(`${s.strainsEnriched} strain(s) gap-filled`);
  if (s.vendorLicensesFilled > 0) parts.push(`${s.vendorLicensesFilled} vendor license(s) captured`);
  if (s.errors > 0) parts.push(`${s.errors} manifest(s) had errors — see server logs`);
  return `${parts.join("; ")}. Nothing was published — validate the drafts in the Review inbox.`;
}
