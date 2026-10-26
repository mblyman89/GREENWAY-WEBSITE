"use server";

/**
 * R74 S50 — the count roster's server actions (Admin › Menu Imports › Count › Roster).
 * Every action needs menu.import, re-reads the roster from storage, changes it, saves it and logs an
 * event on it (and the audit log for the ones that matter). Nothing here writes inventory: the live
 * count is still applied by the existing, digest-checked applyCountAction on the count page.
 */
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import {
  combineRosterIntoImport,
  createLiveRoster,
  createPracticeRoster,
  isRosterId,
  loadManualTicks,
  loadRoster,
  practiceReport,
  receiveRosterUploads,
  saveManualTicks,
  saveRoster,
} from "@/lib/pos/count-roster-store";
import { MANUAL_STEPS, ROSTER_LIMITS, cleanEmail, cleanName, newSheet, parseRosterLines, platformOf, pushEvent, type ManualKey } from "@/lib/pos/count-roster-core";

const COUNT = "/admin/menu-imports/count";
const ROSTER = `${COUNT}/roster`;
const q = (m: string) => encodeURIComponent(m.slice(0, 600));
const at = () => new Date().toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function mustRoster(id: string) {
  if (!isRosterId(id)) redirect(`${COUNT}?error=${q("Unknown roster.")}`);
  const admin = createSupabaseAdminClient();
  const r = await loadRoster(admin, id);
  if (!r) redirect(`${COUNT}?error=${q("That roster was not found.")}`);
  return { admin, r };
}

export async function createLiveRosterAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  let id = "";
  try {
    const r = await createLiveRoster(createSupabaseAdminClient(), {
      title: cleanName(fd.get("title"), 80),
      countDate: String(fd.get("date") ?? ""),
      runId: String(fd.get("run") ?? ""),
      seeds: parseRosterLines(String(fd.get("people") ?? "")),
      extraBlank: Number(fd.get("blank") ?? 0) || 0,
      by: session.email ?? "",
    });
    id = r.rosterId;
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.roster_created", entityType: "count_roster", entityId: id, after: { mode: "live", sheets: r.sheets.length, countDate: r.countDate } });
  } catch (e) {
    redirect(`${COUNT}?error=${q(msg(e))}#roster`);
  }
  redirect(`${ROSTER}?id=${id}&notice=${q("Roster made. Assign anyone missing, then download each person's workbook.")}`);
}

export async function createPracticeRosterAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  let id = "";
  try {
    const r = await createPracticeRoster(createSupabaseAdminClient(), {
      importId: String(fd.get("import_id") ?? ""),
      lots: Number(fd.get("lots") ?? ROSTER_LIMITS.defaultPracticeLots) || ROSTER_LIMITS.defaultPracticeLots,
      sheets: Number(fd.get("sheets") ?? 2) || 2,
      seeds: parseRosterLines(String(fd.get("people") ?? "")),
      by: session.email ?? "",
    });
    id = r.rosterId;
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.roster_created", entityType: "count_roster", entityId: id, after: { mode: "test", sheets: r.sheets.length } });
  } catch (e) {
    redirect(`${COUNT}?error=${q(msg(e))}#practice`);
  }
  redirect(`${ROSTER}?id=${id}&notice=${q("Practice roster made from real lots. Download the sheets, count (or use a pre-filled copy), and upload them back.")}`);
}

