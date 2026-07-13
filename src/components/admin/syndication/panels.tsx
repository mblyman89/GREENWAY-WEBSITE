/**
 * src/components/admin/syndication/panels.tsx  (Task X)
 *
 * Shared PRESENTATIONAL panels for the Leafly / Weedmaps integration pages.
 * Server-renderable (no client hooks) — all data is computed by the pages
 * from the pure cores (richness-core, preflight-core) and the playbook.
 *
 *  - ConnectionHealthPanel: classifyHealth result with plain-language status.
 *  - DataQualityPanel: preflight gate results + menu richness scoring.
 *  - ConnectionWizard: get connected / stay connected / get reconnected,
 *    grounded on the verified syndication playbook.
 */
import { Badge, Card } from "@/components/admin/ui";
import type { BadgeTone } from "@/components/admin/ui";
import type { HealthReport } from "@/lib/syndication/richness-core";
import type { RichnessField, RichnessReport } from "@/lib/syndication/richness-core";
import type { PreflightReport } from "@/lib/syndication/preflight-core";
import type { PlaybookStep, RunbookEntry } from "@/lib/integrations/syndication-playbook";

// ---------------------------------------------------------------------------
// Connection health
// ---------------------------------------------------------------------------

const HEALTH_TONE: Record<HealthReport["status"], BadgeTone> = {
  connected: "green",
  degraded: "orange",
  down: "danger",
  never_connected: "neutral",
};

