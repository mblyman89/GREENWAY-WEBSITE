"use server";

/**
 * src/app/admin/inventory/fix-later/actions.ts   (D200)
 *
 * The two buttons the owner asked for: "give me a simple crawl button ...
 * Then a button to attach everything automatically."
 * D201 adds the Gmail search, attach (+ preview) and the one-product search.
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

// --- D201: COAs from Stephen's Gmail ------------------------------------------------------------
// "Please build me a targeted search for his email address ... Two buttons if possible, a fetch and
// attach buttons ... Let me click a missing coa product and have that be a targeted search."

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const backGmail = (extra: Record<string, string>, anchor = "coa-from-gmail") =>
  `/admin/inventory/fix-later?${new URLSearchParams(extra).toString()}#${anchor}`;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** "Search Gmail for the missing COAs": exact questions per delivery, new emails kept (read-only Gmail). */
export async function searchGmailForCoasAction() {
  const session = await requirePermission("inventory.manage");
  const { searchGmailForCoas } = await import("@/lib/inventory/coa-gmail-search-store");
  const { searchNote, searchTone } = await import("@/lib/inventory/coa-gmail-search-core");
  let extra: Record<string, string>;
  try {
    const t = await searchGmailForCoas(session.userId);
    extra = { gm: searchTone(t), gm_msg: searchNote(t).slice(0, 900) };
  } catch (err) {
    extra = { gm: "warn", gm_msg: `Stopped: ${errText(err)}` };
  }
  revalidatePath("/admin/inventory/fix-later");
  redirect(backGmail(extra));
}

/** "Attach COAs from Gmail" (and its preview, which writes nothing). */
export async function attachCoasFromGmailAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const dryRun = formData.get("dryRun") === "1";
  const { attachCoasFromGmail } = await import("@/lib/inventory/coa-gmail-search-store");
  const { attachNote, attachTone } = await import("@/lib/inventory/coa-gmail-search-core");
  let extra: Record<string, string>;
  try {
    const t = await attachCoasFromGmail(session.userId, { dryRun });
    extra = { gm: attachTone(t), gm_msg: attachNote(t).slice(0, 900) };
  } catch (err) {
    extra = { gm: "warn", gm_msg: `Stopped: ${errText(err)}` };
  }
  if (!dryRun) {
    revalidatePath("/admin/inventory/fix-later");
    revalidatePath("/admin/inventory");
  }
  redirect(backGmail(extra));
}

/** One stubborn product (lotId) or one delivery (manifestId): a wider search, then attach it. */
export async function searchGmailForOneAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = String(formData.get("lotId") ?? "").trim();
  const manifestId = String(formData.get("manifestId") ?? "").trim();
  if (!(lotId ? UUID_RE.test(lotId) : UUID_RE.test(manifestId))) {
    redirect(backGmail({ gm: "warn", gm_msg: "Search not started: that product or delivery id is not valid." }));
  }
  const { searchGmailForOne, oneSearchNote } = await import("@/lib/inventory/coa-gmail-search-store");
  let extra: Record<string, string>;
  try {
    const r = await searchGmailForOne(session.userId, lotId ? { lotId } : { manifestId });
    extra = { gm: r.ok && r.lotLinked !== false ? "ok" : "warn", gm_msg: oneSearchNote(r).slice(0, 900) };
  } catch (err) {
    extra = { gm: "warn", gm_msg: `Stopped: ${errText(err)}` };
  }
  revalidatePath("/admin/inventory/fix-later");
  revalidatePath("/admin/inventory");
  redirect(backGmail(extra));
}

// --- D203: the deep dig for the last deliveries ------------------------------------------------
// "really deep dive and dig deep to find these last four ... tune the email fetcher to find them."

/** "Deep dig": brand / sender / license / thread / zip / every-link search for the deliveries still missing COAs. */
export async function deepDigGmailAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const manifestId = String(formData.get("manifestId") ?? "").trim();
  if (manifestId && !UUID_RE.test(manifestId)) {
    redirect(backGmail({ gm: "warn", gm_msg: "Deep dig not started: that delivery id is not valid." }));
  }
  const { deepDigGmail } = await import("@/lib/inventory/coa-gmail-deep-store");
  const { deepNote, deepTone } = await import("@/lib/inventory/coa-gmail-deep-core");
  let extra: Record<string, string>;
  try {
    const t = await deepDigGmail(session.userId, manifestId ? { manifestIds: [manifestId] } : {});
    extra = { gm: deepTone(t), gm_msg: deepNote(t).slice(0, 1800) };
  } catch (err) {
    extra = { gm: "warn", gm_msg: `Stopped: ${errText(err)}` };
  }
  revalidatePath("/admin/inventory/fix-later");
  revalidatePath("/admin/inventory");
  redirect(backGmail(extra));
}

// --- D206: re-read every COA and trust it (overnight, on the server) ----------------------------
// "we need all coa's regardless if we like them or not to be read AND trusted ... I will push the
// button before bed and hopefully when I wake up it will be finished."

const backTrust = (extra: Record<string, string>) => `/admin/inventory/fix-later?${new URLSearchParams(extra).toString()}#coa-trust-all`;

/** "Re-read every COA and trust it": writes the run; the cron route /api/cron/coa-trust-all does the reading. */
export async function startTrustAllAction() {
  const session = await requirePermission("inventory.manage");
  const { startTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
  let extra: Record<string, string>;
  try {
    const r = await startTrustAll(session.userId);
    extra = r.ok
      ? { tr: "ok", tr_msg: `Started: ${r.target} certificate${r.target === 1 ? "" : "s"} to read and accept. The server works on them every 5 minutes; you can close this page.` }
      : { tr: "warn", tr_msg: `Not started: ${r.error}`.slice(0, 600) };
  } catch (err) {
    extra = { tr: "warn", tr_msg: `Not started: ${errText(err)}` };
  }
  revalidatePath("/admin/inventory/fix-later");
  redirect(backTrust(extra));
}

/** Stop the overnight run (it can be started again from the beginning). */
export async function stopTrustAllAction() {
  const session = await requirePermission("inventory.manage");
  const { stopTrustAll } = await import("@/lib/inventory/coa-trust-all-store");
  let extra: Record<string, string>;
  try {
    const r = await stopTrustAll(session.userId);
    extra = r.ok ? { tr: "ok", tr_msg: "Stopped. Everything read so far is kept." } : { tr: "warn", tr_msg: `Not stopped: ${r.error ?? "unknown error"}` };
  } catch (err) {
    extra = { tr: "warn", tr_msg: `Not stopped: ${errText(err)}` };
  }
  revalidatePath("/admin/inventory/fix-later");
  redirect(backTrust(extra));
}
