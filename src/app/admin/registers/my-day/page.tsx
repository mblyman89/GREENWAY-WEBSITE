/**
 * /admin/registers/my-day  (D185, round slice S8)
 *
 * "Daily role checklists so each shift knows exactly what it owes." Owner
 * (2026-11-05): "Cash handling, sop, opening and closing tills, daily
 * employee tasks and obligations ... This is the step you are on ... do this,
 * do this, do that, done. Validate us when we are done ... make it loud."
 *
 * Any staff login (orders.manage, the same as Night Watch). Read-only: each
 * step links to the screen where it is done; nothing here blocks anyone.
 * ?shift=opening|during|closing previews another shift's list.
 */
import { requirePermission } from "@/lib/auth/session";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { MyDayPanel } from "@/components/admin/registers/MyDayPanel";
import { myDayNow } from "@/lib/registers/role-checklist-store";
import { SHIFT_LABELS } from "@/lib/registers/role-checklist-core";

export const dynamic = "force-dynamic";

const PREVIEW_HOUR = { opening: 8, during: 14, closing: 21 } as const;

export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ shift?: string }> }) {
  const session = await requirePermission("orders.manage");
  const isOwner = canReadBooks(session.profile.role);
  const sp = await searchParams;
  const preview = sp.shift === "opening" || sp.shift === "during" || sp.shift === "closing" ? sp.shift : null;
  const { day } = await myDayNow(preview ? PREVIEW_HOUR[preview] : undefined);

  return (
    <div>
      <AdminPageHeader
        title="My day"
        subtitle="What each shift owes today, in order. Do the step with the finger; when every line is green, you're done."
        breadcrumbs={<Breadcrumbs items={[{ label: "Register Activity", href: "/admin/registers" }, { label: "My day" }]} />}
        action={
          <Button href="/admin/inventory/checklists" variant="neutral" size="sm">
            Open the checklist sheets
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <nav aria-label="Preview a shift" className="flex flex-wrap gap-2 text-xs" data-testid="my-day-shift-switch">
          <a href="/admin/registers/my-day" className={`rounded-full border px-3 py-1 ${!preview ? "border-[var(--admin-accent)] font-bold" : "border-[var(--admin-border)]"}`}>
            Right now
          </a>
          {(["opening", "during", "closing"] as const).map((s) => (
            <a key={s} href={`/admin/registers/my-day?shift=${s}`} className={`rounded-full border px-3 py-1 ${preview === s ? "border-[var(--admin-accent)] font-bold" : "border-[var(--admin-border)]"}`}>
              {SHIFT_LABELS[s]}
            </a>
          ))}
        </nav>

        <MyDayPanel day={day} isOwner={isOwner} />

        <HelpPanel
          id="my-day"
          title="How My day works"
          steps={[
            "The list builds itself from the live data: the drawers, the deposit bags, the drop status of every open drawer, and the opening, during and closing checklist sheets.",
            "👉 marks the step you are on. 🚨 means urgent: a drop is due (over $2,000 in cash since the last drop), a day has no deposit bag, or yesterday's cash was not finished in the morning.",
            "Opening: close and second-count yesterday's drawers, reconcile them, build the deposit bag (either morning employee) and have a different person recount it blind. Count your float: $167.50 for a sales drawer, $300.00 for the manager till.",
            "Michael's lines (sealing the bag and taking it to the bank) are shown so everyone can see them, but they never hold up anyone else's list.",
            "If something could not be read it shows ❓ and you are not marked done. Do it by hand and look again.",
            "When every line of your shift and the shifts before it is green, the screen says you're done.",
          ]}
        />
      </div>
    </div>
  );
}
