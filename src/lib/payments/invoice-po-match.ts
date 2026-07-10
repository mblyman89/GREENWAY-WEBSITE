/**
 * src/lib/payments/invoice-po-match.ts
 *
 * W8 — server side of the invoice ↔ PO cross-check: for a batch of payable
 * manifests, load each one's LINKED purchase order (W5 / migration 0102) and
 * return the pure-core facts AP needs to compare totals.
 *
 * NO-OP-SAFE PRE-MIGRATION: reading a missing purchase_order_id column
 * returns an empty map (house 42703 probe pattern) — AP simply shows no
 * suggestions until 0102 is applied. READ-ONLY: never writes to POs.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { LinkedPoFacts } from "@/lib/payments/invoice-po-match-core";

/** Same missing-column probe as po-link-store (0102 not applied yet). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

/**
 * Map manifestId → linked-PO facts for every manifest in the batch that has a
 * PO link. Manifests without a link are simply absent. Empty map pre-0102 or
 * on any failure (best-effort — AP must render without suggestions).
 */
export async function getLinkedPoFactsForManifests(
  manifestIds: string[],
): Promise<Map<string, LinkedPoFacts>> {
  const out = new Map<string, LinkedPoFacts>();
  if (!isSupabaseServiceConfigured || manifestIds.length === 0) return out;
  const admin = createSupabaseAdminClient();

  const { data: mRows, error: mErr } = await admin
    .from("inbound_manifests")
    .select("id, purchase_order_id")
    .in("id", manifestIds)
    .not("purchase_order_id", "is", null);
  if (mErr) {
    if (!isMissingColumnError(mErr)) {
      console.error("[invoice-po-match] manifest link read failed:", mErr.message);
    }
    return out;
  }
  const links = (mRows as { id: string; purchase_order_id: string }[] | null) ?? [];
  if (links.length === 0) return out;

  const poIds = Array.from(new Set(links.map((l) => l.purchase_order_id)));
  const { data: pos, error: pErr } = await admin
    .from("purchase_orders")
    .select("id, po_number, status, subtotal_minor_units, line_count")
    .in("id", poIds);
  if (pErr) {
    console.error("[invoice-po-match] po read failed:", pErr.message);
    return out;
  }
  const poById = new Map<string, LinkedPoFacts>();
  for (const p of (pos as
    | { id: string; po_number: string | null; status: string; subtotal_minor_units: number | null; line_count: number | null }[]
    | null) ?? []) {
    poById.set(p.id, {
      poNumber: p.po_number,
      status: p.status,
      orderedMinorUnits: Number(p.subtotal_minor_units ?? 0),
      lineCount: Number(p.line_count ?? 0),
    });
  }

  for (const l of links) {
    const facts = poById.get(l.purchase_order_id);
    if (facts) out.set(l.id, facts);
  }
  return out;
}