const HEALTH_LABEL: Record<HealthReport["status"], string> = {
  connected: "Connected",
  degraded: "Degraded",
  down: "Down",
  never_connected: "Not connected yet",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function ConnectionHealthPanel({
  health,
  lastSyncedAt,
}: {
  health: HealthReport;
  /** From syndication_sync_state (may differ from log history pre-migration). */
  lastSyncedAt?: string | null;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Connection health</h2>
        <Badge tone={HEALTH_TONE[health.status]}>{HEALTH_LABEL[health.status]}</Badge>
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">{health.summary}</p>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-[var(--admin-text-faint)]">Last successful sync</dt>
          <dd className="font-medium text-[var(--admin-text)]">
            {fmtWhen(lastSyncedAt ?? health.lastSuccessAt)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--admin-text-faint)]">Last attempt</dt>
          <dd className="font-medium text-[var(--admin-text)]">{fmtWhen(health.lastAttemptAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--admin-text-faint)]">Consecutive failures</dt>
          <dd className="font-medium text-[var(--admin-text)]">{health.consecutiveFailures}</dd>
        </div>
      </dl>
      {health.status === "degraded" || health.status === "down" ? (
        <p className="mt-3 rounded-md border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-2 text-[11px] text-[var(--admin-orange)]">
          Check the most recent error in Recent sync activity below, then match it in the
          &lsquo;Get reconnected&rsquo; runbook — or ask the integrations assistant on the
          Integrations page.
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data quality (preflight gate + richness)
// ---------------------------------------------------------------------------

const FIELD_LABEL: Record<RichnessField, string> = {
  brand: "Brand",
  strain: "Strain",
  thc: "THC",
  cbd: "CBD",
  description: "Description",
  image: "Exact photo",
};

export function DataQualityPanel({
  richness,
  preflight,
  channelLabel,
  imageRelevant,
}: {
  richness: RichnessReport;
  preflight: PreflightReport;
  channelLabel: string;
  /** false for Leafly (v2 has no image field) — the image row is de-emphasized. */
  imageRelevant: boolean;
}) {
  const fields = (Object.keys(FIELD_LABEL) as RichnessField[]).filter(
    (f) => imageRelevant || f !== "image",
  );
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Data quality</h2>
        <Badge tone={preflight.ok ? "green" : "danger"}>
          {preflight.ok ? "Preflight clean" : `${preflight.errorCount} blocking error${preflight.errorCount === 1 ? "" : "s"}`}
        </Badge>
        {preflight.warningCount > 0 ? (
          <Badge tone="orange">{preflight.warningCount} warning{preflight.warningCount === 1 ? "" : "s"}</Badge>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Preflight ERRORS block live pushes until fixed (bad data would corrupt the {channelLabel}{" "}
        menu). Warnings never block. Richness measures how information-rich your menu is —
        higher scores rank and convert better.
      </p>

      {preflight.issues.length > 0 ? (
        <div className="mb-4 max-h-48 space-y-1 overflow-auto">
          {preflight.issues.slice(0, 25).map((issue, i) => (
            <div
              key={`${issue.code}-${issue.itemId}-${issue.variantId ?? ""}-${i}`}
              className="flex items-start gap-2 rounded-md border border-[var(--admin-border)] px-2 py-1.5 text-[11px]"
            >
              <Badge tone={issue.severity === "error" ? "danger" : "orange"}>{issue.severity}</Badge>
              <span className="text-[var(--admin-text-muted)]">{issue.message}</span>
            </div>
          ))}
          {preflight.issues.length > 25 ? (
            <p className="text-[11px] text-[var(--admin-text-faint)]">
              …and {preflight.issues.length - 25} more.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--admin-text)]">
          Menu richness: {richness.score}/100
        </span>
        <span className="text-[var(--admin-text-faint)]">{richness.itemCount} items in feed</span>
      </div>
      <div className="space-y-1.5">
        {fields.map((f) => {
          const { count, pct } = richness.fields[f];
          return (
            <div key={f} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 shrink-0 text-[var(--admin-text-muted)]">{FIELD_LABEL[f]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                <div
                  className={`h-full rounded-full ${pct >= 80 ? "bg-[var(--admin-accent)]" : pct >= 40 ? "bg-[var(--admin-gold)]" : "bg-[var(--admin-danger)]"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-[var(--admin-text-faint)]">
                {pct}% ({count})
              </span>
            </div>
          );
        })}
      </div>
      {richness.itemCount > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
          Highest-impact fix first:{" "}
          {richness.weakest
            .filter((f) => imageRelevant || f !== "image")
            .slice(0, 2)
            .map((f) => FIELD_LABEL[f])
            .join(", ")}
          . Edit products in Menu Imports, then re-publish.
        </p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connection wizard (connect / stay connected / reconnect)
// ---------------------------------------------------------------------------

export function ConnectionWizard({
  channelLabel,
  connectSteps,
  practices,
  runbook,
  contacts,
  configured,
}: {
  channelLabel: string;
  connectSteps: PlaybookStep[];
  practices: string[];
  runbook: RunbookEntry[];
  contacts: readonly string[];
  configured: boolean;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Connection wizard</h2>
        <Badge tone={configured ? "green" : "orange"}>
          {configured ? "Credentials set" : "Start here"}
        </Badge>
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Everything below is verified against the official {channelLabel} API documentation — no
        guesswork. The integrations assistant (Integrations page) is trained on the same playbook.
      </p>

      <details open={!configured} className="group mb-2 rounded-md border border-[var(--admin-border)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--admin-accent)]">
          1. Get connected — step by step
        </summary>
        <ol className="list-decimal space-y-2 px-3 pb-3 pl-8 text-xs text-[var(--admin-text-muted)]">
          {connectSteps.map((s) => (
            <li key={s.title}>
              <span className="font-semibold text-[var(--admin-text)]">{s.title}.</span> {s.detail}
            </li>
          ))}
        </ol>
      </details>

      <details className="group mb-2 rounded-md border border-[var(--admin-border)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--admin-accent)]">
          2. Stay connected — operating practices
        </summary>
        <ul className="space-y-2 px-3 pb-3 pl-6 text-xs text-[var(--admin-text-muted)]">
          {practices.map((p) => (
            <li key={p} className="list-disc">{p}</li>
          ))}
        </ul>
      </details>

      <details className="group rounded-md border border-[var(--admin-border)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--admin-accent)]">
          3. Get reconnected — if something breaks
        </summary>
        <div className="space-y-2 px-3 pb-3">
          {runbook.map((r) => (
            <div key={r.symptom} className="rounded-md border border-[var(--admin-border)] p-2 text-[11px]">
              <div className="font-semibold text-[var(--admin-text)]">{r.symptom}</div>
              <div className="mt-0.5 text-[var(--admin-text-muted)]">{r.meaning}</div>
              <div className="mt-0.5 text-[var(--admin-accent)]">Fix: {r.fix}</div>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-[var(--admin-text-faint)]">
            {contacts.join(" · ")}
          </p>
        </div>
      </details>
    </Card>
  );
}
