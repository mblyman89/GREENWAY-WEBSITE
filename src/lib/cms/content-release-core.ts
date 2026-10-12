/**
 * R46-S2: RELEASES - several website changes that go live together. PURE.
 *
 * Modelled on Sanity "Content Releases" and Contentful "Releases": a release
 * is a named bundle ("Black Friday") of changes (publish this slide, hide
 * that one, publish this FAQ answer). Nothing in it happens until the release
 * is published, either NOW by a button, or at ONE scheduled time by the same
 * 5-minute cron as single schedules.
 *
 * Storage (migration 0267): one content_releases row + one content_schedule
 * row per item with release_id set.
 *   release draft      -> items 'held', run_at NULL (waiting)
 *   release scheduled  -> items 'pending', run_at = release.run_at
 *   release published  -> items 'done' (or 'failed' with the reason)
 *   release cancelled  -> open items 'cancelled'
 *
 * This file decides names, which status changes are allowed, and what an
 * item's status/time must be for a given release state.
 */
import type { ScheduleAction, ScheduleTargetKind } from "./content-schedule-core";

export const RELEASE_STATUSES = ["draft", "scheduled", "published", "cancelled"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_NAME_MAX = 80;
export const RELEASE_NOTE_MAX = 500;
/** Keep a release small enough to publish inside one request. */
export const RELEASE_MAX_ITEMS = 40;

export type ReleaseOp = "add_item" | "remove_item" | "schedule" | "unschedule" | "publish_now" | "cancel" | "rename";

/** Which operations each release status allows. */
export function canDo(status: ReleaseStatus | string, op: ReleaseOp): boolean {
  switch (status) {
    case "draft":
      return op !== "unschedule";
    case "scheduled":
      return true; // adding an item to a scheduled release gives it the release time
    default:
      return false; // published / cancelled are history
  }
}

/** Trim + collapse whitespace; null when invalid. */
export function cleanReleaseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.length > RELEASE_NAME_MAX) return null;
  return s;
}

export function cleanReleaseNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, RELEASE_NOTE_MAX);
}

/** The status + time an item must have, given its release's state. */
export function itemStateFor(release: { status: ReleaseStatus | string; run_at: string | null }): {
  status: "held" | "pending";
  run_at: string | null;
} {
  if (release.status === "scheduled" && release.run_at) return { status: "pending", run_at: release.run_at };
  return { status: "held", run_at: null };
}

export type ReleaseItemLite = {
  target_kind: ScheduleTargetKind;
  target_key: string;
  action: ScheduleAction;
  status: string;
};

/**
 * One entry per item per release: asking to add an item that is already in
 * the release with the same action is a no-op; with the other action it
 * REPLACES the old entry (you cannot publish and hide the same thing at the
 * same instant).
 */
export function planAddItem(
  existing: readonly ReleaseItemLite[],
  add: { kind: ScheduleTargetKind; key: string; action: ScheduleAction },
): { kind: "noop" } | { kind: "insert" } | { kind: "replace" } | { kind: "full" } {
  const open = existing.filter((e) => e.status === "held" || e.status === "pending");
  const same = open.find((e) => e.target_kind === add.kind && e.target_key === add.key);
  if (same) return same.action === add.action ? { kind: "noop" } : { kind: "replace" };
  if (open.length >= RELEASE_MAX_ITEMS) return { kind: "full" };
  return { kind: "insert" };
}

/** Plain summary for the release card: "3 changes · 2 go live, 1 comes down". */
export function summarizeItems(items: readonly { action: ScheduleAction; status: string }[]): string {
  const open = items.filter((i) => i.status === "held" || i.status === "pending" || i.status === "running");
  const pool = open.length > 0 ? open : items;
  if (pool.length === 0) return "No changes yet";
  const up = pool.filter((i) => i.action === "publish").length;
  const down = pool.length - up;
  const parts: string[] = [];
  if (up) parts.push(`${up} go${up === 1 ? "es" : ""} live`);
  if (down) parts.push(`${down} come${down === 1 ? "s" : ""} down`);
  return `${pool.length} change${pool.length === 1 ? "" : "s"} · ${parts.join(", ")}`;
}

