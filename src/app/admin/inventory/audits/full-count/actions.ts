"use server";

/**
 * src/app/admin/inventory/audits/full-count/actions.ts   (Fix Phase 4.4d · G-41)
 *
 * The year-end full count's server actions. Every one is OWNER ONLY
 * (inventory.audit): creating, releasing, approving, posting and cancelling a
 * count are the owner's (D50, D54, D56: "the owner alone initiates"). Counting
 * a section is ordinary Cycle Counts work and uses the existing count actions.
 *
 * Each batch action reuses the single-audit path per section (the store), so
 * a section that is not ready is LISTED, never forced.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { checkFullCountYear, checkSectionLots } from "@/lib/inventory/full-count-core";
import {
  approveReadySections,
  cancelFullCount,
  createFullCount,
  postApprovedSections,
  releaseAllSections,
} from "@/lib/inventory/full-count-store";

const BASE = "/admin/inventory/audits/full-count";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

function back(path: string, kind: "refusal" | "notice", message: string, code?: string): never {
  const q = new URLSearchParams({ [kind]: message.slice(0, 1500) });
  if (code) q.set("refusalCode", code);
  redirect(`${path}?${q.toString()}`);
}

function fullCountIdOf(form: FormData): string {
  const id = field(form, "fullCountId");
  if (!UUID.test(id)) back(BASE, "refusal", "That full count could not be identified. Nothing was changed.", "BAD_ID");
  return id;
}

function batchNotice(what: string, done: number, skipped: string[]): string {
  const head = `${done} section${done === 1 ? "" : "s"} ${what}.`;
  return skipped.length === 0 ? head : `${head} Not done: ${skipped.join(" \u00b7 ")}`;
}

export async function createFullCountAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const today = pacificToday();
  const year = checkFullCountYear(field(form, "year"), today);
  if (!year.ok) back(BASE, "refusal", year.message, "BAD_YEAR");
  const size = checkSectionLots(field(form, "sectionLots"));
  if (!size.ok) back(BASE, "refusal", size.message, "BAD_SECTION_SIZE");

  const r = await createFullCount({ year: year.value, sectionLots: size.value, actorId: session.profile.id });
  if (!r.ok) back(BASE, "refusal", r.refusal.message, r.refusal.code);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.full_count.create",
    entityType: "inventory_audit_sessions",
    entityId: r.data.fullCountId,
    after: { year: year.value, sectionLots: size.value, sections: r.data.sections, lots: r.data.lots },
  });
  revalidatePath("/admin/inventory/audits");
  revalidatePath(BASE);
  redirect(`${BASE}/${r.data.fullCountId}`);
}

export async function releaseFullCountAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const id = fullCountIdOf(form);
  const path = `${BASE}/${id}`;
  const r = await releaseAllSections(id, session.profile.id);
  if (!r.ok) back(path, "refusal", r.refusal.message, r.refusal.code);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.full_count.release",
    entityType: "inventory_audit_sessions",
    entityId: id,
    after: { released: r.data.done, skipped: r.data.skipped },
  });
  revalidatePath("/admin/inventory/cycle-counts");
  revalidatePath("/admin/inventory/audits");
  back(path, "notice", batchNotice("released to Cycle Counts", r.data.done, r.data.skipped));
}

export async function approveFullCountAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const id = fullCountIdOf(form);
  const path = `${BASE}/${id}`;
  const r = await approveReadySections(id, session.profile.id);
  if (!r.ok) back(path, "refusal", r.refusal.message, r.refusal.code);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.full_count.approve",
    entityType: "inventory_audit_sessions",
    entityId: id,
    after: { approved: r.data.done, skipped: r.data.skipped },
  });
  revalidatePath("/admin/inventory/audits");
  back(path, "notice", batchNotice("approved", r.data.done, r.data.skipped));
}

export async function postFullCountAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const id = fullCountIdOf(form);
  const path = `${BASE}/${id}`;
  const r = await postApprovedSections(id);
  if (!r.ok) back(path, "refusal", r.refusal.message, r.refusal.code);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.full_count.post",
    entityType: "inventory_audit_sessions",
    entityId: id,
    after: { posted: r.data.done, netCents: r.data.netCents, grossCents: r.data.grossCents, journalNos: r.data.journalNos, skipped: r.data.skipped },
  });
  revalidatePath("/admin/inventory/audits");
  revalidatePath("/admin/books/journal");
  const journals = r.data.journalNos.length > 0 ? ` Draft journal entries ${r.data.journalNos.join(", ")} wait for your approval in the books.` : "";
  back(path, "notice", batchNotice("posted (shelf corrected)", r.data.done, r.data.skipped) + journals);
}

export async function cancelFullCountAction(form: FormData): Promise<void> {
  const session = await requirePermission("inventory.audit");
  const id = fullCountIdOf(form);
  const path = `${BASE}/${id}`;
  const reason = field(form, "reason");
  if (reason.length < 5) back(path, "refusal", "Write why this full count is being cancelled (one sentence). Nothing was changed.", "CANCEL_REASON");
  const r = await cancelFullCount(id, reason);
  if (!r.ok) back(path, "refusal", r.refusal.message, r.refusal.code);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "inventory_audit.full_count.cancel",
    entityType: "inventory_audit_sessions",
    entityId: id,
    after: { cancelled: r.data.done, reason, skipped: r.data.skipped },
  });
  revalidatePath("/admin/inventory/cycle-counts");
  revalidatePath("/admin/inventory/audits");
  back(path, "notice", batchNotice("cancelled", r.data.done, r.data.skipped));
}
