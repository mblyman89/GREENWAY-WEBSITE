"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { mapCustomerCsv, importCustomers } from "@/lib/customers/import";

export async function importCustomersAction(formData: FormData) {
  const session = await requirePermission("customers.manage");
  const csv = (formData.get("csv_text") as string | null)?.trim() ?? "";
  if (!csv) {
    redirect("/admin/customers/import?error=empty");
  }

  const parsed = mapCustomerCsv(csv);
  if (parsed.rows.length === 0) {
    redirect("/admin/customers/import?error=norows");
  }

  const result = await importCustomers(parsed, session.userId);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/customers/import");
  if (!result.ok) {
    redirect("/admin/customers/import?error=save");
  }
  redirect(
    `/admin/customers/import?inserted=${result.inserted}&updated=${result.updated}&skipped=${result.skipped}`,
  );
}
