/**
 * src/lib/inbound-email/inbound-store.ts  (Slice 99)
 *
 * Server-side persistence for inbound vendor_intake@ emails. Two jobs:
 *
 *   1) logInboundEmail(...)   — always record the arrival in inbound_email_log
 *                               (audit trail, migration 0062), even when the
 *                               email is ignored or has no manifest.
 *   2) stageManifestsFromEmail — for each textual attachment that parses as a
 *                               vendor manifest (JSON transfer OR CCRS CSV),
 *                               stage a PENDING draft via the existing
 *                               intake-store.stageManifest so it appears in
 *                               /admin/inventory/intake for a human to validate.
 *
 * DRAFTS-ONLY (standing rule): nothing here activates stock, files anything with
 * CCRS, or bypasses review. A parsed attachment becomes a pending manifest and a
 * log row; a human accepts/rejects it in the existing review UI.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  parseVendorJson,
  looksLikeWciaTransferStrict,
  type ParsedManifest,
} from "@/lib/inventory/intake-parser";
import {
  parseCcrsManifestCsv,
  ccrsToParsedManifest,
  ccrsTransportToParsed,
} from "@/lib/inventory/ccrs-manifest-csv-core";
import {
  stageManifest,
  setManifestLifecycle,
  backfillManifestTransport,
} from "@/lib/inventory/intake-store";
import type {
  NormalizedInboundEmail,
  NormalizedAttachment,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  manifestCandidates,
  pdfCandidates,
  classifyAttachmentRole,
  type AttachmentRole,
} from "@/lib/inbound-email/inbound-normalize-core";

/** Order PDFs so we try the likeliest manifest first: manifest > invoice > unknown. */
function pdfRoleRank(role: AttachmentRole): number {
  switch (role) {
    case "manifest":
      return 0;
    case "invoice":
      return 1;
    case "unknown":
      return 2;
    default:
      return 3; // coa — never a manifest candidate (still read + merged + archived separately)
  }
}
import { parsePdfManifestFromBase64, parseCoaFromBase64 } from "@/lib/inventory/pdf-extract";
import {
  mergeInvoicePricesByLot,
  mergeCoaByLot,
  chooseTransportDonor,
  foldTransport,
  type TransportDonor,
} from "@/lib/inventory/manifest-merge-core";
import { extractCultiveraInvoiceTransport } from "@/lib/inventory/pdf-cultivera-invoice-core";
import { extractGenericPdfTransport } from "@/lib/inventory/pdf-generic-transport-core";
import { archiveEmailedCoaForManifest } from "@/lib/inventory/coa-archive";
import { archiveManifestDocuments } from "@/lib/inventory/manifest-docs";
import { mergeTransportFillEmpty } from "@/lib/inventory/manifest-merge-core";
import { classifyMinerKind, type MinerSource } from "@/lib/inventory/vendor-goldminer-core";
import { enrichVendorFromIntakeDocs } from "@/lib/inventory/vendor-goldminer-store";

export type InboundDisposition =
  | "received"
  | "ignored"
  | "no_manifest"
  | "staged"
  // H16b-7: the email's manifest(s) were already live in intake (a re-send /
  // duplicate) so nothing new was staged. Distinct from parse_failed: this is a
  // safe skip, not an error.
  | "duplicate"
  | "parse_failed";

/**
 * H15b — the outcome of trying to read one textual attachment on the
 * UNATTENDED email path. Three-way so junk is distinguished from failure:
 *  - "manifest":    verifiably a manifest (strict WCIA JSON or CCRS CSV) with
 *                   at least one line — stage it.
 *  - "junk":        readable data that is verifiably NOT a manifest (tracking
 *                   exports, receipts, arbitrary JSON/CSV) — log, never stage,
 *                   and do NOT count as a parse failure (it wasn't supposed to
 *                   be one).
 *  - "unparseable": something that SHOULD have been a manifest (a .json that
 *                   won't parse, or a real WCIA transfer with zero items) —
 *                   a genuine failure a human should chase.
 */
export type AttachmentParseOutcome =
  | { kind: "manifest"; manifest: ParsedManifest }
  | { kind: "junk" }
  | { kind: "unparseable" };

/**
 * Classify + parse one textual attachment for the email path (H15b strict
 * manifests-only gate). Manual paste/import paths keep the tolerant
 * parseVendorJson on purpose — there a HUMAN chose the payload; here nothing
 * has been reviewed yet, so only verifiable manifests may create rows.
 */
