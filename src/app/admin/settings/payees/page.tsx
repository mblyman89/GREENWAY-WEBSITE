/**
 * SLICE 94 — /admin/settings/payees moved.
 *
 * The payee banking vault (SLICE 80) now lives on the Banking page — the
 * vault door at /admin/settings/banking (Vendors | Employees | My banking).
 * This stub keeps every old bookmark, help link, and audit-log reference
 * working: it forwards the tab selection and lands on the same content.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PayeesMovedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; msg?: string; error?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams();
  // Legacy tabs map 1:1 (vendors/employees); anything else falls to the default.
  p.set("tab", sp.tab === "employees" ? "employees" : "vendors");
  if (sp.msg) p.set("msg", sp.msg);
  if (sp.error) p.set("error", sp.error);
  if (sp.edit) p.set("edit", sp.edit);
  redirect(`/admin/settings/banking?${p.toString()}`);
}