export async function updateSheetAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  const s = r.sheets.find((x) => x.number === Number(fd.get("sheet")));
  if (!s) redirect(`${ROSTER}?id=${r.rosterId}&error=${q("That sheet is not on the roster.")}`);
  const before = `${s.assignee}|${s.zone}|${s.email}|${s.platform}`;
  const assignee = cleanName(fd.get("assignee"));
  if (s.received && assignee !== s.assignee && !assignee) redirect(`${ROSTER}?id=${r.rosterId}&error=${q(`Sheet ${s.number} is already uploaded; it cannot be unassigned.`)}`);
  if (assignee && !s.assignee) s.assignedAt = at();
  s.assignee = assignee;
  s.zone = cleanName(fd.get("zone"), ROSTER_LIMITS.maxZoneLength);
  s.email = cleanEmail(fd.get("email"));
  s.platform = platformOf(fd.get("platform"));
  if (`${s.assignee}|${s.zone}|${s.email}|${s.platform}` !== before) {
    const note = s.downloads.length && !s.received ? " It was already downloaded: download it again so the new name is on the workbook (the sheet's id stays the same)." : "";
    pushEvent(r, at(), session.email ?? "", `Sheet ${s.number} set to ${s.assignee || "(unassigned)"}${s.zone ? `, ${s.zone}` : ""}, ${s.platform === "mac" ? "Mac" : "Windows"}.${note}`);
    await saveRoster(admin, r);
  }
  redirect(`${ROSTER}?id=${r.rosterId}#sheet-${s.number}`);
}

export async function addSheetAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  if (r.sheets.filter((s) => !s.voidedAt).length >= ROSTER_LIMITS.maxSheets) redirect(`${ROSTER}?id=${r.rosterId}&error=${q(`At most ${ROSTER_LIMITS.maxSheets} active sheets.`)}`);
  const n = Math.max(0, ...r.sheets.map((s) => s.number)) + 1;
  const s = newSheet(crypto.randomUUID(), n, at(), { assignee: cleanName(fd.get("assignee")), zone: cleanName(fd.get("zone"), ROSTER_LIMITS.maxZoneLength), platform: platformOf(fd.get("platform")) });
  if (r.mode === "test") { s.practiceCodes = []; s.practice = null; }
  r.sheets.push(s);
  r.combined = null;
  pushEvent(r, at(), session.email ?? "", `Sheet ${n} added${s.assignee ? ` for ${s.assignee}` : ""}.`);
  await saveRoster(admin, r);
  redirect(`${ROSTER}?id=${r.rosterId}#sheet-${n}`);
}

export async function voidSheetAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  const s = r.sheets.find((x) => x.number === Number(fd.get("sheet")));
  if (!s) redirect(`${ROSTER}?id=${r.rosterId}`);
  const restore = String(fd.get("restore") ?? "") === "1";
  if (restore) {
    s.voidedAt = null;
    s.voidReason = "";
    pushEvent(r, at(), session.email ?? "", `Sheet ${s.number} restored.`);
  } else {
    const reason = cleanName(fd.get("reason"), 120);
    if (!reason) redirect(`${ROSTER}?id=${r.rosterId}&error=${q("Type why the sheet is voided (e.g. person called out, area merged).")}#sheet-${s.number}`);
    s.voidedAt = at();
    s.voidReason = reason;
    pushEvent(r, at(), session.email ?? "", `Sheet ${s.number} (${s.assignee || "unassigned"}) VOIDED: ${reason}. A copy of it will be refused at upload.`);
  }
  r.combined = null;
  await saveRoster(admin, r);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.roster_sheet_voided", entityType: "count_roster", entityId: r.rosterId, after: { sheet: s.number, workbookId: s.workbookId, restore, reason: s.voidReason } });
  redirect(`${ROSTER}?id=${r.rosterId}#sheet-${s.number}`);
}

export async function markSentAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  const nums = fd.getAll("sheet").map(Number);
  const undo = String(fd.get("undo") ?? "") === "1";
  for (const s of r.sheets.filter((x) => nums.includes(x.number) && !x.voidedAt)) {
    s.sentAt = undo ? null : s.sentAt ?? at();
    pushEvent(r, at(), session.email ?? "", `Sheet ${s.number} (${s.assignee || "unassigned"}) ${undo ? "un-marked as sent" : "marked as emailed to the counter"}.`);
  }
  await saveRoster(admin, r);
  redirect(`${ROSTER}?id=${r.rosterId}${nums.length === 1 ? `#sheet-${nums[0]}` : ""}`);
}

