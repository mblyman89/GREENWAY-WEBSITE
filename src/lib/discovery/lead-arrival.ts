/**
 * src/lib/discovery/lead-arrival.ts
 *
 * W14 — server-side half of lead loop-closure (audit G10): fetch the PO facts
 * that lead-arrival-core derives "arrived" from.
 *
 * READ-ONLY and best-effort: any failure returns an empty map, which the pure
 * core treats as "nothing arrived" — the Discovery page never breaks because
 * of this bookkeeping. No migration needed: purchase_orders.status and
 * received_at have existed since the purchasing migration.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import {
  arrivalPoIds,
  type LeadArrivalLeadFacts,
  type LeadArrivalPoFact,
} from "@/lib/discovery/lead-arrival-core";

/**
 * Fetch status/received_at for exactly the POs that could close a lead's loop
 * (ordered leads with a promoted PO). Chunked so a long lead list can never
 * build an over-long `.in()` URL.
 */
export async function getLeadArrivalPoFacts(
  leads: readonly LeadArrivalLeadFacts[],
): Promise<Map<string, LeadArrivalPoFact>> {
  const out = new Map<string, LeadArrivalPoFact>();
  if (!isSupabaseServiceConfigured) return out;
  const ids = arrivalPoIds(leads);
  if (ids.length === 0) return out;

  try {
    const admin = createSupabaseAdminClient();
    const rows = await chunkedIn<string, LeadArrivalPoFact>(ids, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("purchase_orders")
        .select("id, status, received_at")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as LeadArrivalPoFact[];
    });
    for (const row of rows) out.set(row.id, row);
  } catch {
    // Best-effort: an empty map simply means no arrival badges this render.
    return new Map();
  }
  return out;
}