export function parseAttachmentStrict(att: NormalizedAttachment): AttachmentParseOutcome {
  const text = att.text;
  if (!text || !text.trim()) return { kind: "junk" };

  const fn = (att.filename ?? "").toLowerCase();
  const ct = (att.contentType ?? "").toLowerCase();
  const looksCsv = ct.includes("csv") || fn.endsWith(".csv");
  const looksJson = ct.includes("json") || fn.endsWith(".json");

  if (looksCsv) {
    const parsed = parseCcrsManifestCsv(text);
    if (parsed.ok) {
      const mapped = ccrsToParsedManifest(parsed);
      if (mapped.lines.length > 0) {
        return {
          kind: "manifest",
          manifest: {
            manifest_number: mapped.manifest_number,
            vendor_label: mapped.vendor_label,
            vendor_license: mapped.vendor_license,
            transfer_date: mapped.transfer_date,
            source_format: "ccrs-csv",
            lines: mapped.lines,
            warnings: mapped.warnings,
            // H15a: ride the CCRS header transport along so stageManifest seeds
            // chain-of-custody + ETA for emailed CSVs too.
            transport: ccrsTransportToParsed(mapped.transport),
          },
        };
      }
      // Structurally a CCRS manifest but zero items (e.g. the blank LCB
      // template) — nothing to stage, nothing failed.
      return { kind: "junk" };
    }
    // fall through: some CSV exports are actually JSON mislabeled — try JSON too
  }

  // JSON: parse the root ourselves so we can apply the STRICT WCIA check
  // before the tolerant parser gets a chance to invent a "generic" manifest
  // out of arbitrary JSON (the junk-staging hole this gate closes).
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    // A file that claims to be JSON but doesn't parse is a genuine failure;
    // any other unreadable text is just junk in the mailbox.
    return looksJson ? { kind: "unparseable" } : { kind: "junk" };
  }
  if (!looksLikeWciaTransferStrict(root)) return { kind: "junk" };

  const json = parseVendorJson(text);
  if (json.ok && json.manifest.lines.length > 0) {
    return { kind: "manifest", manifest: json.manifest };
  }
  // Verifiably a WCIA transfer but no usable lines — that's a real failure.
  return { kind: "unparseable" };
}

/**
 * Back-compat helper: the manifest if the attachment strictly parses as one,
 * else null. (The email loop uses parseAttachmentStrict directly so junk is
 * not miscounted as failure.)
 */
export function parseAttachmentToManifest(att: NormalizedAttachment): ParsedManifest | null {
  const outcome = parseAttachmentStrict(att);
  return outcome.kind === "manifest" ? outcome.manifest : null;
}

/** Persist the inbound-email audit row. Best-effort; never throws. */
export async function logInboundEmail(params: {
  email: NormalizedInboundEmail;
  signatureOk: boolean | null;
  toIntake: boolean;
  disposition: InboundDisposition;
  manifestId: string | null;
  note: string | null;
  rawHeaders?: Record<string, string> | null;
}): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("inbound_email_log").insert({
      provider: params.email.provider,
      from_address: params.email.from || null,
      to_addresses: params.email.to,
      subject: params.email.subject || null,
      received_at: params.email.receivedAt,
      signature_ok: params.signatureOk,
      to_intake: params.toIntake,
      attachment_count: params.email.attachments.length,
      disposition: params.disposition,
      manifest_id: params.manifestId,
      note: params.note,
      raw_headers: params.rawHeaders ?? null,
    });
  } catch (err) {
    console.error("[inbound-email] failed to write inbound_email_log:", err);
  }
}

export type StageFromEmailResult = {
  staged: number;
  manifestIds: string[];
  parseFailures: number;
  /**
   * H16b-7: manifests that were NOT staged because an identical one is already
   * live in intake (a re-sent email / duplicate). These are intentionally kept
   * SEPARATE from parseFailures \u2014 a skipped duplicate is expected, safe
   * behavior, not an error worth alarming on.
   */
  duplicates: number;
  /**
   * H18: how many transport FIELDS were backfilled onto ALREADY-staged
   * manifests because this email was a duplicate re-send carrying transport
   * data the original staging missed (fill-only-empty; arrived_at never).
   */
  transportBackfills: number;
};

/**
 * Stage every attachment on the email that parses as a manifest. The raw email
 * (subject + from) is kept as the sourceUrl-less rawPayload context via a note.
 */