export async function uploadRosterAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const rosterId = String(fd.get("roster_id") ?? "");
  if (!isRosterId(rosterId)) redirect(`${COUNT}?error=${q("Unknown roster.")}`);
  const files = fd.getAll("workbooks").filter((f): f is File => f instanceof File && f.size > 0);
  let sentence = "";
  try {
    const out = await receiveRosterUploads(
      createSupabaseAdminClient(),
      rosterId,
      await Promise.all(files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))),
      session.email ?? "",
    );
    sentence = out.sentence;
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.uploaded", entityType: "count_roster", entityId: rosterId, after: { files: files.map((f) => f.name), stored: out.stored, result: sentence } });
  } catch (e) {
    redirect(`${ROSTER}?id=${rosterId}&error=${q(msg(e))}#upload`);
  }
  redirect(`${ROSTER}?id=${rosterId}&notice=${q(sentence)}#tracker`);
}

export async function combineRosterAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const rosterId = String(fd.get("roster_id") ?? "");
  const importId = String(fd.get("import_id") ?? "");
  if (!isRosterId(rosterId)) redirect(`${COUNT}?error=${q("Unknown roster.")}`);
  if (!isSafeImportId(importId)) redirect(`${ROSTER}?id=${rosterId}&error=${q("Pick the import staged from the count fetch.")}#combine`);
  const admin = createSupabaseAdminClient();
  const r = await loadRoster(admin, rosterId);
  const missing = r ? r.sheets.filter((s) => !s.voidedAt && !s.received) : [];
  if (missing.length > 0 && String(fd.get("allow_missing") ?? "") !== "on") {
    redirect(`${ROSTER}?id=${rosterId}&error=${q(`Still missing: ${missing.map((s) => `#${s.number} ${s.assignee || "(unassigned)"}`).join(", ")}. Upload them, void them with a reason, or tick “build it without them”.`)}#combine`);
  }
  let batchId = "";
  try {
    const out = await combineRosterIntoImport(admin, rosterId, importId, session.userId, session.email ?? "");
    batchId = out.batchId;
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.uploaded", entityType: "pos_import", entityId: importId, after: { rosterId, batchId, missing: out.missing } });
  } catch (e) {
    redirect(`${ROSTER}?id=${rosterId}&error=${q(msg(e))}#combine`);
  }
  redirect(`${COUNT}?import=${importId}&batch=${batchId}&roster=${rosterId}#preview`);
}

export async function runPracticeAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  try {
    const rep = await practiceReport(admin, r);
    const passed = rep.checks.filter((c) => c.ok).length;
    r.practiceResult = { at: at(), verified: rep.verified, checksPassed: passed, checksTotal: rep.checks.length, accuracyPct: rep.stats.overview.lotAccuracyPct };
    pushEvent(r, at(), session.email ?? "", `Practice reconciliation: ${passed} of ${rep.checks.length} checks passed${rep.verified ? " — VERIFIED" : ""}.`);
    await saveRoster(admin, r);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_count.practice_checked", entityType: "count_roster", entityId: r.rosterId, after: r.practiceResult });
  } catch (e) {
    redirect(`${ROSTER}?id=${r.rosterId}&error=${q(msg(e))}#practice-result`);
  }
  redirect(`${ROSTER}?id=${r.rosterId}#practice-result`);
}

export async function archiveRosterAction(fd: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const { admin, r } = await mustRoster(String(fd.get("roster_id") ?? ""));
  r.archived = String(fd.get("unarchive") ?? "") !== "1";
  pushEvent(r, at(), session.email ?? "", r.archived ? "Roster archived." : "Roster restored.");
  await saveRoster(admin, r);
  redirect(r.archived ? `${COUNT}?notice=${q(`${r.title} archived.`)}#roster` : `${ROSTER}?id=${r.rosterId}`);
}

export async function toggleTickAction(fd: FormData): Promise<void> {
  await requirePermission("menu.import");
  const key = String(fd.get("key") ?? "") as ManualKey;
  if (!MANUAL_STEPS.some((m) => m.key === key)) redirect(`${COUNT}#checklist`);
  const admin = createSupabaseAdminClient();
  const t = await loadManualTicks(admin);
  t[key] = t[key] ? null : at();
  await saveManualTicks(admin, t);
  redirect(`${COUNT}#checklist`);
}
