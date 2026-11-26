"use server";
/**
 * OI-ACC S3 - add / archive / restore an Other Inventory type. Shared by the
 * Other Inventory page and Website > Accessory Cards (owner: "if one page
 * makes a new type, it shows up on the other page"). inventory.manage OR
 * content.edit may change the list; every change is audited and both pages
 * plus the shop are revalidated.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { addNcType, setNcTypeArchived } from "@/lib/noncannabis/types-store";

async function requireAnyPermission(perms: ("inventory.manage" | "content.edit")[]) {
  const session = await requireStaff();
  if (!perms.some((p) => can(session.profile.role, p))) redirect("/admin?denied=1");
  return session;
}

const PAGES = { inventory: "/admin/inventory/noncannabis", cards: "/admin/content/accessory-cards" } as const;

function backOf(formData: FormData): string {
  return String(formData.get("back") ?? "") === "cards" ? PAGES.cards : PAGES.inventory;
}

function refresh(): void {
  revalidatePath(PAGES.inventory);
  revalidatePath(PAGES.cards);
  revalidatePath("/menu");
  revalidatePath("/accessories/[type]", "page");
  revalidatePath("/menu/[category]", "page");
}

export async function addNcTypeAction(formData: FormData): Promise<void> {
  const session = await requireAnyPermission(["inventory.manage", "content.edit"]);
  const back = backOf(formData);
  const label = String(formData.get("label") ?? "");
  const res = await addNcType(label, session.userId);
  if (!res.ok) redirect(`${back}?typeError=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "noncannabis.type.add", entityType: "noncannabis_types", entityId: res.value, after: { label } });
  refresh();
  redirect(`${back}?typeAdded=${encodeURIComponent(res.value)}`);
}

async function archive(formData: FormData, archived: boolean): Promise<void> {
  const session = await requireAnyPermission(["inventory.manage", "content.edit"]);
  const back = backOf(formData);
  const value = String(formData.get("value") ?? "");
  const res = await setNcTypeArchived(value, archived, session.userId);
  if (!res.ok) redirect(`${back}?typeError=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: archived ? "noncannabis.type.archive" : "noncannabis.type.restore", entityType: "noncannabis_types", entityId: value, after: { archived } });
  refresh();
  redirect(back);
}

export async function archiveNcTypeAction(formData: FormData): Promise<void> {
  await archive(formData, true);
}
export async function restoreNcTypeAction(formData: FormData): Promise<void> {
  await archive(formData, false);
}
