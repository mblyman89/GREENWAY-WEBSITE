"use server";

/**
 * src/app/admin/inventory/labs/actions.ts  (R36 #4)
 *
 * Add a testing lab; add / remove a certificate host on a lab. Every write is
 * validated by testing-labs-core (pure), written by testing-labs-store
 * (optimistic-concurrency guarded for host edits) and audited. Every action
 * redirects back to the page with a result flag; nothing fails silently.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { validateLabForm } from "@/lib/inventory/testing-labs-core";
import { addTestingLab, editLabHost, listTestingLabs } from "@/lib/inventory/testing-labs-store";

const BASE = "/admin/inventory/labs";

function back(params: Record<string, string>): never {
  const q = new URLSearchParams(params);
  redirect(`${BASE}?${q.toString()}`);
}

const field = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function addLabAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const listed = await listTestingLabs();
  if (!listed.ok) back({ error: listed.error });
  const existing = listed.labs.map((l) => ({ name: l.name, labNumber: l.lab_number }));
  const v = validateLabForm(
    {
      name: field(formData, "name"),
      labNumber: field(formData, "lab_number"),
      city: field(formData, "city"),
      phone: field(formData, "phone"),
      website: field(formData, "website"),
      notes: field(formData, "notes"),
    },
    existing,
  );
  if (!v.ok) back({ error: v.error });
  const r = await addTestingLab(v.lab, session.userId);
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "testing_lab.add",
    entityType: "testing_lab",
    entityId: r.id,
    before: null,
    after: { ...v.lab, status: "owner_added" },
  });
  revalidatePath(BASE);
  back({ added: v.lab.name });
}

async function hostEdit(formData: FormData, op: "add" | "remove") {
  const session = await requirePermission("inventory.manage");
  const id = field(formData, "lab_id");
  const host = field(formData, "host");
  const r = await editLabHost(id, op, host, field(formData, "updated_at"));
  if (!r.ok) back({ error: r.error, lab: id });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: op === "add" ? "testing_lab.host_added" : "testing_lab.host_removed",
    entityType: "testing_lab",
    entityId: r.id,
    before: { coa_hosts: r.before },
    after: { coa_hosts: r.after, host: r.host },
  });
  revalidatePath(BASE);
  back({ [op === "add" ? "hostAdded" : "hostRemoved"]: r.host, lab: id });
}

export async function addHostAction(formData: FormData) {
  await hostEdit(formData, "add");
}

export async function removeHostAction(formData: FormData) {
  await hostEdit(formData, "remove");
}
