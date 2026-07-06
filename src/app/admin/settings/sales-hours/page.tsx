import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input } from "@/components/admin/ui/Field";
import {
  minutesToHm,
  minutesToLabel,
  STATUTORY_CLOSE_MINUTES,
  STATUTORY_OPEN_MINUTES,
} from "@/lib/compliance/sales-hours-core";
import { getSalesHoursWindow } from "@/lib/compliance/sales-hours-store";
import { saveSalesHoursAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings → Sales hours (S-12). The window the completion gate enforces —
 * WAC 314-55-147 bounds it to 8:00 AM–midnight (store time); the owner may
 * tighten it to actual store hours so late-night mistakes are caught too.
 */
export default async function SalesHoursSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const [window, sp] = await Promise.all([getSalesHoursWindow(), searchParams]);

  const isStatutory =
    window.openMinutes === STATUTORY_OPEN_MINUTES &&
    window.closeMinutes === STATUTORY_CLOSE_MINUTES;

  return (
    <div>
      <AdminPageHeader
        title="Sales hours"
        subtitle="When sales may be completed — enforced as a hard gate on every order completion."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Sales hours" }]} />
        }
        help={
          <HelpPanel
            id="sales-hours-settings"
            title="How the sales-hours gate works"
            steps={[
              "WAC 314-55-147 prohibits cannabis sales between midnight and 8:00 AM.",
              "The register refuses to complete an order outside this window — store (Pacific) time.",
              "You can tighten the window to your actual store hours, but never widen it past the law.",
              "Times are 24-hour HH:MM; use 24:00 for midnight.",
            ]}
          >
            <p>
              The gate runs on the store&apos;s wall clock (America/Los_Angeles), so it stays correct
              across daylight-saving changes no matter where the server runs.
            </p>
          </HelpPanel>
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {sp.saved ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">
            Sales hours saved.
          </div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">
            {sp.error}
          </div>
        ) : null}

        <div className="max-w-2xl rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <p className="mb-4 text-sm text-[var(--admin-text-muted)]">
            Current window:{" "}
            <span className="font-semibold text-[var(--admin-text)]">
              {minutesToLabel(window.openMinutes)}–{minutesToLabel(window.closeMinutes)}
            </span>{" "}
            store time{isStatutory ? " (the statutory maximum)" : ""}. Orders cannot be completed
            outside it.
          </p>
          <form action={saveSalesHoursAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Sales start (HH:MM, 24-hour)" help="No earlier than 08:00 (WAC 314-55-147).">
              <Input
                name="open_time"
                defaultValue={minutesToHm(window.openMinutes)}
                pattern="\d{1,2}:\d{2}"
                placeholder="08:00"
                required
              />
            </Field>
            <Field label="Sales stop (HH:MM, 24-hour)" help="No later than 24:00 (midnight).">
              <Input
                name="close_time"
                defaultValue={minutesToHm(window.closeMinutes)}
                pattern="\d{1,2}:\d{2}"
                placeholder="24:00"
                required
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Save sales hours</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
