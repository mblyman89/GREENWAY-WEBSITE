/**
 * The factory reset screen.
 *
 * D-64: this page used to describe the reset with two hand-typed lists of
 * category names, and its button ran the superseded `reset_operational_data()`
 * function. Both were wrong in the same way — a hand-maintained description of
 * a thing drifts from the thing. The lists said the reset kept "Employees,
 * staff profiles, registers, equipment, passkeys" and cleared "Orders, order
 * lines..." with no mention of the general ledger at all, which was accurate
 * for the OLD function and badly misleading for the new one.
 *
 * So the counts and the reasons below are not typed here. They are computed
 * from `factory-reset-core.ts`, the same decision layer migration 0209 is
 * tested against, which means this screen cannot describe a reset different
 * from the one the button runs.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import {
  RESET_BLIND_SPOTS,
  RESET_CONFIRM_PHRASE,
  RETENTION_CITE,
  RETENTION_YEARS,
  buildResetPlan,
  describeResetPlan,
} from "@/lib/accounting/factory-reset-core";
import { listSchemaTables } from "@/lib/admin/schema-tables";
import { previewFactoryReset } from "@/lib/admin/reset-service";
import { resetOperationalDataAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ResetDataSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const params = await searchParams;

  const plan = buildResetPlan(listSchemaTables());
  const briefing = describeResetPlan(plan);

  // The evidence probe is read-only and owner-gated. If it cannot run (not the
  // owner, or 0209 not applied yet) the screen still renders — it just cannot
  // show the counts, and says so rather than pretending they are zero.
  let preview: Awaited<ReturnType<typeof previewFactoryReset>> | null = null;
  let previewError: string | null = null;
  try {
    preview = await previewFactoryReset();
  } catch (err) {
    previewError = err instanceof Error ? err.message : "Could not read the database.";
  }

  const wipe = plan.ok ? plan.wipe : [];
  const keep = plan.ok ? plan.keep : [];

  return (
    <div>
      <AdminPageHeader
        title="Factory reset"
        subtitle="Wipe every trace of the rehearsal — including the books — and keep everything that describes your business."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Factory reset" }]} />
        }
        help={
          <HelpPanel
            id="factory-reset"
            title="About the factory reset"
            steps={[
              "Use this once, to clear the rehearsal before you go live on Cultivera's data.",
              "It empties everything that RECORDS an event — sales, inventory, deliveries, payroll, bank and ATM activity, and every journal entry on the books.",
              "It keeps everything that DESCRIBES your business — chart of accounts, entities, settings, integration keys, the knowledge base, your catalogue, your people, your logins, and the audit log.",
              `You must type the exact phrase ${RESET_CONFIRM_PHRASE}. Only the owner can run it, and it is recorded in the activity log.`,
            ]}
          >
            <p>This cannot be undone. A check runs automatically afterwards to prove the books came out empty.</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {params.done ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {decodeURIComponent(params.done)}
          </div>
        ) : null}
        {params.error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}

        {!plan.ok ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <p className="font-semibold">{briefing.headline}</p>
            {briefing.paragraphs.map((p) => (
              <p key={p} className="mt-1">
                {p}
              </p>
            ))}
          </div>
        ) : null}

        {/* What the database looks like right now */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold text-white">Before you press it</h2>
          {previewError ? (
            <p className="mt-2 text-sm text-amber-200/90">{previewError}</p>
          ) : preview ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Completed sales", value: preview.completedOrders },
                  { label: "CCRS files", value: preview.ccrsBatches },
                  { label: "Excise returns filed", value: preview.exciseReturnsFiled },
                  { label: "Posted journal entries", value: preview.postedJournals },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                    <div className="text-xs text-white/50">{s.label}</div>
                    <div className="text-lg font-semibold text-white">{s.value}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-white/60">
                {preview.looksLikeRealTrade ? (
                  <>
                    This database contains what looks like <strong className="text-amber-200">real trade</strong>.{" "}
                    {RETENTION_CITE} requires those records for a {RETENTION_YEARS}-year period, so the reset will
                    refuse unless you export everything first and tick the attestation below.
                  </>
                ) : (
                  <>
                    Nothing here looks like real trade, so this is still a rehearsal and the reset is safe to run.
                  </>
                )}
              </p>
            </>
          ) : null}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Emptied */}
          <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
            <h2 className="text-sm font-semibold text-red-200">
              This will EMPTY {wipe.length} table{wipe.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Everything that records something that happened. When it finishes your trial balance is blank and every
              report reads zero.
            </p>
            <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
              {wipe.map((c) => (
                <li key={c.table} className="text-xs text-white/70">
                  <code className="text-red-300/90">{c.table}</code>
                </li>
              ))}
            </ul>
          </section>

          {/* Kept */}
          <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h2 className="text-sm font-semibold text-emerald-200">
              This will KEEP {keep.length} table{keep.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Everything that describes your business rather than recording an event.
            </p>
            <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
              {keep.map((c) => (
                <li key={c.table} className="text-xs text-white/70">
                  <code className="text-emerald-300/90">{c.table}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* The limits, stated up front */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold text-white">What this cannot reach</h2>
          <dl className="mt-3 space-y-3">
            {RESET_BLIND_SPOTS.map((b) => (
              <div key={b.id}>
                <dt className="text-xs font-bold uppercase tracking-wide text-white/50">{b.id.replace(/_/g, " ")}</dt>
                <dd className="mt-0.5 text-sm text-white/70">{b.limit}</dd>
                <dd className="mt-0.5 text-sm text-white/50">{b.action}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Confirm + run */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold text-white">Confirm reset</h2>
          <p className="mt-1 text-sm text-white/60">
            This cannot be undone. Washington requires licensees to keep sales, inventory, transport and destruction
            records for <strong className="text-white/80">{RETENTION_YEARS} years</strong> ({RETENTION_CITE}). If any
            real trade exists, the reset refuses unless you attest that everything has been exported first.
          </p>
          <form action={resetOperationalDataAction} className="mt-4 space-y-4">
            <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <input
                type="checkbox"
                name="retention_attestation"
                value="1"
                className="mt-0.5 h-4 w-4 accent-amber-500"
              />
              <span className="text-sm text-amber-100/90">
                I attest that all records required by <strong>{RETENTION_CITE}</strong> (sales, inventory, manifests,
                destruction — {RETENTION_YEARS}-year retention) have been{" "}
                <strong>exported and stored outside this system</strong> before this reset.
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[16rem]">
                <span className="mb-1 block text-xs font-medium text-white/60">
                  Type exactly:{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 text-red-300">{RESET_CONFIRM_PHRASE}</code>
                </span>
                <input
                  name="confirm"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={RESET_CONFIRM_PHRASE}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-red-400"
                />
              </label>
              <Button type="submit" variant="danger">
                Erase all test data
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
