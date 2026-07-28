/**
 * src/lib/purchasing/emailed-menu-store.ts
 *
 * SLICE 83 — server-side store + parse orchestration for EMAILED vendor menus
 * (the vendor_menu@ mailbox). Persists to the two tables added in migration
 * 0144 (emailed_menu_snapshots / emailed_menu_items), mirroring the Cultivera
 * store's shapes so the PO builder hand-off reuses buildMenuPrefills as-is.
 *
 * The webhook route calls processMenuEmail(email) which does the owner's
 * "absolute best" pass over EVERYTHING the email carried:
 *
 *   1. CLASSIFY (pure): junk/spam never creates a snapshot — only a log line.
 *   2. PARSE deterministically, source by source:
 *        - plain-text body (line parser with section context)
 *        - HTML body (tables → tab-delimited lines → same parsers)
 *        - textual attachments: CSV/TSV/TXT (header-mapped table parser)
 *        - PDF attachments: text extracted server-side (extractPdfText), then
 *          the same table/line parsers
 *   3. AI FALLBACK (budget-guarded, drafts-only): when the deterministic pass
 *      finds little from a menu-looking email, generateStructured transcribes
 *      rows as TSV which the SAME deterministic parser re-validates — the
 *      model never gets to invent a price.
 *   4. ASSETS: image attachments are saved to the media library and linked to
 *      the item whose name matches the filename (token overlap) — the same
 *      badge-friendly media_asset_id link the Cultivera items use.
 *   5. VENDOR GUESS: the sender's address is matched against vendors.email so
 *      the PO hand-off can pre-select the vendor (verified again in the
 *      builder against the real vendors list — W11).
 *
 * Money is INTEGER MINOR UNITS (cents) end-to-end. Best-effort: returns
 * null/[] when the Supabase service role isn't configured (pre-0144 safe: a
 * missing table just logs and reports an error status, never throws).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { uploadMedia } from "@/lib/media/store";
import { extractPdfText } from "@/lib/inventory/pdf-extract";
import {
  isPdfAttachment,
  type NormalizedInboundEmail,
  type NormalizedAttachment,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  classifyMenuEmail,
  emailHtmlToLines,
  parseMenuText,
  parseMenuLines,
  mergeParsedItems,
  matchImagesToItems,
  splitFromHeader,
  type EmailMenuItem,
} from "./email-menu-core";
import { extractMenuItemsWithAi } from "./email-menu-ai";

export * from "./email-menu-core";

/* ------------------------------------------------------------------
 * Row shapes (mirror migration 0144)
 * ------------------------------------------------------------------ */

