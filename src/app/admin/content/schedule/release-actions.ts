"use server";

/**
 * R46-S2: server actions for Releases (named groups of website changes that
 * go live together). All writes go through content-release-server.ts.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { cleanReleaseName, cleanReleaseNote, RELEASE_NAME_MAX } from "@/lib/cms/content-release-core";
import {
  actionsFor,
  formatRunAt,
  isScheduleAction,
  isTargetKind,
  isValidTargetKey,
  validateScheduleInput,
  TARGET_KIND_LABEL,
} from "@/lib/cms/content-schedule-core";
import { labelForTarget } from "@/lib/cms/content-schedule-server";
import {
  addReleaseItem,
  cancelRelease,
  createRelease,
  publishReleaseNow,
  removeReleaseItem,
  scheduleRelease,
  unscheduleRelease,
} from "@/lib/cms/content-release-server";

const ROUTE = "/admin/content/schedule";
const UUID = /^[0-9a-f-]{36}$/i;

function back(kind: "scheduled" | "error", msg: string, releaseId?: string): never {
  redirect(`${ROUTE}?${kind}=${encodeURIComponent(msg)}${releaseId ? `#release-${releaseId}` : "#releases"}`);
}

function releaseIdFrom(fd: FormData): string {
  const id = String(fd.get("release_id") ?? "");
  if (!UUID.test(id)) back("error", "That release can't be found.");
  return id;
}

async function audit(session: { userId: string | null; email?: string | null }, action: string, id: string, after: Record<string, unknown>) {
  await recordAudit({ actorId: session.userId, actorEmail: session.email ?? null, action, entityType: "content_release", entityId: id, after });
}

export async function createReleaseAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const name = cleanReleaseName(fd.get("name"));
  if (!name) back("error", `Give the release a name (up to ${RELEASE_NAME_MAX} characters).`);
  const note = cleanReleaseNote(fd.get("note"));
  const res = await createRelease(name, note, session.userId);
  if (res.error || !res.id) back("error", res.error ?? "Could not create the release.");
  await audit(session, "release.create", res.id, { name, note });
  revalidatePath(ROUTE);
  back("scheduled", `Release \u201c${name}\u201d created. Add the changes it should make.`, res.id);
}

export async function addReleaseItemAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  const [kind, ...rest] = String(fd.get("target") ?? "").split("|");
  const key = rest.join("|");
  const action = fd.get("action");
  if (!isTargetKind(kind) || !isValidTargetKey(kind, key)) back("error", "Choose an item to add.", id);
  if (!isScheduleAction(action)) back("error", "Choose Go live or Come down.", id);
  if (!actionsFor(kind).includes(action)) back("error", `${TARGET_KIND_LABEL[kind]} can only be set to go live.`, id);
  const label = await labelForTarget(kind, key);
  const res = await addReleaseItem(id, { kind, key, action, label }, session.userId);
  if (res.error) back("error", res.error, id);
  if (res.outcome !== "noop") await audit(session, "release.add_item", id, { kind, key, action, label, outcome: res.outcome });
  revalidatePath(ROUTE);
  back(
    "scheduled",
    res.outcome === "noop" ? "That change is already in the release." : res.outcome === "replace" ? "Change updated in the release." : "Change added to the release.",
    id,
  );
}

export async function removeReleaseItemAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  const itemId = String(fd.get("item_id") ?? "");
  if (!UUID.test(itemId)) back("error", "That change can't be found.", id);
  const res = await removeReleaseItem(id, itemId);
  if (res.error) back("error", res.error, id);
  await audit(session, "release.remove_item", id, { item_id: itemId });
  revalidatePath(ROUTE);
  back("scheduled", "Change removed from the release.", id);
}

export async function scheduleReleaseAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  // Reuse the single-schedule time rules (Pacific, 5-minute grid, future, <= 400 days).
  const v = validateScheduleInput(
    { kind: "faq_item", key: "00000000-0000-0000-0000-000000000000", action: "publish", runAtLocal: fd.get("run_at_local") },
    new Date().toISOString(),
  );
  if (!v.ok) back("error", v.error, id);
  const res = await scheduleRelease(id, v.value.runAt);
  if (res.error) back("error", res.error, id);
  await audit(session, "release.schedule", id, { run_at: v.value.runAt });
  revalidatePath(ROUTE);
  back("scheduled", `Release scheduled for ${formatRunAt(v.value.runAt)}${v.value.snapped ? " (moved to the next 5-minute mark)" : ""}.`, id);
}

export async function unscheduleReleaseAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  const res = await unscheduleRelease(id);
  if (res.error) back("error", res.error, id);
  await audit(session, "release.unschedule", id, {});
  revalidatePath(ROUTE);
  back("scheduled", "Release taken off the schedule. Its changes are on hold.", id);
}

export async function publishReleaseNowAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  const res = await publishReleaseNow(id, session.userId);
  if (res.error) back("error", res.error, id);
  await audit(session, "release.publish_now", id, { done: res.done ?? 0, failed: res.failed ?? 0 });
  revalidatePath(ROUTE);
  const f = res.failed ?? 0;
  back(
    f ? "error" : "scheduled",
    f
      ? `Release published with ${f} change${f === 1 ? "" : "s"} that could not be made. See the reasons below.`
      : `Release published: ${res.done ?? 0} change${res.done === 1 ? " is" : "s are"} live.`,
    id,
  );
}

export async function cancelReleaseAction(fd: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = releaseIdFrom(fd);
  const res = await cancelRelease(id);
  if (res.error) back("error", res.error, id);
  await audit(session, "release.cancel", id, {});
  revalidatePath(ROUTE);
  back("scheduled", "Release cancelled. Nothing in it will happen.", id);
}
