/**
 * /admin/merch-studio/health: Merch Health (D232 slice M-2, SOP-11 B.4).
 *
 * Owner (D232, verbatim): "I want to build all things, serious to not
 * serious. The big to the small." and "Q5: I have these set in vercel
 * already I think, I can't remember." This page answers Q5 and more: it
 * checks H-1..H-19 live on every visit (Printful token, permissions, expiry,
 * store, webhook; the shop's feed, Stripe key, Stripe webhook, checkout,
 * tax, email, card holds, auto-confirm; service status; drafts; stock;
 * storage) and shows the exact fix with the SOP-11 section for each.
 *
 * Owner & admin only (settings.manage). Nothing shown is a secret: the shop
 * reports only whether each variable is set.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { RunMerchHealthButton, TokenExpiryForm } from "@/components/admin/merch-studio/MerchHealthControls";
import { gatherMerchHealth, listMerchHealthRuns, merchShopOrigin, readHealthSettings } from "@/lib/merch/merch-health-server";
import type { MerchCheck, MerchCheckLevel } from "@/lib/merch/merch-health-core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GROUPS: MerchCheck["group"][] = ["Printful", "Shop & Stripe", "Catalog", "Email", "Services"];

function tone(l: MerchCheckLevel | "ok" | "warn" | "fail"): "green" | "gold" | "danger" | "neutral" {
  return l === "ok" ? "green" : l === "warn" ? "gold" : l === "fail" ? "danger" : "neutral";
}
function word(l: MerchCheckLevel): string {
  return l === "ok" ? "Green" : l === "warn" ? "Amber" : l === "fail" ? "Red" : "Unknown";
}
function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
}

export default async function MerchHealthPage() {
  await requirePermission("settings.manage");
  const [report, runs, settings] = await Promise.all([gatherMerchHealth(), listMerchHealthRuns(20), readHealthSettings()]);
  const shop = merchShopOrigin();
  const tokenSet = (process.env.MERCH_HEALTH_TOKEN ?? "").length >= 32;

  return (
    <div>
      <AdminPageHeader
        title="Merch Health"
        subtitle="Can greenwaymerch.com take, charge, make and ship an order right now? Checked live every time this page opens, and every morning."
        breadcrumbs={<Breadcrumbs items={[{ label: "MKTG & ADV" }, { label: "Merch Studio", href: "/admin/merch-studio" }, { label: "Merch Health" }]} />}
        action={<RunMerchHealthButton />}
        helpId="merch-studio"
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={tone(report.status)}>{report.status === "ok" ? "All green" : report.status === "warn" ? "Needs a look" : "Action needed"}</Badge>
            <p className="text-sm">{report.summary}</p>
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            Checked {when(report.at)}. Shop: {shop}. Every morning with the platform health check (about 6:25am Pacific in winter, 7:25am in summer) the same check runs and staff get an email only when a red check appears or clears, plus a Monday summary.
          </p>
        </Card>

        {!tokenSet ? (
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">One-time setup: let this page ask the shop</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>Make a random value of at least 32 characters (a password manager can generate one).</li>
              <li>Vercel → the main Greenway project → Settings → Environment Variables → add <code>MERCH_HEALTH_TOKEN</code> with that value.</li>
              <li>Vercel → the merch (greenwaymerch.com) project → add <code>MERCH_HEALTH_TOKEN</code> with the SAME value.</li>
              <li>Redeploy both projects, then press Run check now. The shop checks (H-7 to H-15, H-19) change from Unknown to real answers.</li>
            </ol>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">SOP-11 §4.3. The shop answers 404 to anyone without the token, and it only reports whether each setting is present, never its value.</p>
          </Card>
        ) : null}

        {GROUPS.map((g) => {
          const list = report.checks.filter((c) => c.group === g);
          if (list.length === 0) return null;
          return (
            <Card key={g}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">{g}</h2>
              <ul className="mt-3 space-y-2">
                {list.map((c) => (
                  <li key={c.id} className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(c.level)}>{word(c.level)}</Badge>
                      <span className="font-semibold">
                        {c.id} {c.title}
                      </span>
                    </div>
                    <p className="mt-1">{c.detail}</p>
                    {c.fix ? (
                      <p className="mt-1">
                        <strong>Fix:</strong> {c.fix} <span className="text-[var(--admin-text-muted)]">(SOP-11 {c.sop})</span>
                      </p>
                    ) : null}
                    {c.id === "H-3" ? (
                      <div className="mt-2">
                        <TokenExpiryForm current={settings.printfulTokenExpires} />
                        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Find it at developers.printful.com → Your tokens (the Expires column).</p>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}

        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Recent runs</h2>
          {runs.error ? <p className="mt-2 text-sm">{runs.error}</p> : null}
          {runs.rows.length === 0 && !runs.error ? <p className="mt-2 text-sm">No saved runs yet. Press Run check now or wait for the morning check.</p> : null}
          <ul className="mt-2 space-y-1 text-sm">
            {runs.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(r.status)}>{r.status === "ok" ? "Green" : r.status === "warn" ? "Amber" : "Red"}</Badge>
                <span className="text-[var(--admin-text-muted)]">
                  {when(r.created_at)} · {r.source === "cron" ? "morning check" : "run by hand"}
                </span>
                <span>{r.summary}</span>
              </li>
            ))}
          </ul>
        </Card>

        <p className="text-xs text-[var(--admin-text-muted)]">
          The step-by-step guide is SOP-11 (docs/sop). <Link href="/admin/merch-studio" className="text-[var(--admin-accent)] hover:underline">Back to Merch Studio</Link>
        </p>
      </div>
    </div>
  );
}
