"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createCustomer, updateCustomer } from "@/lib/customers/store";
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
