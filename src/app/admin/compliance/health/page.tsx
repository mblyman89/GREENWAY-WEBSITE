import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Card, Badge, type BadgeTone } from "@/components/admin/ui";
import { getComplianceHealth } from "@/lib/compliance/compliance-health";
import type { HealthLevel } from "@/lib/compliance/compliance-health-core";

export const dynamic = "force-dynamic";

/** Map a health level to a Badge tone. */
function levelTone(level: HealthLevel): BadgeTone {
  switch (level) {
    case "critical":
      return "danger";
    case "warning":
      return "orange";
    case "ok":
      return "green";
    default:
      return "outline";
  }
}

/** Map a health level to an optional Card accent stripe. */
function levelAccent(level: HealthLevel): "green" | "gold" | "orange" | undefined {
  switch (level) {
    case "critical":
      return "orange"; // strongest accent available; danger carried by badge + copy
    case "warning":
      return "gold";
    case "ok":
      return "green";
    default:
      return undefined;
  }
}

function levelLabel(level: HealthLevel): string {
  switch (level) {
    case "critical":
      return "Action required";
    case "warning":
      return "Attention";
    case "ok":
      return "OK";
    default:
      return "Unknown";
  }
}

export default async function ComplianceHealthPage() {
  await requirePermission("reports.view");

  const todayIso = new Date().toISOString().slice(0, 10);
  const report = await getComplianceHealth(todayIso);

  const overallTone = levelTone(report.overall);
  const overallHeadline =
    report.overall === "ok"
      ? "You're compliant right now — no open issues."
      : report.overall === "warning"
        ? "A few things need your attention."
        : report.overall === "critical"
          ? "One or more compliance risks need action now."
          : "Some checks could not be evaluated.";

  return (
    <div>
      <AdminPageHeader
        title="Compliance health"
        subtitle="One-glance 'am I safe?' — every compliance gate, checked live"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Compliance health" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Overall verdict banner */}
        <Card accent={levelAccent(report.overall)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={overallTone}>{levelLabel(report.overall)}</Badge>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  Evaluated {todayIso}
                </span>
              </div>
              <p className="mt-2 text-lg font-semibold text-[var(--admin-text)]">{overallHeadline}</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-right">
                <div className="text-2xl font-bold text-[var(--admin-danger)]">{report.criticalCount}</div>
                <div className="text-xs text-[var(--admin-text-muted)]">critical</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-[var(--admin-orange)]">{report.warningCount}</div>
                <div className="text-xs text-[var(--admin-text-muted)]">warnings</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Per-check cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {report.checks.map((check) => (
            <Card key={check.key} accent={levelAccent(check.level)}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--admin-text)]">{check.title}</h3>
                <Badge tone={levelTone(check.level)}>{levelLabel(check.level)}</Badge>
              </div>
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">{check.summary}</p>
              {check.details && check.details.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-[var(--admin-text-muted)]">
                  {check.details.map((d, i) => (
                    <li key={i}>• {d}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>

        <HelpPanel id="compliance-health" title="How to read this screen">
          <p>
            This panel runs every compliance gate in the back office and rolls the results up into one
            &ldquo;am I safe?&rdquo; answer. It is read-only — nothing here changes your data. Each card reflects a live
            check:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>CCRS upload cadence</strong> — CCRS inventory files are a <em>weekly</em> upload obligation (LCB
              CCRS Upload User Guide; WAC 314-55-083(4)). This flags when your last generated export is older than a
              week. The export screen itself hard-blocks any malformed file before you can download it.
            </li>
            <li>
              <strong>Monthly report deadline (LIQ-1295)</strong> — the Retailer Sales &amp; Tax report and excise
              payment are due the <em>20th of the following month</em> (RCW 69.50.535; WAC 314-55-089). Overdue shows
              red; due-soon shows amber. &ldquo;Export on record&rdquo; is informational, not proof of an LCB filing.
            </li>
            <li>
              <strong>Inventory can-go-live gate</strong> — lots held in quarantine because they are missing a CCRS id,
              missing a COA, or carry a failed lab result (WAC 314-55-102; WAC 246-70-050).
            </li>
            <li>
              <strong>Medical recognition cards</strong> — active cards that are expired (must not grant a tax
              exemption) or expiring soon.
            </li>
            <li>
              <strong>Medical exempt-sale records</strong> — excise-exempt sales missing a required WAC 314-55-090(2)
              field.
            </li>
            <li>
              <strong>Sales-limit enforcement</strong> — whether single-transaction limits (WAC 314-55-095) are
              enforced, and whether any over-limit overrides were logged recently.
            </li>
          </ul>
          <p className="mt-2">
            A grey <strong>Unknown</strong> badge means a subsystem could not be read (for example, a table not yet
            migrated) — it is shown honestly rather than as a false all-clear.
          </p>
        </HelpPanel>
      </div>
    </div>
  );
}
