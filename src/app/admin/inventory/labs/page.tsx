/**
 * /admin/inventory/labs  (R36 #4)
 *
 * Owner: "add a button at the top of the inventory page that opens a simple
 * page listing the labs, and the ability to add one if needed."
 *
 * Lists every Washington cannabis testing lab (copied from the WSLCB lab
 * lists - the current 2026-08-04 list and the 2021-08-02 historical list),
 * the Cultivera platform row, and any lab the owner added. Each row shows the
 * hosts its certificates are read from: the COA reader only fetches
 * certificate links from these hosts (the SSRF allow-list), so when a vendor
 * sends a link from a new host, add the host to that lab here.
 * Server-rendered, no client JavaScript.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  BUILT_IN_COA_HOSTS,
  MAX_HOSTS_PER_LAB,
  READABLE_LAYOUTS,
  isBuiltInHost,
  type LabStatus,
} from "@/lib/inventory/testing-labs-core";
import { listTestingLabs, type LabRow } from "@/lib/inventory/testing-labs-store";
import { addHostAction, addLabAction, removeHostAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

const STATUS_ORDER: readonly LabStatus[] = ["active", "owner_added", "platform", "historical"];

const STATUS_HEADINGS: Record<LabStatus, { title: string; blurb: string }> = {
  active: { title: "Certified now", blurb: "On the WSLCB lab list dated 2026-08-04." },
  owner_added: { title: "Added by you", blurb: "Labs added on this page." },
  platform: { title: "Platforms (not labs)", blurb: "Vendor software that re-hosts the lab's own certificate PDF." },
  historical: {
    title: "No longer on the list",
    blurb: "On the WSLCB 2021-08-02 list but not the 2026 list. Kept so older certificates are still recognised.",
  },
};

const STATUS_TONE: Record<LabStatus, "green" | "gold" | "outline" | "neutral"> = {
  active: "green",
  owner_added: "gold",
  platform: "outline",
  historical: "neutral",
};

const inputCls =
  "admin-focus w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2.5 py-1.5 text-sm text-[var(--admin-text)]";

function LabTable({ labs, focusId }: { labs: LabRow[]; focusId: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[0.7rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
          <tr>
            <th className="px-2 py-2">Lab #</th>
            <th className="px-2 py-2">Name</th>
            <th className="px-2 py-2">Contact</th>
            <th className="px-2 py-2">Certification</th>
            <th className="px-2 py-2">Certificate hosts</th>
            <th className="px-2 py-2">Reader knows its layout</th>
          </tr>
        </thead>
        <tbody>
          {labs.map((l) => (
            <tr
              key={l.id}
              id={`lab-${l.id}`}
              data-testid="testing-lab-row"
              className={`border-t border-[var(--admin-border)] align-top ${focusId === l.id ? "bg-[var(--admin-surface-2)]" : ""}`}
            >
              <td className="px-2 py-2 font-semibold">{l.lab_number ?? "-"}</td>
              <td className="px-2 py-2">
                <div className="font-semibold text-[var(--admin-text)]">{l.name}</div>
                <div className="mt-0.5">
                  <Badge tone={STATUS_TONE[l.status]}>{STATUS_HEADINGS[l.status].title}</Badge>
                </div>
                {l.notes ? <div className="mt-1 text-xs text-[var(--admin-text-muted)]">{l.notes}</div> : null}
              </td>
              <td className="px-2 py-2 text-xs text-[var(--admin-text-muted)]">
                {l.address ? <div>{l.address}</div> : null}
                {l.city || l.zip ? <div>{[l.city, l.zip].filter(Boolean).join(" ")}</div> : null}
                {l.phone ? <div>{l.phone}</div> : null}
                {l.website ? (
                  <a className="text-[var(--admin-orange)] underline" href={l.website} target="_blank" rel="noreferrer">
                    {l.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ) : null}
              </td>
              <td className="px-2 py-2 text-xs text-[var(--admin-text-muted)]">
                {l.cert_start ? <div>First: {l.cert_start}</div> : null}
                {l.cert_current ? <div>Current: {l.cert_current}</div> : null}
                {l.cert_valid_through ? <div>Valid through: {l.cert_valid_through}</div> : null}
                {l.source ? <div className="mt-1 italic">{l.source}</div> : null}
              </td>
              <td className="px-2 py-2">
                <div className="flex flex-wrap gap-1">
                  {l.coa_hosts.length === 0 ? <span className="text-xs text-[var(--admin-text-muted)]">None yet</span> : null}
                  {l.coa_hosts.map((h) => (
                    <span key={h} className="inline-flex items-center gap-1">
                      <Badge tone={isBuiltInHost(h) ? "green" : "gold"}>{h}</Badge>
                      {isBuiltInHost(h) ? null : (
                        <form action={removeHostAction}>
                          <input type="hidden" name="lab_id" value={l.id} />
                          <input type="hidden" name="updated_at" value={l.updated_at} />
                          <input type="hidden" name="host" value={h} />
                          <button
                            type="submit"
                            className="admin-focus rounded-full px-1.5 text-xs font-bold text-[var(--admin-danger)] hover:underline"
                            aria-label={`Remove ${h} from ${l.name}`}
                            data-testid="lab-remove-host"
                          >
                            Remove
                          </button>
                        </form>
                      )}
                    </span>
                  ))}
                </div>
                {l.coa_hosts.length < MAX_HOSTS_PER_LAB ? (
                  <form action={addHostAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="lab_id" value={l.id} />
                    <input type="hidden" name="updated_at" value={l.updated_at} />
                    <input
                      name="host"
                      required
                      maxLength={2000}
                      placeholder="host or a certificate link"
                      aria-label={`Add a certificate host to ${l.name}`}
                      className={inputCls}
                    />
                    <Button type="submit" variant="neutral" size="sm" data-testid="lab-add-host">
                      Add
                    </Button>
                  </form>
                ) : null}
              </td>
              <td className="px-2 py-2 text-xs text-[var(--admin-text-muted)]">
                {l.lab_number !== null && READABLE_LAYOUTS[l.lab_number] ? READABLE_LAYOUTS[l.lab_number] : "Not yet - numbers are typed in by hand"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TestingLabsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="p-8 text-sm text-[var(--admin-text-muted)]">
        Supabase is not configured in this environment, so the testing-labs list is unavailable.
      </div>
    );
  }

  const read = await listTestingLabs();
  const labs = read.ok ? read.labs : [];
  const focusId = sp.lab ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Testing labs"
        subtitle="Every Washington cannabis testing lab, and the web hosts their certificates (COAs) are read from. The certificate reader only opens links from these hosts."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Testing labs" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="#add-lab" variant="primary" size="sm" data-testid="labs-jump-add">
              Add a lab
            </Button>
            <Button href="/admin/inventory" variant="neutral" size="sm">
              Back to inventory
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {!read.ok ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-text)]">{read.migrated ? "Could not load the labs" : "One-time setup needed"}</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{read.error}</p>
          </Card>
        ) : null}
        {sp.error ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-danger)]">Nothing was changed</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]" data-testid="labs-error">
              {sp.error}
            </p>
          </Card>
        ) : null}
        {sp.added ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]">Added {sp.added}. Add the host its certificate links come from so the reader will open them.</p>
          </Card>
        ) : null}
        {sp.hostAdded ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]">
              {sp.hostAdded} added. Certificate links from it are read on the next COA pass (press Read COA again on the delivery).
            </p>
          </Card>
        ) : null}
        {sp.hostRemoved ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]">{sp.hostRemoved} removed. Links from it are no longer opened.</p>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm font-semibold text-[var(--admin-text)]">Always-allowed certificate hosts</p>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            Built in and verified by reading real certificates; they work even before the database list is set up. Owner-added hosts must be a
            public https web host (no IP addresses, no internal names); every address they resolve to is checked before a certificate is
            downloaded, and redirects are re-checked at every hop.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {BUILT_IN_COA_HOSTS.map((h) => (
              <li key={h.host} data-testid="built-in-host">
                <Badge tone="green">{h.host}</Badge> <span className="text-[var(--admin-text)]">{h.label}</span>{" "}
                <span className="text-xs text-[var(--admin-text-muted)]">- {h.evidence}</span>
              </li>
            ))}
          </ul>
        </Card>

        {read.ok
          ? STATUS_ORDER.map((status) => {
              const group = labs.filter((l) => l.status === status);
              if (group.length === 0) return null;
              return (
                <Card key={status}>
                  <p className="text-sm font-semibold text-[var(--admin-text)]">
                    {STATUS_HEADINGS[status].title} <span className="text-[var(--admin-text-muted)]">({group.length})</span>
                  </p>
                  <p className="mb-2 text-xs text-[var(--admin-text-muted)]">{STATUS_HEADINGS[status].blurb}</p>
                  <LabTable labs={group} focusId={focusId} />
                </Card>
              );
            })
          : null}

        <Card>
          <div id="add-lab" data-testid="add-lab-form">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Add a lab</p>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              For a lab that is not listed (for example one newly certified by the WSLCB / WSDA). After adding it, add the host its certificate
              links come from in the lab&apos;s row.
            </p>
            <form action={addLabAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--admin-text-muted)]">
                Name (required)
                <input name="name" required minLength={2} maxLength={200} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--admin-text-muted)]">
                WSLCB / WSDA lab # (optional)
                <input name="lab_number" inputMode="numeric" pattern="#?[0-9]{1,4}" maxLength={5} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--admin-text-muted)]">
                City
                <input name="city" maxLength={100} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--admin-text-muted)]">
                Phone
                <input name="phone" maxLength={40} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--admin-text-muted)]">
                Website
                <input name="website" maxLength={300} placeholder="example.com" className={inputCls} />
              </label>
              <label className="text-xs text-[var(--admin-text-muted)]">
                Notes
                <input name="notes" maxLength={1000} className={inputCls} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" variant="save" size="sm" data-testid="add-lab-submit">
                  Add lab
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
