/**
 * src/lib/payments/timberland-golive-store.ts   (R41 S9, plan point 1)
 *
 * Reads everything the Go-Live Readiness board needs and hands it to the pure
 * core (timberland-golive-core). Server-only, read-only.
 *
 * Honesty: every reader that fails becomes null ("could not be read"), never
 * a green. The owner inbox is read here with strict error handling (the nav
 * badge's countWaitingForOwner turns errors into zero, which is fine for a
 * badge but would be a false green on a readiness board).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { rolesForPermission } from "@/lib/auth/roles";
import { loadGuideSnapshot } from "@/lib/payments/ach-guide-store";
import { loadTimberlandRoomLeft, readFirstFileGate, readOpenFilesForDeadlines } from "@/lib/payments/ach-file-ledger-store";
import { latestUploadAndApproval } from "@/lib/payments/timberland-deadline-core";
import type { GoLiveInput, GoLiveStaff } from "@/lib/payments/timberland-golive-core";

const STAFF_READ_CAP = 500;

async function readStaff(): Promise<GoLiveStaff[] | null> {
  if (!isSupabaseServiceConfigured) return null;
  const { data, error } = await createSupabaseAdminClient().from("staff_profiles").select("full_name, email, role, active").limit(STAFF_READ_CAP + 1);
  if (error || !Array.isArray(data) || data.length > STAFF_READ_CAP) return null;
  const out: GoLiveStaff[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (typeof r.role !== "string" || typeof r.active !== "boolean" || typeof r.email !== "string") return null;
    const name = typeof r.full_name === "string" && r.full_name.trim() ? r.full_name.trim() : r.email;
    out.push({ name, role: r.role, active: r.active });
  }
  return out;
}

async function readInbox(): Promise<{ pending: number; toReview: number } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const [p, r] = await Promise.all([
    admin.from("ach_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("ach_owner_reviews").select("id", { count: "exact", head: true }).is("checked_off_at", null),
  ]);
  if (p.error || r.error || typeof p.count !== "number" || typeof r.count !== "number") return null;
  return { pending: p.count, toReview: r.count };
}

export async function loadGoLiveInput(todayIso: string, nowUtc: Date): Promise<GoLiveInput> {
  const safe = async <T,>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch {
      return null;
    }
  };
  const [guide, staff, inbox, gate, room, open] = await Promise.all([
    safe(() => loadGuideSnapshot(todayIso)),
    safe(readStaff),
    safe(readInbox),
    safe(() => readFirstFileGate(todayIso)),
    safe(() => loadTimberlandRoomLeft(todayIso)),
    safe(() => readOpenFilesForDeadlines(todayIso)),
  ]);
  const s = guide?.snapshot ?? null;
  const t = s?.timberlandSetup ?? null;

  let nextDeadline: GoLiveInput["nextDeadline"] = null;
  if (open && open.ok) {
    if (open.files.length === 0) nextDeadline = "none";
    else {
      const withDl = open.files.map((f) => ({ f, d: latestUploadAndApproval(f.effectiveDate) })).sort((a, b) => a.d.cutoffUtc.getTime() - b.d.cutoffUtc.getTime());
      const first = withDl[0];
      nextDeadline = { filename: first.f.filename, day: first.d.day, text: first.d.text, cutoffUtc: first.d.cutoffUtc };
    }
  }

  return {
    todayIso,
    nowUtc,
    // A failed guide read is red (false), never green; the page shows the guide's own read problems.
    contractOnFile: Boolean(s?.timberlandAgreementDone),
    countersigned: Boolean(t?.countersigned),
    scheduleGEmail: Boolean(t?.scheduleGEmail),
    accessReady: Boolean(t?.accessReady),
    dualApprovalOn: Boolean(t?.dualApprovalOn),
    staff,
    achRoles: rolesForPermission("ach.request"),
    waitingForOwner: inbox,
    matchConfirmed: t ? t.matchConfirmed : null,
    encryptionConfigured: Boolean(s?.encryptionConfigured),
    migrationsReady: Boolean(s?.migrationsReady),
    firstFile: gate && gate.ok ? { open: gate.gate.open, stage: gate.gate.open ? null : gate.gate.stage, line: gate.gate.line } : null,
    room: room && room.ok ? room.room : null,
    nextDeadline,
  };
}