export type EmailedMenuSnapshotRow = {
  id: string;
  vendor_id: string | null;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  status: string;
  error_message: string | null;
  item_count: number;
  source: string | null;
  parse_method: string | null;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type EmailedMenuItemRow = {
  id: string;
  snapshot_id: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  strain_type: string | null;
  size_label: string | null;
  unit_count: number | null;
  wholesale_price_minor: number | null;
  available_qty: number | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  potency_raw: Record<string, unknown>;
  description: string | null;
  image_url: string | null;
  media_asset_id: string | null;
  raw: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
};

export type ProcessMenuEmailResult = {
  /** "saved" | "junk" | "no_items" | "error" — what the webhook logs. */
  outcome: "saved" | "junk" | "no_items" | "error";
  snapshotId: string | null;
  itemCount: number;
  /** Human parse trail for the inbound_email_log note. */
  note: string;
};

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

function isImageAttachment(a: NormalizedAttachment): boolean {
  const ct = (a.contentType ?? "").toLowerCase();
  const fn = (a.filename ?? "").toLowerCase();
  return ct.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(fn);
}

function isTextualDoc(a: NormalizedAttachment): boolean {
  if (!a.text || !a.text.trim()) return false;
  const fn = (a.filename ?? "").toLowerCase();
  const ct = (a.contentType ?? "").toLowerCase();
  // JSON manifests belong to vendor_intake; here we want tabular/plain docs.
  return (
    ct.includes("csv") ||
    ct.includes("text") ||
    /\.(csv|txt|tsv)$/.test(fn)
  );
}

/** Guess our local vendor by the sender's email address (exact, lowercased). */
async function guessVendorByEmail(address: string | null): Promise<{ id: string; name: string } | null> {
  if (!address || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("vendors")
      .select("id, display_name, email")
      .ilike("email", address)
      .limit(1);
    const row = data?.[0];
    if (!row) return null;
    return { id: row.id as string, name: (row.display_name as string) ?? "" };
  } catch {
    return null;
  }
}

function itemToRow(snapshotId: string, item: EmailMenuItem): Record<string, unknown> {
  return {
    snapshot_id: snapshotId,
    name: item.name,
    brand: item.brand,
    category: item.category,
    strain_type: item.strainType,
    size_label: item.sizeLabel,
    unit_count: item.unitCount,
    wholesale_price_minor: item.wholesalePriceMinor,
    available_qty: item.availableQty,
    thc_pct: item.thcPct,
    cbd_pct: item.cbdPct,
    potency_raw: item.potencyRaw ?? {},
    description: item.description,
    raw: item.raw ?? {},
    position: item.position,
  };
}

/* ------------------------------------------------------------------
 * The "absolute best" parse pass
 * ------------------------------------------------------------------ */

/**
 * Parse every source the email carried into ONE deterministic item list plus
 * the source/method provenance strings stored on the snapshot. Exposed for
 * the webhook path via processMenuEmail; kept separate for testability.
 */
async function parseAllSources(email: NormalizedInboundEmail): Promise<{
  items: EmailMenuItem[];
  sources: string[];
  methods: string[];
  notes: string[];
  bestUnparsedText: string;
}> {
  const notes: string[] = [];
  const sources: string[] = [];
  let items: EmailMenuItem[] = [];
  // The longest menu-looking text that yielded nothing — the AI fallback input.
  let bestUnparsedText = "";
  const consider = (text: string) => {
    if (text.trim().length > bestUnparsedText.trim().length) bestUnparsedText = text;
  };

  // 1) Plain-text body.
  const bodyText = (email.bodyText ?? "").trim();
  if (bodyText) {
    const parsed = parseMenuText(bodyText);
    if (parsed.length > 0) {
      items = mergeParsedItems(items, parsed);
      sources.push("body");
      notes.push(`body text: ${parsed.length} item(s)`);
    } else {
      consider(bodyText);
    }
  }

  // 2) HTML body (menu emails are often HTML tables).
  const bodyHtml = (email.bodyHtml ?? "").trim();
  if (bodyHtml) {
    const lines = emailHtmlToLines(bodyHtml);
    if (lines.length > 0) {
      const parsed = parseMenuLines(lines);
      if (parsed.length > 0) {
        items = mergeParsedItems(items, parsed);
        if (!sources.includes("body")) sources.push("body");
        notes.push(`html body: ${parsed.length} item(s)`);
      } else {
        consider(lines.join("\n"));
      }
    }
  }

  // 3) Textual attachments (CSV/TSV/TXT price sheets).
  for (const att of email.attachments.filter(isTextualDoc)) {
    const parsed = parseMenuText(att.text ?? "");
    if (parsed.length > 0) {
      items = mergeParsedItems(items, parsed);
      if (!sources.includes("attachment")) sources.push("attachment");
      notes.push(`${att.filename ?? "attachment"}: ${parsed.length} item(s)`);
    } else if (att.text) {
      consider(att.text);
    }
  }

  // 4) PDF attachments — extract text server-side, then the same parsers.
  for (const att of email.attachments.filter((a) => isPdfAttachment(a) && !!a.base64)) {
    try {
      const bytes = Uint8Array.from(Buffer.from(att.base64 as string, "base64"));
      const text = await extractPdfText(bytes);
      if (!text.trim()) {
        notes.push(`${att.filename ?? "pdf"}: no extractable text`);
        continue;
      }
      const parsed = parseMenuText(text);
      if (parsed.length > 0) {
        items = mergeParsedItems(items, parsed);
        if (!sources.includes("pdf")) sources.push("pdf");
        notes.push(`${att.filename ?? "pdf"}: ${parsed.length} item(s)`);
      } else {
        consider(text);
      }
    } catch (err) {
      notes.push(`${att.filename ?? "pdf"}: extraction failed (${err instanceof Error ? err.message : "error"})`);
    }
  }

  const methods = items.length > 0 ? ["deterministic"] : [];
  return { items, sources, methods, notes, bestUnparsedText };
}

/* ------------------------------------------------------------------
 * processMenuEmail — the webhook entry point
 * ------------------------------------------------------------------ */

/** How few deterministic items triggers the AI fallback on menu-looking text. */
const AI_FALLBACK_THRESHOLD = 3;

export async function processMenuEmail(email: NormalizedInboundEmail): Promise<ProcessMenuEmailResult> {
  const sender = splitFromHeader(email.from);

  // 1) Junk gate — spam never creates a snapshot.
  const verdictInput = {
    subject: email.subject ?? "",
    bodyText: [email.bodyText ?? "", emailHtmlToLines(email.bodyHtml ?? "").join("\n")]
      .filter(Boolean)
      .join("\n"),
    attachmentNames: email.attachments.map((a) => a.filename ?? "").filter(Boolean),
  };
  const verdict = classifyMenuEmail(verdictInput);
  if (verdict.verdict === "junk") {
    return {
      outcome: "junk",
      snapshotId: null,
      itemCount: 0,
      note: `classified as junk (score ${verdict.score}): ${verdict.reasons.join("; ")}`,
    };
  }

  // 2) Deterministic pass over every source.
  const parsed = await parseAllSources(email);
  let items = parsed.items;
  const methods = [...parsed.methods];
  const notes = [...parsed.notes];

  // 3) AI fallback — only when the deterministic pass found little AND there
  //    is unparsed menu-looking text. Budget-guarded, gracefully skipped.
  if (items.length < AI_FALLBACK_THRESHOLD && parsed.bestUnparsedText.trim().length > 40) {
    const ai = await extractMenuItemsWithAi(parsed.bestUnparsedText);
    notes.push(ai.note);
    if (ai.used && ai.items.length > 0) {
      items = mergeParsedItems(items, ai.items);
      methods.push("ai");
    }
  }

  if (items.length === 0) {
    return {
      outcome: "no_items",
      snapshotId: null,
      itemCount: 0,
      note: `menu-like email but no items parsed — ${notes.join("; ") || "no parseable sources"}`,
    };
  }

  if (!isSupabaseServiceConfigured) {
    return {
      outcome: "error",
      snapshotId: null,
      itemCount: items.length,
      note: "supabase not configured — parsed but not saved",
    };
  }

  // 4) Vendor guess by sender address (verified again in the builder — W11).
  const vendor = await guessVendorByEmail(sender.address);

  // 5) Persist snapshot header + items.
  try {
    const admin = createSupabaseAdminClient();
    const { data: header, error: headerErr } = await admin
      .from("emailed_menu_snapshots")
      .insert({
        vendor_id: vendor?.id ?? null,
        from_address: sender.address,
        from_name: sender.name,
        subject: email.subject || null,
        received_at: email.receivedAt,
        status: "parsed",
        item_count: items.length,
        source: parsed.sources.join("+") || null,
        parse_method: methods.join("+") || null,
        raw: {
          classification: verdict,
          parse_notes: notes,
          attachment_names: email.attachments.map((a) => a.filename).filter(Boolean),
          body_excerpt: (email.bodyText ?? "").slice(0, 2000) || null,
        },
      })
      .select("id")
      .single();
    if (headerErr || !header) {
      return {
        outcome: "error",
        snapshotId: null,
        itemCount: items.length,
        note: `snapshot insert failed: ${headerErr?.message ?? "unknown"} (is migration 0144 applied?)`,
      };
    }
    const snapshotId = header.id as string;

    const { data: inserted, error: itemsErr } = await admin
      .from("emailed_menu_items")
      .insert(items.map((it) => itemToRow(snapshotId, it)))
      .select("id, position");
    if (itemsErr) {
      await admin
        .from("emailed_menu_snapshots")
        .update({ status: "error", error_message: itemsErr.message })
        .eq("id", snapshotId);
      return {
        outcome: "error",
        snapshotId,
        itemCount: 0,
        note: `items insert failed: ${itemsErr.message}`,
      };
    }

    // 6) Assets "if any": save emailed images to the media library and link
    //    each to the item whose name overlaps the filename. Best-effort.
    const images = email.attachments.filter((a) => isImageAttachment(a) && !!a.base64);
    if (images.length > 0 && inserted && inserted.length > 0) {
      const byPosition = new Map<number, string>();
      for (const row of inserted) byPosition.set(row.position as number, row.id as string);
      const matches = matchImagesToItems(
        images.map((a) => a.filename ?? ""),
        items.map((it) => it.name ?? ""),
      );
      let linked = 0;
      for (const [imgIdx, itemIdx] of matches) {
        const att = images[imgIdx];
        const rowId = byPosition.get(items[itemIdx].position);
        if (!att?.base64 || !rowId) continue;
        try {
          const asset = await uploadMedia({
            buffer: Buffer.from(att.base64, "base64"),
            filename: att.filename ?? `emailed-menu-${snapshotId}-${imgIdx}.jpg`,
            mimeType: att.contentType ?? "image/jpeg",
            title: items[itemIdx].name ?? att.filename ?? "Emailed menu image",
            usageType: "vendor-menu",
            uploadedBy: null,
            source: `email:${sender.address ?? "unknown"}`,
            licenseStatus: "pending-review",
          });
          await admin
            .from("emailed_menu_items")
            .update({ media_asset_id: asset.id, image_url: asset.public_url ?? null })
            .eq("id", rowId);
          linked += 1;
        } catch {
          // best-effort — a failed image never blocks the menu itself
        }
      }
      if (linked > 0) notes.push(`saved + linked ${linked} emailed image(s) to the media library`);
    }

    return {
      outcome: "saved",
      snapshotId,
      itemCount: items.length,
      note: `saved ${items.length} item(s) [${parsed.sources.join("+") || "?"} / ${methods.join("+")}]${vendor ? ` — vendor matched: ${vendor.name}` : ""} — ${notes.join("; ")}`,
    };
  } catch (err) {
    return {
      outcome: "error",
      snapshotId: null,
      itemCount: items.length,
      note: `unexpected save failure: ${err instanceof Error ? err.message : "error"}`,
    };
  }
}

/* ------------------------------------------------------------------
 * Reads (menus page + detail page + PO builder hand-off)
 * ------------------------------------------------------------------ */

/** List recent emailed-menu snapshots (newest first). */
export async function listEmailedMenus(opts?: { limit?: number }): Promise<EmailedMenuSnapshotRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("emailed_menu_snapshots")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(opts?.limit ?? 50);
    if (error || !data) return [];
    return data as EmailedMenuSnapshotRow[];
  } catch {
    return [];
  }
}

/** One snapshot header by id. */
export async function getEmailedMenu(snapshotId: string): Promise<EmailedMenuSnapshotRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("emailed_menu_snapshots")
      .select("*")
      .eq("id", snapshotId)
      .maybeSingle();
    if (error || !data) return null;
    return data as EmailedMenuSnapshotRow;
  } catch {
    return null;
  }
}

/** All items of one snapshot, in menu order. */
export async function getEmailedMenuItems(snapshotId: string): Promise<EmailedMenuItemRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("emailed_menu_items")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("position", { ascending: true });
    if (error || !data) return [];
    return data as EmailedMenuItemRow[];
  } catch {
    return [];
  }
}
