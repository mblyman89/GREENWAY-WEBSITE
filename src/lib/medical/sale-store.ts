/**
 * src/lib/medical/sale-store.ts
 *
 * Server-side data access for the medical SELLING pipeline (Task O):
 *   - medical_product_registry — the durable DOH 246-70 category per product,
 *     keyed by the STABLE POS product key (order_lines.product_id =
 *     menu_items.source_item_id), survives menu re-imports (migration 0113).
 *   - orders.medical_authorization_id — which recognition card an order is
 *     being sold under (attached by staff pre-completion; re-validated at the
 *     completion gate).
 *   - recordExemptSalesForOrder — the idempotent WAC 314-55-090(2) ledger
 *     writer the completion gate calls (failure BLOCKS completion).
 *
 * Everything degrades gracefully before migration 0113 is applied: reads
 * return empty/null and attach/record functions return a clear error instead
 * of throwing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { isDohCategory, type DohCategory } from "@/lib/medical/medical-sale-core";
import { recordExemptSale, type AuthorizationRow } from "@/lib/medical/store";
import type { ExemptSaleDraft } from "@/lib/medical/medical-sale-core";

/** PostgREST "relation/column does not exist" — migration 0113 not applied yet. */
function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    /column .* does not exist|could not find .* column|relation .* does not exist|Could not find the table/i.test(
      error.message ?? "",
    )
  );
}

// ---------------------------------------------------------------------------
// DOH product registry
// ---------------------------------------------------------------------------
export type MedicalRegistryRow = {
  id: string;
  pos_product_key: string;
  product_name: string | null;
  doh_category: DohCategory;
  notes: string | null;
  verified_by: string | null;
  verified_at: string;
  created_at: string;
  updated_at: string;
};

export async function listMedicalRegistry(opts?: { q?: string; limit?: number }): Promise<MedicalRegistryRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("medical_product_registry").select("*").order("updated_at", { ascending: false });
  const needle = opts?.q?.trim();
  if (needle) {
    const safe = needle.replace(/[%_,]/g, " ");
    q = q.or(`product_name.ilike.%${safe}%,pos_product_key.ilike.%${safe}%`);
  }
  q = q.limit(opts?.limit ?? 200);
  const { data, error } = await q;
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`listMedicalRegistry: ${error.message}`);
  }
  return (data as MedicalRegistryRow[] | null) ?? [];
}

/** productId → DOH category for a set of order-line product keys (S-7 chunked). */
export async function getMedicalRegistryForKeys(keys: (string | null)[]): Promise<Map<string, DohCategory>> {
  const map = new Map<string, DohCategory>();
  const clean = [...new Set(keys.filter((k): k is string => !!k))];
  if (!isSupabaseServiceConfigured || clean.length === 0) return map;
  const admin = createSupabaseAdminClient();
  try {
    const rows = await chunkedIn<string, { pos_product_key: string; doh_category: string }>(
      clean,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("medical_product_registry")
          .select("pos_product_key, doh_category")
          .in("pos_product_key", chunk as string[])
          .range(from, to);
        if (error) throw error;
        return (data as { pos_product_key: string; doh_category: string }[] | null) ?? [];
      },
    );
    for (const r of rows) {
      if (isDohCategory(r.doh_category)) map.set(r.pos_product_key, r.doh_category);
    }
  } catch (e) {
    if (isMissingSchemaError(e as { code?: string; message?: string })) return map;
    throw e;
  }
  return map;
}

