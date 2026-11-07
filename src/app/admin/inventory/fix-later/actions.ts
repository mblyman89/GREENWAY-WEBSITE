"use server";

/**
 * src/app/admin/inventory/fix-later/actions.ts   (D200)
 *
 * The two buttons the owner asked for: "give me a simple crawl button ...
 * Then a button to attach everything automatically."
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";

const back = (extra: Record<string, string>) => `/admin/inventory/fix-later?${new URLSearchParams(extra).toString()}#coa-from-cultivera`;

/** "Fetch COAs from Cultivera": sends only the transfers that still have stocked lots with no COA. */
export async function fetchCoasFromCultiveraAction() {
  const session = await requirePermission("inventory.manage");
  const { startCoaFetch } = await import("@/lib/inventory/coa-from-cultivera-store");
  const r = await startCoaFetch(session.userId);
  const extra = r.ok
    ? { coa: "ok", coa_msg: `Crawl started for ${r.transfers} Cultivera transfer${r.transfers === 1 ? "" : "s"}. This page refreshes until it is done, then click Attach all COAs.` }
    : { coa: "warn", coa_msg: `Not started: ${r.error}`.slice(0, 600) };
  revalidatePath("/admin/inventory/fix-later");
  redirect(back(extra));
}

/** "Attach all COAs" (and its preview, which writes nothing). */
export async function attachAllCoasAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const dryRun = formData.get("dryRun") === "1";
  const { attachAllCoas } = await import("@/lib/inventory/coa-from-cultivera-store");
  const { coaAttachNote, coaAttachTone } = await import("@/lib/inventory/coa-from-cultivera-core");
  let extra: Record<string, string>;
  try {
    const t = await attachAllCoas(session.userId, { dryRun });
    extra = { coa: coaAttachTone(t), coa_msg: coaAttachNote(t).slice(0, 900) };
  } catch (err) {
    extra = { coa: "warn", coa_msg: `Stopped: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}` };
  }
  if (!dryRun) {
    revalidatePath("/admin/inventory/fix-later");
    revalidatePath("/admin/inventory");
  }
  redirect(back(extra));
}
