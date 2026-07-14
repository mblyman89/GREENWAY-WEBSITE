/**
 * /admin/registers/exceptions — POS exception queue manager (Slice B12).
 *
 * Every register event the sync ingest could NOT process safely lands here
 * with a staff-actionable reason (nothing is ever silently dropped — the
 * B4 ledger discipline). A manager reads the reason, inspects the full
 * payload, fixes the underlying problem (intake the card, apply the
 * migration, correct the price…), and resolves with a written note. The
 * row stays forever: reason + payload + who resolved it + the note.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  listPosExceptions,
  listResolvedPosExceptions,
  type PosExceptionRow,
} from "@/lib/pos/sync-store";
import { listRegisters } from "@/lib/registers/store";
import { listEmployees } from "@/lib/staffing/store";
import { pacificParts } from "@/lib/reports/timezone";
import { resolvePosExceptionAction } from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers/exceptions";

function pacificStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = pacificParts(d);
  const mm = String(p.minute).padStart(2, "0");
  const ampm = p.hour >= 12 ? "PM" : "AM";
  let h = p.hour % 12;
  if (h === 0) h = 12;
  return `${p.month}/${p.day}/${p.year} ${h}:${mm} ${ampm} PT`;
}

function eventBadge(eventType: string) {
  const tone =
    eventType === "sale" ? "gold" : eventType === "medical_card_capture" ? "green" : "neutral";
  return <Badge tone={tone as "gold" | "green" | "neutral"}>{eventType.replace(/_/g, " ")}</Badge>;
}

export default async function PosExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resolved?: string }>;
}) {
  await requirePermission("staffing.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Register exceptions" subtitle="Events the sync could not process." />
        <EmptyState
          title="Supabase not configured"
          description="Connect the service role key to review register exceptions."
        />
      </div>
    );
  }

  const [open, resolved, registers, employees] = await Promise.all([
    listPosExceptions(200),
    listResolvedPosExceptions(25),
    listRegisters({ includeInactive: true }),
    listEmployees({ includeInactive: true }),
  ]);
  const registerName = new Map(registers.map((r) => [r.id, r.name]));
  const employeeName = new Map(employees.map((e) => [e.id, e.full_name]));

  const who = (row: PosExceptionRow) =>
    `${registerName.get(row.register_id) ?? row.register_id.slice(0, 8)} · ${
      employeeName.get(row.employee_id) ?? row.employee_id.slice(0, 8)
    }`;

  return (
    <div>
      <AdminPageHeader
        title="Register exceptions"
        subtitle="Register events the sync could not process — nothing is ever silently dropped."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Register Activity", href: "/admin/registers" }, { label: "Exceptions" }]}
          />
        }
        action={
          <Button href="/admin/registers" variant="neutral" size="sm">
            Back to Register Activity
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-exceptions"
          title="How the exception queue works"
          steps={[
            "Every reason is staff-actionable: it tells you exactly what to fix (intake a card, apply a migration, correct a price).",
            "Open the payload to see exactly what the register sent — lines, totals, tender, card facts.",
            "Fix the underlying problem FIRST, then resolve with a note. Resolving never replays the event — re-ring at the register if the sale still needs to happen.",
            "Resolved rows keep the reason, payload, resolver, and note forever — that is your paper trail.",
          ]}
        />

        {sp.error ? (
          <Card>
            <p className="text-sm text-red-300">{sp.error}</p>
          </Card>
        ) : null}
        {sp.resolved ? (
          <Card>
            <p className="text-sm text-emerald-300">Exception resolved and recorded.</p>
          </Card>
        ) : null}

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Open exceptions</h2>
            <Badge tone={open.length > 0 ? "danger" : "green"}>{open.length} open</Badge>
          </div>

          {open.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-dim)]">
              Nothing needs attention — every synced register event processed cleanly.
            </p>
          ) : (
            <ul className="space-y-4">
              {open.map((row) => (
                <li
                  key={row.id}
                  className="rounded-[var(--admin-radius-lg)] border border-red-500/25 bg-red-950/10 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {eventBadge(row.event_type)}
                    <span className="text-xs text-[var(--admin-text-dim)]">
                      {pacificStamp(row.occurred_at)} · {who(row)}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--admin-text-dim)]">
                      {row.client_uuid}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-red-200">{row.exception_reason ?? "No reason recorded."}</p>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-dim)]">
                      Inspect payload
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {JSON.stringify(row.payload ?? {}, null, 2)}
                    </pre>
                  </details>

                  <form action={resolvePosExceptionAction} className="mt-3 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="exception_id" value={row.id} />
                    <label className="min-w-64 flex-1">
                      <span className="mb-1 block text-xs font-semibold text-[var(--admin-text-dim)]">
                        Resolution note (what you did, at least 5 characters)
                      </span>
                      <input
                        name="note"
                        required
                        minLength={5}
                        placeholder="e.g. Intook UPID WA-1234 in Medical, customer re-rang at Register 1"
                        className="w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <Button type="submit" size="sm">
                      Resolve
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-white">Recently resolved</h2>
          {resolved.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-dim)]">No resolutions recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {resolved.map((row) => (
                <li
                  key={row.id}
                  className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {eventBadge(row.event_type)}
                    <span className="text-xs text-[var(--admin-text-dim)]">
                      {pacificStamp(row.occurred_at)} · {who(row)}
                    </span>
                    {row.resolved_at ? (
                      <span className="text-xs text-emerald-300">
                        resolved {pacificStamp(row.resolved_at)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--admin-text-dim)]">
                    {row.exception_reason ?? "No reason recorded."}
                  </p>
                  {row.resolution_note ? (
                    <p className="mt-1 text-sm text-neutral-200">“{row.resolution_note}”</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-dim)]">
                      Inspect payload
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {JSON.stringify(row.payload ?? {}, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-[var(--admin-text-dim)]">
          Queue trims to the oldest 200 open rows. Base path: <span className="font-mono">{BASE}</span>
        </p>
      </div>
    </div>
  );
}
