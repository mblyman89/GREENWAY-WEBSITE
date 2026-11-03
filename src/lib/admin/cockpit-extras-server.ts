/**
 * src/lib/admin/cockpit-extras-server.ts  (CVB-11, server-only)
 *
 * Today's taxes and the Leafly status for the dashboard cockpit. Each read is independent and never throws:
 * a failure becomes `null`, and the page says "unavailable" / "Cannot check" instead of showing $0.00 or
 * pretending Leafly is fine.
 *
 *   - taxes: getWaTaxReport over today (Pacific midnight to now), the same engine and the same canonical
 *     period basis (completed orders by completed_at) as Reports -> Tax and the LIQ-1295 excise return.
 *   - leafly: the exact verdict the Leafly integration page shows (describeLeaflyConnection with the same
 *     inputs), so the tile and the page cannot disagree.
 */
import "server-only";

import { getWaTaxReport } from "@/lib/reports/wa-tax";
import { pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { listSyndicationLogs } from "@/lib/syndication/store";
import { getSyncState } from "@/lib/syndication/engine-store";
import { classifyHealth } from "@/lib/syndication/richness-core";
import { loadLeaflySyncHealth } from "@/lib/leafly/schedule-server";
import { describeLeaflyConnection, lastAutomaticCheckIso } from "@/lib/leafly/schedule-core";
import { cockpitTaxFigures, type CockpitTaxFigures, type LeaflyVerdictLike } from "@/lib/admin/cockpit-extras-core";

export type CockpitLeafly = { verdict: LeaflyVerdictLike; lastCheckIso: string | null; nowIso: string };

export async function loadCockpitTaxes(): Promise<CockpitTaxFigures | null> {
  try {
    const today = pacificToday();
    const r = await getWaTaxReport(pacificWallTimeToUtcISO(today, "start"), new Date().toISOString());
    return cockpitTaxFigures(r);
  } catch (e) {
    console.error("[cockpit] today's taxes could not be read:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function loadCockpitLeafly(): Promise<CockpitLeafly | null> {
  try {
    const nowIso = new Date().toISOString();
    const [logs, syncState, scheduleHealth] = await Promise.all([
      listSyndicationLogs("leafly", 40),
      getSyncState("leafly"),
      loadLeaflySyncHealth(),
    ]);
    const health = classifyHealth(
      logs
        .filter((l) => l.mode === "live" && l.status !== "skipped")
        .map((l) => ({ status: l.status === "ok" ? "success" : "error", at: l.created_at })),
      new Date(nowIso),
    );
    const sent = scheduleHealth.runs.find((r) => r.pushed && r.disposition === "success");
    const lastCheckIso = lastAutomaticCheckIso(scheduleHealth.runs);
    const verdict = describeLeaflyConnection({
      nowIso,
      // loadLeaflySyncHealth loads the back-office credentials (DB over env) and then asks isLeaflyConfigured.
      configured: scheduleHealth.configured,
      automationEnabled: scheduleHealth.settings.enabled,
      dailyFullHour: scheduleHealth.settings.dailyFullHour,
      lastSentCandidates: [syncState.lastSyncedAt, health.lastSuccessAt, sent?.finishedAt ?? sent?.startedAt ?? null],
      lastCheckIso,
      sendFailuresInARow: health.consecutiveFailures,
      problem: scheduleHealth.problem,
    });
    return { verdict, lastCheckIso, nowIso };
  } catch (e) {
    console.error("[cockpit] Leafly status could not be read:", e instanceof Error ? e.message : e);
    return null;
  }
}