export async function stageManifestsFromEmail(
  email: NormalizedInboundEmail,
  actorId: string | null,
): Promise<StageFromEmailResult> {
  const result: StageFromEmailResult = {
    staged: 0,
    manifestIds: [],
    parseFailures: 0,
    duplicates: 0,
    transportBackfills: 0,
  };
  const textCandidates = manifestCandidates(email);
  const pdfCands = pdfCandidates(email);
  if (textCandidates.length === 0 && pdfCands.length === 0) return result;

  // H17 — PDF TRANSPORT DONORS. The real Cultivera bundle (owner-verified,
  // SPR ORD-24706): the WCIA JSON is the richest LINE source and stages the
  // manifest, but its transporter_name/transporter_license are NULL — the
  // driver / vehicle / plate / VIN live in the Manifest PDF riding the SAME
  // email. The old flow staged the JSON and then SKIPPED the PDF branch
  // entirely (stagedFromJson), so the review form's transport section stayed
  // empty. Now every manifest-capable PDF is parsed up front as a potential
  // transport DONOR, and each JSON/CSV manifest folds the matching donor's
  // transport in BEFORE staging (fill-only-when-empty, arrived_at never
  // sourced from documents, manifest-number matched — chooseTransportDonor).
  // H18: donors are now built whenever ANY PDF rides the email (not only when
  // a textual manifest is also present) so the PDF-primary path below can fold
  // a sibling document's transport too.
  // SLICE 102 — vendor GOLD MINER sources. Every non-COA PDF's extracted text
  // is kept (tagged manifest / invoice / transport) so that, after a manifest
  // stages, the vendor's own paperwork can gap-fill the vendor profile
  // (email, phone, license, address). COAs are deliberately excluded — a lab
  // report prints the LAB's contact details, which must never be proposed as
  // the vendor's. The email body rides along as the last-resort source.
  const minerSources: MinerSource[] = [];
  const pdfDonors: TransportDonor[] = [];
  const invoiceDonors: TransportDonor[] = [];
  if (pdfCands.length > 0) {
    for (const att of pdfCands) {
      if (classifyAttachmentRole(att) === "coa") continue; // COAs carry no transport
      const parsed = await parsePdfManifestFromBase64(att.base64 as string);
      if (parsed.text) {
        minerSources.push({
          kind: classifyMinerKind(classifyAttachmentRole(att), parsed.text),
          text: parsed.text,
        });
      }
      if (parsed.ok) {
        // SLICE 69: a layout parser can read the LINES perfectly yet miss
        // transport fields its layout doesn't print where expected (the
        // owner's real failure: driver/vehicle sit in the document but never
        // reached the form). Run the field-LABEL extractor over the SAME text
        // and fill any transport blanks the layout parser left — fill-only-
        // when-empty, arrived_at never doc-sourced, same manifest so no
        // cross-pollination risk.
        let donorTransport = parsed.manifest.transport ?? null;
        const extra = extractGenericPdfTransport(parsed.text);
        if (extra) {
          donorTransport = mergeTransportFillEmpty(donorTransport, extra.transport).transport;
        }
        pdfDonors.push({
          manifest_number: parsed.manifest.manifest_number,
          transport: donorTransport,
        });
      } else if (parsed.text) {
        // H18: a PDF that is NOT a manifest can still carry transport. The
        // real Cultivera invoice (SPR ORD-24706, owner-verified) prints
        // Driver / Plate / vehicle / Arrival date even though the manifest
        // PDF is the primary source. The extractor is layout-gated and
        // returns null unless the text really is this invoice AND at least
        // one transport fact was found — never a donor full of nulls.
        const inv = extractCultiveraInvoiceTransport(parsed.text);
        if (inv) {
          invoiceDonors.push(inv);
        } else {
          // SLICE 41 — provider-agnostic fallback. A NEW provider's PDFs
          // (the real Bamboo "Washington Marijuana Transportation Manifest")
          // match no layout-specific parser, so their transport never
          // reached the form. Field-LABEL extraction reads driver / vehicle
          // / plate / VIN / carrier / times from ANY transport-ish PDF;
          // arrival feeds eta_date only, arrived_at never doc-sourced, and
          // null unless real facts were found (never a donor of nulls).
          const gen = extractGenericPdfTransport(parsed.text);
          if (gen) invoiceDonors.push(gen);
        }
      }
    }
    // Invoice donors go LAST so an exact manifest-number tie prefers the
    // richer shipping document (VIN + transporter live only on the manifest
    // PDF; chooseTransportDonor returns the FIRST exact match).
    pdfDonors.push(...invoiceDonors);
  }

  // SLICE 69: the EMAIL BODY itself can print the transport details (some
  // vendors write driver/vehicle/ETA straight into the message). Run the same
  // field-label extractor over the body text as a LAST-RESORT donor — it goes
  // after every PDF donor so a real shipping document always outranks it, and
  // chooseTransportDonor's manifest-number matching still gates it.
  const bodyDonor =
    typeof email.bodyText === "string" && email.bodyText.trim().length > 0
      ? extractGenericPdfTransport(email.bodyText)
      : null;
  if (bodyDonor) {
    pdfDonors.push({
      manifest_number: bodyDonor.manifest_number,
      transport: bodyDonor.transport,
    });
  }

  // SLICE 102: the body text is also a (last-resort) gold-miner source.
  if (typeof email.bodyText === "string" && email.bodyText.trim().length > 0) {
    minerSources.push({ kind: "email-body", text: email.bodyText });
  }

  // 1) Textual attachments (JSON / CCRS CSV). H15b strict gate: only
  //    verifiable manifests stage; junk (tracking exports, receipts, random
  //    JSON) is skipped WITHOUT counting as a failure — it's logged on the
  //    email row and never creates a manifest, so there's nothing to delete.
  for (const att of textCandidates) {
    const outcome = parseAttachmentStrict(att);
    if (outcome.kind === "junk") continue;
    if (outcome.kind === "unparseable") {
      result.parseFailures += 1;
      continue;
    }
    let manifest = outcome.manifest;
    // H17: enrich with the bundled shipping PDF's transport (fill-only-empty).
    const donor = chooseTransportDonor(manifest.manifest_number, pdfDonors);
    if (donor) manifest = foldTransport(manifest, donor);
    // Keep the original text as raw payload for provenance in the KB snapshot.
    const rawPayload =
      att.text && att.contentType && att.contentType.toLowerCase().includes("json")
        ? safeJson(att.text)
        : att.text;
    const staged = await stageManifest(manifest, rawPayload, actorId, { sourceUrl: null });
    if (staged.ok) {
      result.staged += 1;
      result.manifestIds.push(staged.manifestId);
      // SLICE 69: archive EVERY document the email carried (manifest PDF,
      // invoice PDF, COA, transfer JSON, extras) into private storage linked
      // to this manifest — permanent download buttons for every row.
      // Best-effort; an archive hiccup never fails staging.
      try {
        await archiveManifestDocuments(staged.manifestId, email.attachments, "email");
      } catch (err) {
        console.warn("[inbound-email] document archive skipped:", err);
      }
      // SLICE 102: gap-fill the vendor profile from the email's own documents
      // (fill-only-empty; audited on the manifest timeline; never throws).
      await enrichVendorFromIntakeDocs(staged.manifestId, minerSources, email.from, actorId);
      await autoAdvanceInTransit(staged.manifestId, actorId);
    } else if (staged.duplicate) {
      // Re-sent / duplicate manifest already live in intake: don't re-stage,
      // but DO let the re-send REPAIR empty transport fields on the existing
      // row (H18). This is how a manifest that originally seeded without the
      // PDF's driver/vehicle/plate gets healed by forwarding the email again.
      result.duplicates += 1;
      if (staged.existingManifestId) {
        result.transportBackfills += await backfillManifestTransport(
          staged.existingManifestId,
          manifest.transport,
          actorId,
          "re-sent vendor email",
        );
      }
      console.warn("[inbound-email] duplicate manifest skipped:", staged.error);
    } else {
      result.parseFailures += 1;
      console.error("[inbound-email] stageManifest failed:", staged.error);
    }
  }

  // 2) PDF attachments. Classify each PDF's role (H15-PRE-b) so we only try the
  //    ones that can be a manifest — a vendor email carries several PDFs and only
  //    one is the shipping document:
  //      - manifest role (GrowFlow "TransferLog_*", LCB "Manifest*")  -> try first
  //      - invoice role (OpenTHC invoice IS the manifest)             -> try as fallback
  //      - coa role     (QA / Lab Results / COA Summary)              -> SKIP (never a manifest)
  //    Skipping COAs means they are NOT counted as parse failures (they're not
  //    supposed to be manifests). And if a manifest already staged from the JSON
  //    transfer link or another PDF, we DON'T stage a duplicate from a second PDF.
  //    H16b-5 (owner-confirmed merge strategy): a vendor email is a BUNDLE — a
  //    shipping document (LCB / GrowFlow / old-method Transfer Log) that is the
  //    legal chain-of-custody, sometimes an OpenTHC invoice carrying the PRICES,
  //    and a COA Summary PDF carrying potency/PASS/expiry. We no longer stage
  //    the first PDF and drop the rest. Instead:
  //      (a) parse the highest-ranked manifest-capable PDF as the PRIMARY;
  //      (b) if another PDF parsed as an OpenTHC invoice, merge its PRICES onto
  //          the primary's lines by Lot ID (fill-only-when-empty);
  //      (c) read the COA PDF (no longer skipped) and merge potency/PASS/expiry
  //          onto lines by EXACT Lot ID;
  //    then stage exactly ONE manifest per email (Q4).
  const stagedFromJson = result.staged > 0;
  if (!stagedFromJson) {
    const rankedPdfs = [...pdfCands].sort(
      (a, b) => pdfRoleRank(classifyAttachmentRole(a)) - pdfRoleRank(classifyAttachmentRole(b)),
    );

    // (a) find the PRIMARY manifest: try each non-COA PDF in rank order until one
    //     parses as a manifest. Keep the OTHER manifest-parses around so an
    //     invoice can donate prices even if a richer doc won the primary slot.
    let primary: { manifest: ParsedManifest; text: string } | null = null;
    const invoiceParses: ParsedManifest[] = [];
    let sawManifestRolePdf = false;
    let manifestRoleParseFailed = false;

    for (const att of rankedPdfs) {
      const role = classifyAttachmentRole(att);
      if (role === "coa") continue; // handled separately below
      if (role === "manifest") sawManifestRolePdf = true;
      const parsed = await parsePdfManifestFromBase64(att.base64 as string);
      if (!parsed.ok) {
        if (role === "manifest") {
          manifestRoleParseFailed = true;
          console.warn("[inbound-email] PDF manifest parse failed:", parsed.error);
        }
        continue;
      }
      if (!primary) {
        primary = { manifest: parsed.manifest, text: parsed.text };
      } else {
        // A second manifest-capable PDF: keep OpenTHC invoices as price donors.
        invoiceParses.push(parsed.manifest);
      }
    }

    if (primary) {
      let merged: ParsedManifest = primary.manifest;

      // (b) merge invoice prices (and descriptive blanks) by Lot ID.
      for (const inv of invoiceParses) {
        const priceRes = mergeInvoicePricesByLot(merged, inv);
        merged = priceRes.manifest;
      }

      // (c) read + merge the COA PDF (no longer skipped). Keep the raw bytes so
      //     we can ARCHIVE the certificate itself after staging (H16b-2) — a
      //     bundled COA has no coa_url, so archiveCoasForManifest can't fetch it.
      const coaAtt = rankedPdfs.find((a) => classifyAttachmentRole(a) === "coa");
      let coaArchiveBase64: string | null = null;
      if (coaAtt) {
        const coaRes = await parseCoaFromBase64(coaAtt.base64 as string);
        if (coaRes.ok) {
          const cm = mergeCoaByLot(merged, coaRes.coa.byLot, coaRes.coa.expiresByLot);
          merged = cm.manifest;
          coaArchiveBase64 = coaAtt.base64 as string;
        } else {
          console.warn("[inbound-email] COA parse (for merge) skipped:", coaRes.error);
        }
      }

      // H18: fold any sibling document's transport (e.g. the Cultivera
      // invoice's driver / plate / vehicle) onto the primary manifest too —
      // fill-only-when-empty, arrived_at never doc-sourced, manifest-number
      // matched (same conservative rules as the JSON path above).
      const pdfDonor = chooseTransportDonor(merged.manifest_number, pdfDonors);
      if (pdfDonor) merged = foldTransport(merged, pdfDonor);

      const staged = await stageManifest(merged, primary.text, actorId, { sourceUrl: null });
      if (staged.ok) {
        result.staged += 1;
        result.manifestIds.push(staged.manifestId);
        // SLICE 69: archive EVERY document the email carried (see JSON path).
        try {
          await archiveManifestDocuments(staged.manifestId, email.attachments, "email");
        } catch (err) {
          console.warn("[inbound-email] document archive skipped:", err);
        }
        // H16b-2: retain the emailed COA PDF (bytes → private `coa` bucket)
        // linked to the manifest's lab rows. Best-effort — never fail staging.
        if (coaArchiveBase64) {
          try {
            await archiveEmailedCoaForManifest(staged.manifestId, coaArchiveBase64);
          } catch (err) {
            console.warn("[inbound-email] emailed COA archive skipped:", err);
          }
        }
        // SLICE 102: gap-fill the vendor profile from the email's documents
        // (fill-only-empty; audited on the manifest timeline; never throws).
        await enrichVendorFromIntakeDocs(staged.manifestId, minerSources, email.from, actorId);
        await autoAdvanceInTransit(staged.manifestId, actorId);
      } else if (staged.duplicate) {
        // Re-sent / duplicate manifest already live in intake: don't re-stage,
        // but repair empty transport fields on the existing row (H18).
        result.duplicates += 1;
        if (staged.existingManifestId) {
          result.transportBackfills += await backfillManifestTransport(
            staged.existingManifestId,
            merged.transport,
            actorId,
            "re-sent vendor email (PDF)",
          );
        }
        console.warn("[inbound-email] duplicate manifest (pdf) skipped:", staged.error);
      } else {
        result.parseFailures += 1;
        console.error("[inbound-email] stageManifest (pdf) failed:", staged.error);
      }
    } else if (sawManifestRolePdf && manifestRoleParseFailed) {
      // Only a manifest-ROLE PDF that failed to parse is a genuine failure worth
      // flagging. An invoice/unknown/COA-only email is expected noise.
      result.parseFailures += 1;
    }
  }
  return result;
}

