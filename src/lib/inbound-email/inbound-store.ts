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
import { manifestCandidates } from "@/lib/inbound-email/inbound-normalize-core";

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
  const candidates = manifestCandidates(email);
  if (candidates.length === 0) return result;

  for (const att of candidates) {
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
  return result;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
