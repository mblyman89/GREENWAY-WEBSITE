/**
 * src/lib/orders/customer-link-store.ts
 *
 * Server-side data access for STAFF-CONFIRMED customer↔order linking
 * (Task T / PR 4). Column orders.customer_id has existed since migration 0022
 * ("optional link: orders → customer"); until now nothing on the order detail
 * page could set it for a web pickup order, so completed online orders never
 * accrued loyalty points. This store:
 *
 *   - findLinkCandidates(): exact-normalized phone/email candidates for the
 *     staff review list (ranked by customer-link-core; NEVER auto-linked).
 *   - getLinkedCustomer(): the currently linked customer, if any.
 *   - linkCustomerToOrder() / unlinkCustomerFromOrder(): the human decision,
 *     recorded as an order_event so the timeline shows who linked whom.
 *
 * Auth/permission checks live in the admin actions, not here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  normalizeEmail,
  normalizePhoneDigits,
  rankCustomerMatches,
  type RankedMatch,
} from "@/lib/orders/customer-link-core";
import type { OrderRow } from "@/lib/orders/types";

export type LinkedCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loyaltyEnrolled: boolean;
  balancePoints: number;
};

/** The order's currently linked customer (with loyalty snapshot), if any. */
export async function getLinkedCustomer(orderId: string): Promise<LinkedCustomer | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("customer_id")
    .eq("id", orderId)
    .maybeSingle<{ customer_id: string | null }>();
  if (!order?.customer_id) return null;

  const { data: c } = await admin
    .from("customers")
    .select("id, first_name, last_name, email, phone")
    .eq("id", order.customer_id)
    .maybeSingle<{
      id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>();
  if (!c) return null;

  let enrolled = false;
  let balance = 0;
  try {
    const { getAccountByCustomer } = await import("@/lib/loyalty/loyalty-store");
    const account = await getAccountByCustomer(c.id);
    enrolled = !!account && account.is_active;
    balance = account?.balance_points ?? 0;
  } catch {
    /* loyalty tables optional — link display still works */
  }

  return {
    id: c.id,
    name: `${c.first_name}${c.last_name ? ` ${c.last_name}` : ""}`,
    email: c.email,
    phone: c.phone,
    loyaltyEnrolled: enrolled,
    balancePoints: balance,
  };
}

/**
 * Exact-normalized phone/email match candidates for the staff list,
 * best-first. Returns [] when the order carries no usable contact info.
 */
export async function findLinkCandidates(order: OrderRow): Promise<RankedMatch[]> {
  if (!isSupabaseServiceConfigured) return [];
  const phone = normalizePhoneDigits(order.customer_phone);
  const email = normalizeEmail(order.customer_email);
  if (!phone && !email) return [];

  const admin = createSupabaseAdminClient();
  const ors: string[] = [];
  if (phone) ors.push(`phone_normalized.eq.${phone}`);
  if (email) ors.push(`email.ilike.${email}`);
  const { data } = await admin
    .from("customers")
    .select("id, first_name, last_name, email, phone_normalized")
    .or(ors.join(","))
    .limit(10);

  const candidates = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    firstName: String(r.first_name),
    lastName: (r.last_name as string | null) ?? null,
    phoneNormalized: (r.phone_normalized as string | null) ?? null,
    email: (r.email as string | null) ?? null,
  }));

  return rankCustomerMatches(
    { phone: order.customer_phone, email: order.customer_email },
    candidates,
  );
}

type ActorOpts = { actorId?: string | null; actorLabel?: string | null };

/** Staff-confirmed link. Records an order_event for the timeline. */
export async function linkCustomerToOrder(
  orderId: string,
  customerId: string,
  opts: ActorOpts = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, first_name, last_name")
    .eq("id", customerId)
    .maybeSingle<{ id: string; first_name: string; last_name: string | null }>();
  if (!customer) return { ok: false, error: "Customer not found." };

  const { error } = await admin
    .from("orders")
    .update({ customer_id: customerId })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };

  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "customer_linked",
    note: `Linked to customer ${customer.first_name}${customer.last_name ? ` ${customer.last_name}` : ""}`,
    actor_id: opts.actorId ?? null,
    actor_label: opts.actorLabel ?? null,
  });
  return { ok: true };
}

/** Remove the link (e.g. wrong match). Records an order_event. */
export async function unlinkCustomerFromOrder(
  orderId: string,
  opts: ActorOpts = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("orders")
    .update({ customer_id: null })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };

  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "customer_unlinked",
    note: "Customer link removed",
    actor_id: opts.actorId ?? null,
    actor_label: opts.actorLabel ?? null,
  });
  return { ok: true };
}
