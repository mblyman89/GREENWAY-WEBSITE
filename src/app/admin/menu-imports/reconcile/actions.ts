"use server";

/**
 * R50 A2 - the go / no-go page's buttons. Every one is permission-gated,
 * re-reads the truth on the server (never trusts the form), and returns to the
 * page with a plain-English notice or error.
 *
 *   explainLineAction   - "I looked at this line: <note>"     (menu.import)
 *   unexplainLineAction - take a note back                    (menu.import)
 *   signOffAction       - "I checked this; we can open"       (menu.publish)
 *                         only when the server's own recompute says GO or
 *                         GO (explained); records the numbers it signed.
 *   createMissingLotsAction - re-runs the import's own lot step
 *                         (backfillImportLots: adds only lots that do not
 *                         exist yet; safe to press again)     (menu.publish)
 *   bulkExplainAction   - one note on every OPEN line in the current view
 *                         (A2+; re-reads the lines on the server, refuses if
 *                         the count moved since the page loaded) (menu.import)
 *   bulkUnexplainAction - take back the notes on every explained line in the
 *                         current view (the undo for a bulk note) (menu.import)
 *
 * "Save & next" is explainLineAction with next_key: after saving it returns
 * to the page jumped to the next line without a note.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { backfillImportLots } from "@/lib/pos/import-service";
import { loadReconcile, writeReconcileEvent, writeReconcileEvents } from "@/lib/pos/cultivera-reconcile";
import {
  RECONCILE_EXPLAIN_ACTION,
  RECONCILE_SIGNOFF_ACTION,
  RECONCILE_UNEXPLAIN_ACTION,
  checkBulk,
  explainedKeys,
  filterFromParams,
  filterLines,
  lineAnchor,
  lineKey,
  openKeys,
  parseExplainInput,
  parseNoteText,
  verdictFor,
} from "@/lib/pos/cultivera-reconcile-core";

const BASE = "/admin/menu-imports/reconcile";

/** Back to the page, keeping the owner's filters (only known keys, only safe values). */
function back(importId: string, form: FormData, extra: Record<string, string>): string {
  const q = new URLSearchParams();
  if (importId) q.set("import", importId);
  for (const k of ["kind", "vendor", "category", "q", "open", "page"]) {
    const v = String(form.get(`keep_${k}`) ?? "").slice(0, 200);
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${BASE}?${q.toString()}`;
}

function importIdOf(form: FormData): string {
  const id = String(form.get("importId") ?? "");
  return isSafeImportId(id) ? id : "";
}

export async function explainLineAction(form: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const importId = importIdOf(form);
  if (!importId) redirect(`${BASE}?error=` + encodeURIComponent("Missing or invalid import id."));
  const parsed = parseExplainInput({ key: form.get("key"), note: form.get("note") });
  if (!parsed.ok) redirect(back(importId, form, { error: parsed.error }));
  if (!isSupabaseServiceConfigured) redirect(back(importId, form, { error: "Supabase is not configured." }));
  const err = await writeReconcileEvent(createSupabaseAdminClient(), {
    importId,
    action: RECONCILE_EXPLAIN_ACTION,
    actorId: session.userId,
    actorEmail: session.email,
    after: { key: parsed.key, note: parsed.note },
  });
  if (err) redirect(back(importId, form, { error: `Your note was NOT saved: ${err}` }));
  revalidatePath(BASE);
  // "Save & next": jump to the next line without a note (the page works out its page number).
  const nextKey = String(form.get("next_key") ?? "");
  if (String(form.get("next") ?? "") === "1") {
    if (nextKey && parseExplainInput({ key: nextKey, note: "next" }).ok) {
      redirect(back(importId, form, { notice: "Note saved. Here is the next line without a note.", jump: nextKey }) + "#" + lineAnchor(nextKey));
    }
    redirect(back(importId, form, { notice: "Note saved. That was the last line without a note in this view." }));
  }
  redirect(back(importId, form, { notice: "Note saved. That line now counts as explained." }));
}

export async function unexplainLineAction(form: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const importId = importIdOf(form);
  if (!importId) redirect(`${BASE}?error=` + encodeURIComponent("Missing or invalid import id."));
  const parsed = parseExplainInput({ key: form.get("key"), note: "remove" });
  if (!parsed.ok) redirect(back(importId, form, { error: parsed.error }));
  if (!isSupabaseServiceConfigured) redirect(back(importId, form, { error: "Supabase is not configured." }));
  const err = await writeReconcileEvent(createSupabaseAdminClient(), {
    importId,
    action: RECONCILE_UNEXPLAIN_ACTION,
    actorId: session.userId,
    actorEmail: session.email,
    after: { key: parsed.key },
  });
  if (err) redirect(back(importId, form, { error: `The note was NOT removed: ${err}` }));
  revalidatePath(BASE);
  redirect(back(importId, form, { notice: "Note removed. That line is open again." }));
}

export async function signOffAction(form: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const importId = importIdOf(form);
  if (!importId) redirect(`${BASE}?error=` + encodeURIComponent("Missing or invalid import id."));
  if (!isSupabaseServiceConfigured) redirect(back(importId, form, { error: "Supabase is not configured." }));
  if (String(form.get("confirm") ?? "") !== "yes") redirect(back(importId, form, { error: "Tick the box to confirm you checked the numbers." }));
  const admin = createSupabaseAdminClient();
  const load = await loadReconcile(admin, importId);
  if (!load.ok) redirect(back(importId, form, { error: load.error }));
  if (load.notesError) redirect(back(importId, form, { error: `Cannot sign off: ${load.notesError}` }));
  const v = verdictFor(load.report, load.explanations);
  if (v.verdict === "no_go") redirect(back(importId, form, { error: `Cannot sign off: ${v.open} line(s) are still unexplained (or a read failed). The numbers were re-checked just now.` }));
  const err = await writeReconcileEvent(admin, {
    importId,
    action: RECONCILE_SIGNOFF_ACTION,
    actorId: session.userId,
    actorEmail: session.email,
    after: {
      verdict: v.verdict,
      cultivera: load.report.totals.cultivera,
      ours: load.report.totals.ours,
      open: v.open,
      explainedKeys: load.report.mismatches.map(lineKey).filter((k) => load.explanations.has(k)),
    },
  });
  if (err) redirect(back(importId, form, { error: `Sign-off was NOT saved: ${err}` }));
  revalidatePath(BASE);
  redirect(back(importId, form, { notice: "Signed off. The numbers you signed are recorded with your name and the time." }));
}

export async function createMissingLotsAction(form: FormData): Promise<void> {
  const session = await requirePermission("menu.publish");
  const importId = importIdOf(form);
  if (!importId) redirect(`${BASE}?error=` + encodeURIComponent("Missing or invalid import id."));
  let msg: string;
  try {
    const s = await backfillImportLots(importId, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.backfill_lots",
      entityType: "pos_import",
      entityId: importId,
      after: { ...s, from: "reconcile" },
    });
    msg =
      s.created > 0
        ? `Created ${s.created} missing lot(s). The page below has been re-checked.`
        : `No lots were missing to create (${s.alreadyPresent} already exist). Any line still red needs a look by hand.`;
  } catch (e) {
    redirect(back(importId, form, { error: e instanceof Error ? e.message : "Creating the lots failed." }));
  }
  revalidatePath(BASE);
  redirect(back(importId, form, { notice: msg }));
}

/** The keep_* fields the page sends, read as the same filter the page used. */
function keptFilter(form: FormData) {
  return filterFromParams((k) => {
    const v = form.get(`keep_${k}`);
    return typeof v === "string" ? v : undefined;
  });
}

async function bulk(form: FormData, verb: "explain" | "remove"): Promise<never> {
  const session = await requirePermission("menu.import");
  const importId = importIdOf(form);
  if (!importId) redirect(`${BASE}?error=` + encodeURIComponent("Missing or invalid import id."));
  let note = "";
  if (verb === "explain") {
    const parsed = parseNoteText(form.get("note"));
    if (!parsed.ok) redirect(back(importId, form, { error: parsed.error }));
    note = parsed.note;
  }
  if (!isSupabaseServiceConfigured) redirect(back(importId, form, { error: "Supabase is not configured." }));
  const admin = createSupabaseAdminClient();
  const load = await loadReconcile(admin, importId);
  if (!load.ok) redirect(back(importId, form, { error: load.error }));
  // Without the notes we cannot tell which lines are open: never guess.
  if (load.notesError) redirect(back(importId, form, { error: `Nothing was saved: ${load.notesError}` }));
  const lines = filterLines(load.report.mismatches, keptFilter(form), load.explanations);
  const keys = verb === "explain" ? openKeys(lines, load.explanations) : explainedKeys(lines, load.explanations);
  const chk = checkBulk({ keys, expected: form.get("expected"), confirm: form.get("confirm"), verb });
  if (!chk.ok) redirect(back(importId, form, { error: chk.error }));
  const err = await writeReconcileEvents(admin, {
    importId,
    action: verb === "explain" ? RECONCILE_EXPLAIN_ACTION : RECONCILE_UNEXPLAIN_ACTION,
    actorId: session.userId,
    actorEmail: session.email,
    afters: keys.map((key) => (verb === "explain" ? { key, note, bulk: true } : { key, bulk: true })),
  });
  if (err) redirect(back(importId, form, { error: `Nothing was saved: ${err}` }));
  revalidatePath(BASE);
  redirect(
    back(importId, form, {
      notice:
        verb === "explain"
          ? `Saved your note on ${keys.length} line(s). To undo, use "Remove the notes" in the same view.`
          : `Removed the notes from ${keys.length} line(s). They are open again.`,
    }),
  );
}

export async function bulkExplainAction(form: FormData): Promise<void> {
  await bulk(form, "explain");
}

export async function bulkUnexplainAction(form: FormData): Promise<void> {
  await bulk(form, "remove");
}