/** Final release status after publishing: published if nothing is still open. */
export function releaseOutcome(items: readonly { status: string }[]): { settled: boolean; failed: number; done: number } {
  const open = items.filter((i) => i.status === "held" || i.status === "pending" || i.status === "running").length;
  return {
    settled: open === 0,
    failed: items.filter((i) => i.status === "failed").length,
    done: items.filter((i) => i.status === "done").length,
  };
}

export function __runContentReleaseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) passed++;
    else {
      failed++;
      console.error(`content-release-core: ${name}: got ${g}, want ${w}`);
    }
  };

  eq("draft add", canDo("draft", "add_item"), true);
  eq("draft unschedule", canDo("draft", "unschedule"), false);
  eq("draft publish", canDo("draft", "publish_now"), true);
  eq("scheduled unschedule", canDo("scheduled", "unschedule"), true);
  eq("scheduled add", canDo("scheduled", "add_item"), true);
  eq("published frozen", canDo("published", "add_item"), false);
  eq("cancelled frozen", canDo("cancelled", "publish_now"), false);
  eq("unknown frozen", canDo("weird", "rename"), false);

  eq("name trim", cleanReleaseName("  Black   Friday "), "Black Friday");
  eq("name empty", cleanReleaseName("   "), null);
  eq("name long", cleanReleaseName("x".repeat(81)), null);
  eq("name 80 ok", cleanReleaseName("x".repeat(80))?.length, 80);
  eq("name non-string", cleanReleaseName(5), null);
  eq("note empty", cleanReleaseNote(" "), null);
  eq("note clip", cleanReleaseNote("y".repeat(600))?.length, 500);

  eq("item draft", itemStateFor({ status: "draft", run_at: null }), { status: "held", run_at: null });
  eq("item scheduled", itemStateFor({ status: "scheduled", run_at: "2026-11-27T14:00:00.000Z" }), { status: "pending", run_at: "2026-11-27T14:00:00.000Z" });
  eq("item scheduled no time", itemStateFor({ status: "scheduled", run_at: null }), { status: "held", run_at: null });

  const ex: ReleaseItemLite[] = [
    { target_kind: "carousel_slide", target_key: "a", action: "publish", status: "held" },
    { target_kind: "faq_item", target_key: "b", action: "unpublish", status: "held" },
    { target_kind: "faq_item", target_key: "c", action: "publish", status: "cancelled" },
  ];
  eq("add new", planAddItem(ex, { kind: "shop_slide", key: "z", action: "publish" }), { kind: "insert" });
  eq("add same", planAddItem(ex, { kind: "carousel_slide", key: "a", action: "publish" }), { kind: "noop" });
  eq("add flip", planAddItem(ex, { kind: "faq_item", key: "b", action: "publish" }), { kind: "replace" });
  eq("cancelled ignored", planAddItem(ex, { kind: "faq_item", key: "c", action: "unpublish" }), { kind: "insert" });
  const full: ReleaseItemLite[] = Array.from({ length: RELEASE_MAX_ITEMS }, (_, i) => ({
    target_kind: "faq_item",
    target_key: `k${i}`,
    action: "publish",
    status: "held",
  }));
  eq("full", planAddItem(full, { kind: "faq_item", key: "new", action: "publish" }), { kind: "full" });
  eq("full but existing flip", planAddItem(full, { kind: "faq_item", key: "k1", action: "unpublish" }), { kind: "replace" });

  eq("summary empty", summarizeItems([]), "No changes yet");
  eq(
    "summary mix",
    summarizeItems([
      { action: "publish", status: "held" },
      { action: "publish", status: "held" },
      { action: "unpublish", status: "held" },
      { action: "unpublish", status: "cancelled" },
    ]),
    "3 changes · 2 go live, 1 comes down",
  );
  eq("summary one", summarizeItems([{ action: "publish", status: "pending" }]), "1 change · 1 goes live");
  eq("summary history", summarizeItems([{ action: "unpublish", status: "done" }, { action: "unpublish", status: "done" }]), "2 changes · 2 come down");

  eq("outcome open", releaseOutcome([{ status: "done" }, { status: "pending" }]).settled, false);
  eq("outcome settled", releaseOutcome([{ status: "done" }, { status: "failed" }, { status: "cancelled" }]), { settled: true, failed: 1, done: 1 });

  return { passed, failed };
}
