"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createCustomer, getCustomerById, updateCustomer } from "@/lib/customers/store";
import { linkMatchedOrders } from "@/lib/customers/customer-insights-server";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import type { CustomerInput } from "@/lib/customers/types";

function parseForm(formData: FormData): CustomerInput {
  const str = (k: string) => {
    const v = formData.get(k);
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };
  return {
    first_name: (str("first_name") ?? "").trim(),
    last_name: str("last_name"),
    email: str("email"),
    phone: str("phone"),
    birthdate: str("birthdate"),
    marketing_consent: formData.get("marketing_consent") === "on",
    do_not_contact: formData.get("do_not_contact") === "on",
    staff_note: str("staff_note"),
  };
}

export async function createCustomerAction(formData: FormData) {
  const session = await requirePermission("customers.manage");
  const input = parseForm(formData);
  if (!input.first_name) {
    redirect("/admin/customers/new?error=name");
  }
  const created = await createCustomer(input, session.userId);
  revalidatePath("/admin/customers");
  if (created) redirect(`/admin/customers/${created.id}?created=1`);
  redirect("/admin/customers");
}

export async function updateCustomerAction(id: string, formData: FormData) {
  const session = await requirePermission("customers.manage");
  const input = parseForm(formData);
  if (!input.first_name) {
    redirect(`/admin/customers/${id}?error=name`);
  }
  await updateCustomer(id, input, session.userId);
  revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${id}?saved=1`);
}

/**
 * SLICE 3 — connect a customer's unlinked online orders from their profile.
 * Staff-confirmed (each order is ticked by hand). The server re-derives the
 * match list and links ONLY ids that are still unlinked AND still match this
 * customer's phone / email; a form cannot link anything else. Needs
 * customers.manage (this page) AND orders.manage (the same permission the
 * order page's link button requires).
 */
export async function linkCustomerOrdersAction(customerId: string, formData: FormData): Promise<void> {
  const session = await requirePermission("customers.manage");
  if (!can(session.profile.role, "orders.manage")) {
    redirect(`/admin/customers/${customerId}?linkError=${encodeURIComponent("Linking orders needs the orders permission.")}`);
  }
  const ids = formData
    .getAll("orderId")
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  if (ids.length === 0) {
    redirect(`/admin/customers/${customerId}?linkError=${encodeURIComponent("Tick at least one order to link.")}`);
  }
  const customer = await getCustomerById(customerId);
  if (!customer) redirect("/admin/customers");
  const label = session.profile.full_name?.trim() ? `${session.profile.full_name.trim()} (${session.email})` : session.email;
  const res = await linkMatchedOrders(customer, ids, { actorId: session.profile.id, actorLabel: label });
  if (!res.ok) {
    redirect(`/admin/customers/${customerId}?linkError=${encodeURIComponent(res.error.slice(0, 300))}`);
  }
  for (const orderId of res.linked) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.customer_linked",
      entityType: "order",
      entityId: orderId,
      after: { customer_id: customerId, via: "customer_profile_match" },
    });
  }
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${customerId}?linked=${res.linked.length}`);
}