/**
 * H15c (owner-approved): a manifest that arrives BY EMAIL is, by definition, a
 * transfer the vendor has dispatched — the document says it's an in-flight
 * delivery with an ETA. Auto-advance it from "pending" to "in_transit" so the
 * hero table reflects reality without a click. Manual imports keep starting at
 * "pending" (a human typed those in and decides). Best-effort — a lifecycle
 * hiccup never fails the staging. Still drafts-only: in_transit is an interim
 * state; nothing activates until a human accepts.
 */
async function autoAdvanceInTransit(manifestId: string, actorId: string | null): Promise<void> {
  try {
    await setManifestLifecycle(
      manifestId,
      "in_transit",
      actorId,
      "Auto-advanced to In transit (arrived via vendor email — delivery already dispatched).",
    );
  } catch (err) {
    console.error("[inbound-email] auto-advance in_transit failed:", err);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Slice 104: review-queue surfacing ───────────────────────────────────────

export type InboundEmailLogRow = {
  id: string;
  provider: "resend" | "sendgrid";
  from_address: string | null;
  to_addresses: string[];
  subject: string | null;
  received_at: string;
  signature_ok: boolean | null;
  to_intake: boolean;
  attachment_count: number;
  disposition: InboundDisposition;
  manifest_id: string | null;
  note: string | null;
};

/**
 * H14-attachments-fetch: pull the invoice/manifest/transfer links out of the
 * log `note`. The webhook records a fetch trail like
 *   "... — fetched WCIA Transfer Data Link JSON; invoice link: https://...;
 *    manifest link: https://..."
 * so a human reviewing the inbound panel can open the invoice/manifest PDFs even
 * when Gmail forwarding stripped the file attachments. PURE string parsing.
 */
export function extractLinksFromNote(note: string | null): {
  invoiceUrl: string | null;
  manifestUrl: string | null;
} {
  const s = note ?? "";
  const grab = (label: string): string | null => {
    const re = new RegExp(`${label} link:\\s*(https?://[^\\s;]+)`, "i");
    const m = s.match(re);
    return m ? m[1] : null;
  };
  return { invoiceUrl: grab("invoice"), manifestUrl: grab("manifest") };
}

/**
 * Recent inbound vendor_intake@ emails for the intake review queue. Read-only.
 * Surfaces provenance ("this draft arrived by email") and, crucially, the
 * `parse_failed` / `no_manifest` rows a human should chase down. Never throws.
 */
export async function listInboundEmails(limit = 25): Promise<InboundEmailLogRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inbound_email_log")
      .select(
        "id, provider, from_address, to_addresses, subject, received_at, signature_ok, to_intake, attachment_count, disposition, manifest_id, note",
      ) // note carries the fetch trail incl. invoice/manifest links (H14)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as InboundEmailLogRow[];
  } catch (err) {
    console.error("[inbound-email] listInboundEmails failed:", err);
    return [];
  }
}