export async function upsertMedicalRegistryEntry(
  input: { posProductKey: string; productName: string | null; dohCategory: DohCategory; notes: string | null },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const key = input.posProductKey.trim();
  if (!key) return { ok: false, error: "Product key is required." };
  if (!isDohCategory(input.dohCategory)) return { ok: false, error: "Invalid DOH category." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("medical_product_registry")
    .upsert(
      {
        pos_product_key: key,
        product_name: input.productName?.trim() || null,
        doh_category: input.dohCategory,
        notes: input.notes?.trim() || null,
        verified_by: actorId,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "pos_product_key" },
    )
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingSchemaError(error)) {
      return { ok: false, error: "Migration 0113 (medical_product_registry) has not been applied yet." };
    }
    return { ok: false, error: error?.message ?? "Could not save the registry entry." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function removeMedicalRegistryEntry(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("medical_product_registry").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * POS B8 — resolve a register-captured UPID to its ACTIVE recognition-card
 * row. The register only carries the card facts the budtender read off the
 * card; the durable authorization row (created at back-office intake, DOH
 * 608-048 checklist enforced) is the source of truth the completion gate
 * re-validates. Newest active row wins (renewals create new rows).
 */
export async function findAuthorizationByUpid(upid: string): Promise<AuthorizationRow | null> {
  const clean = upid.trim();
  if (!isSupabaseServiceConfigured || !clean) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("patient_authorizations")
    .select("*")
    .eq("unique_patient_identifier", clean)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw new Error(`findAuthorizationByUpid: ${error.message}`);
  }
  return (data as AuthorizationRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Order ↔ recognition-card attachment
// ---------------------------------------------------------------------------
export async function attachCardToOrder(
  orderId: string,
  authorization: { id: string; customer_id: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("orders")
    .update({ medical_authorization_id: authorization.id, customer_id: authorization.customer_id })
    .eq("id", orderId);
  if (error) {
    if (isMissingSchemaError(error)) {
      return { ok: false, error: "Migration 0113 (orders.medical_authorization_id) has not been applied yet." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function detachCardFromOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("orders")
    .update({ medical_authorization_id: null, customer_id: null })
    .eq("id", orderId);
  if (error) {
    if (isMissingSchemaError(error)) {
      return { ok: false, error: "Migration 0113 has not been applied yet." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type OrderMedicalContext = {
  authorization: AuthorizationRow;
  customerName: string;
} | null;

/**
 * The recognition card attached to an order (with the patient's name), or
 * null when no card is attached / migration 0113 is not applied.
 */
export async function getOrderMedicalContext(orderId: string): Promise<OrderMedicalContext> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("medical_authorization_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw new Error(`getOrderMedicalContext: ${error.message}`);
  }
  const authId = (order as { medical_authorization_id?: string | null } | null)?.medical_authorization_id ?? null;
  if (!authId) return null;

  const { data: auth } = await admin
    .from("patient_authorizations")
    .select("*")
    .eq("id", authId)
    .maybeSingle();
  if (!auth) return null;
  const row = auth as AuthorizationRow;

  const { data: cust } = await admin
    .from("customers")
    .select("first_name, last_name")
    .eq("id", row.customer_id)
    .maybeSingle();
  const name = cust
    ? `${(cust as { first_name: string }).first_name}${(cust as { last_name: string | null }).last_name ? ` ${(cust as { last_name: string | null }).last_name}` : ""}`
    : "Unknown patient";

  return { authorization: row, customerName: name };
}

// ---------------------------------------------------------------------------
// WAC 314-55-090(2) ledger writer (idempotent per order)
// ---------------------------------------------------------------------------
/**
 * Persist the exempt-sale ledger rows for an order at completion time.
 * IDEMPOTENT: existing rows for the order are replaced (a re-completion after
 * a logged reversal re-derives the ledger from the CURRENT lines — the rows
 * must mirror the sale that actually happened). Each row passes the
 * WAC 314-55-090(2) completeness guardrail inside recordExemptSale; ANY
 * failure reports back so the completion gate can BLOCK the sale.
 */
/**
 * Remove an order's exempt-sale rows after its completion is REVERSED (S-15
 * logged reversal). The ledger must mirror sales that actually stand — a
 * rewound completion is not a sale, and leaving rows behind would overstate
 * the LIQ-1295 Box 2 deduction. Rows are re-derived from the live lines when
 * the order completes again. Returns the number of rows removed.
 */
export async function clearExemptSalesForOrder(orderId: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("medical_exempt_sales")
    .delete()
    .eq("order_id", orderId)
    .select("id");
  if (error) return 0;
  return ((data as { id: string }[] | null) ?? []).length;
}

export async function recordExemptSalesForOrder(
  orderId: string,
  drafts: ExemptSaleDraft[],
  meta: { customerId: string | null; authorizationId: string | null; actorId: string | null },
): Promise<{ ok: true; recorded: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();

  // Replace any rows from a prior completion attempt of this same order.
  const { error: delError } = await admin.from("medical_exempt_sales").delete().eq("order_id", orderId);
  if (delError) return { ok: false, error: `Could not reset the order's exempt-sale rows: ${delError.message}` };

  let recorded = 0;
  for (const d of drafts) {
    const res = await recordExemptSale(
      {
        orderId,
        customerId: meta.customerId,
        authorizationId: meta.authorizationId,
        uniquePatientIdentifier: d.uniquePatientIdentifier,
        cardEffectiveOn: d.cardEffectiveOn,
        cardExpiresOn: d.cardExpiresOn,
        productSku: d.productSku,
        productName: d.productName,
        salesPriceMinor: d.salesPriceMinor,
        salesTaxExempt: d.salesTaxExempt,
        exciseTaxExempt: d.exciseTaxExempt,
        exciseAmountExemptMinor: d.exciseAmountExemptMinor,
      },
      meta.actorId,
    );
    if (!res.ok) {
      return { ok: false, error: `Exempt-sale record for "${d.productName}" failed: ${res.error ?? "unknown error"}` };
    }
    recorded += 1;
  }
  return { ok: true, recorded };
}
