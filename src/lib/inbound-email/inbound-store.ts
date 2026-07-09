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
import { parseVendorJson, type ParsedManifest } from "@/lib/inventory/intake-parser";
import {
  parseCcrsManifestCsv,
  ccrsToParsedManifest,
} from "@/lib/inventory/ccrs-manifest-csv-core";
import { stageManifest } from "@/lib/inventory/intake-store";
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
      return 3; // coa (skipped anyway)
  }
}
import { parsePdfManifestFromBase64 } from "@/lib/inventory/pdf-extract";

export type InboundDisposition =
  | "received"
  | "ignored"
  | "no_manifest"
  | "staged"
  | "parse_failed";

/**
 * Try to turn one textual attachment into a ParsedManifest. We attempt CCRS CSV
 * when it looks like CSV, otherwise the vendor JSON parser. Returns null if it
 * doesn't parse into at least one line.
 */
export function parseAttachmentToManifest(att: NormalizedAttachment): ParsedManifest | null {
  const text = att.text;
  if (!text || !text.trim()) return null;

  const fn = (att.filename ?? "").toLowerCase();
  const ct = (att.contentType ?? "").toLowerCase();
  const looksCsv = ct.includes("csv") || fn.endsWith(".csv");

  if (looksCsv) {
    const parsed = parseCcrsManifestCsv(text);
    if (parsed.ok) {
      const mapped = ccrsToParsedManifest(parsed);
      if (mapped.lines.length > 0) {
        return {
          manifest_number: mapped.manifest_number,
          vendor_label: mapped.vendor_label,
          vendor_license: mapped.vendor_license,
          transfer_date: mapped.transfer_date,
          source_format: "ccrs-csv",
          lines: mapped.lines,
          warnings: mapped.warnings,
        };
      }
    }
    // fall through: some CSV exports are actually JSON mislabeled — try JSON too
  }

  const json = parseVendorJson(text);
  if (json.ok && json.manifest.lines.length > 0) {
    return json.manifest;
  }
  return null;
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
};

/**
 * Stage every attachment on the email that parses as a manifest. The raw email
 * (subject + from) is kept as the sourceUrl-less rawPayload context via a note.
 */
export async function stageManifestsFromEmail(
  email: NormalizedInboundEmail,
  actorId: string | null,
): Promise<StageFromEmailResult> {
  const result: StageFromEmailResult = { staged: 0, manifestIds: [], parseFailures: 0 };
  const textCandidates = manifestCandidates(email);
  const pdfCands = pdfCandidates(email);
  if (textCandidates.length === 0 && pdfCands.length === 0) return result;

  // 1) Textual attachments (JSON / CCRS CSV).
  for (const att of textCandidates) {
    const manifest = parseAttachmentToManifest(att);
    if (!manifest) {
      result.parseFailures += 1;
      continue;
    }
    // Keep the original text as raw payload for provenance in the KB snapshot.
    const rawPayload =
      att.text && att.contentType && att.contentType.toLowerCase().includes("json")
        ? safeJson(att.text)
        : att.text;
    const staged = await stageManifest(manifest, rawPayload, actorId, { sourceUrl: null });
    if (staged.ok) {
      result.staged += 1;
      result.manifestIds.push(staged.manifestId);
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
  const rankedPdfs = [...pdfCands].sort(
    (a, b) => pdfRoleRank(classifyAttachmentRole(a)) - pdfRoleRank(classifyAttachmentRole(b)),
  );
  const stagedFromJson = result.staged > 0;
  let stagedFromPdf = false;
  for (const att of rankedPdfs) {
    const role = classifyAttachmentRole(att);
    if (role === "coa") continue; // a COA/QA PDF is never a manifest — skip, no failure.
    // Once we have a real manifest (from JSON or an earlier PDF), don't create a
    // duplicate from another PDF in the same email.
    if (stagedFromJson || stagedFromPdf) continue;

    const parsed = await parsePdfManifestFromBase64(att.base64 as string);
    if (!parsed.ok) {
      // Only an unparseable manifest-role PDF is a genuine failure worth flagging.
      // An invoice/unknown PDF that doesn't parse as a manifest is expected noise.
      if (role === "manifest") {
        result.parseFailures += 1;
        console.warn("[inbound-email] PDF manifest parse failed:", parsed.error);
      }
      continue;
    }
    const staged = await stageManifest(parsed.manifest, parsed.text, actorId, { sourceUrl: null });
    if (staged.ok) {
      result.staged += 1;
      result.manifestIds.push(staged.manifestId);
      stagedFromPdf = true;
    } else {
      result.parseFailures += 1;
      console.error("[inbound-email] stageManifest (pdf) failed:", staged.error);
    }
  }
  return result;
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
