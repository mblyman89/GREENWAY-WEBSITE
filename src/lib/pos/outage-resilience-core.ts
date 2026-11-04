/**
 * D170 O12 — long-outage early warnings for the register (pure, no I/O).
 *
 * Two things quietly decay while an iPad is offline for a long time:
 *
 *   1. The saved menu (prices, deals, stock, purchase-limit rules). Sales keep
 *      working from it — by design — but the cashier should KNOW it is old,
 *      because a price changed in the back office will not reach this iPad
 *      until the internet returns. The server re-judges every sale at sync.
 *   2. The offline-unlock window (D161, default 168 h). Past it, nobody can
 *      unlock this iPad without the internet. Warn a day ahead so a manager
 *      can get the iPad online (hotspot, failover router) before it stops.
 *
 * Both are warnings only; neither blocks a sale.
 */
import { pacificDayKey } from "@/lib/reports/timezone";

/** A saved menu older than this, while offline, earns a warning. */
export const MENU_STALE_OFFLINE_MS = 2 * 3_600_000;
/** Warn this long before the offline-unlock window closes. */
export const OFFLINE_WINDOW_WARN_MS = 24 * 3_600_000;

function agoText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}

export function menuAgeWarning(input: { fetchedAt: string | null; online: boolean; nowMs: number }): string | null {
  if (input.online || !input.fetchedAt) return null;
  const at = Date.parse(input.fetchedAt);
  if (!Number.isFinite(at)) return null;
  const age = input.nowMs - at;
  const otherDay = pacificDayKey(new Date(at)) !== pacificDayKey(new Date(input.nowMs));
  if (age < MENU_STALE_OFFLINE_MS && !otherDay) return null;
  return (
    `Offline \u2014 this iPad's menu was saved ${agoText(age)} ago${otherDay ? " (an earlier day)" : ""}. ` +
    "Sales still work from it; price or deal changes made since then will not show until the internet is back, and every sale is re-checked when it syncs."
  );
}

export type OfflineWindowInput = {
  online: boolean;
  enabled: boolean;
  maxOfflineHours: number;
  /** Same base the unlock gate uses: max(rosterAt, serverTime). */
  rosterAt: string | null;
  serverTimeMs: number;
  nowMs: number;
};

/** Hours left before offline unlock stops (null = not applicable). */
export function offlineWindowHoursLeft(i: OfflineWindowInput): number | null {
  if (!i.enabled) return null;
  const roster = i.rosterAt ? Date.parse(i.rosterAt) : NaN;
  const base = Number.isFinite(roster) ? Math.max(roster, i.serverTimeMs) : i.serverTimeMs;
  if (!Number.isFinite(base) || base <= 0) return null;
  return (base + i.maxOfflineHours * 3_600_000 - i.nowMs) / 3_600_000;
}

export function offlineWindowWarning(i: OfflineWindowInput): string | null {
  if (i.online) return null;
  const left = offlineWindowHoursLeft(i);
  if (left === null || left * 3_600_000 > OFFLINE_WINDOW_WARN_MS) return null;
  if (left <= 0) {
    return "Offline too long \u2014 PIN unlock on this iPad now needs the internet. Connect it (store Wi-Fi, a phone hotspot, or the backup router) so the team can sign in.";
  }
  const h = Math.max(1, Math.floor(left));
  return `Offline for a long time \u2014 PIN unlock on this iPad stops working in about ${h} hour${h === 1 ? "" : "s"}. Connect it to any internet (a phone hotspot is fine) for a minute to reset the clock.`;
}

/** The single outage line the register shows (window beats menu age). */
export function outageWarning(menu: Parameters<typeof menuAgeWarning>[0], windowInput: OfflineWindowInput | null): string | null {
  return (windowInput ? offlineWindowWarning(windowInput) : null) ?? menuAgeWarning(menu);
}

export function __runOutageResilienceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`outage-resilience-core FAIL: ${label}`);
    }
  };
  const now = Date.parse("2026-11-04T20:00:00.000Z"); // 12:00 Pacific
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  ok(menuAgeWarning({ fetchedAt: iso(5 * 3_600_000), online: true, nowMs: now }) === null, "online: never warns");
  ok(menuAgeWarning({ fetchedAt: null, online: false, nowMs: now }) === null, "no menu: other screens handle it");
  ok(menuAgeWarning({ fetchedAt: iso(30 * 60_000), online: false, nowMs: now }) === null, "fresh menu offline: quiet");
  const w = menuAgeWarning({ fetchedAt: iso(3 * 3_600_000), online: false, nowMs: now });
  ok(!!w && w.includes("3 hours"), "old menu offline: warns with the age");
  const d = menuAgeWarning({ fetchedAt: "2026-11-04T07:30:00.000Z", online: false, nowMs: Date.parse("2026-11-04T08:30:00.000Z") });
  ok(!!d && d.includes("earlier day"), "a save before Pacific midnight is flagged even 1 h later");
  ok(menuAgeWarning({ fetchedAt: "garbage", online: false, nowMs: now }) === null, "bad date: quiet");
  const base: OfflineWindowInput = { online: false, enabled: true, maxOfflineHours: 168, rosterAt: iso(100 * 3_600_000), serverTimeMs: now - 100 * 3_600_000, nowMs: now };
  ok(Math.round(offlineWindowHoursLeft(base)!) === 68, "hours left = window - elapsed");
  ok(offlineWindowWarning(base) === null, "plenty left: quiet");
  const near = { ...base, rosterAt: iso(150 * 3_600_000), serverTimeMs: now - 150 * 3_600_000 };
  ok(/about 18 hours/.test(offlineWindowWarning(near) ?? ""), "within a day: warns with hours");
  ok(offlineWindowWarning({ ...near, online: true }) === null, "online: quiet");
  ok(offlineWindowWarning({ ...near, enabled: false }) === null, "offline unlock off: quiet");
  const past = { ...base, rosterAt: iso(200 * 3_600_000), serverTimeMs: now - 200 * 3_600_000 };
  ok(/now needs the internet/.test(offlineWindowWarning(past) ?? ""), "past the window: says so");
  ok(Math.round(offlineWindowHoursLeft({ ...base, rosterAt: iso(10 * 3_600_000) })!) === 158, "newer roster wins (same base as the gate)");
  ok(outageWarning({ fetchedAt: iso(5 * 3_600_000), online: false, nowMs: now }, near)!.includes("PIN unlock"), "window beats menu age");
  ok(outageWarning({ fetchedAt: iso(5 * 3_600_000), online: false, nowMs: now }, null)!.includes("menu"), "menu age alone");
  ok(outageWarning({ fetchedAt: iso(60_000), online: false, nowMs: now }, base) === null, "all healthy: quiet");
  return { passed, failed };
}
