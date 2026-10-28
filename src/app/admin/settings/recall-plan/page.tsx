import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { Field, Input, Textarea } from "@/components/admin/ui/Field";
import { EMPTY_RECALL_PLAN, planReviewDue } from "@/lib/inventory/recall-event-core";
import { getRecallPlan } from "@/lib/inventory/recall-event-store";
import { saveRecallPlanAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings → Recall plan (Fix Phase 1.6c · G-25 req 1; F-05a-15). The app's
 * copy of form 8.4: WAC 314-55-225(3)(d)(i) (A) coordinator, (B) identify and
 * isolate, (C) retrieve and destroy, (D) communications; plus the approval and
 * the annual review (SOP-05a §4.13).
 */
export default async function RecallPlanPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  await requirePermission("settings.manage");
  const [saved, sp] = await Promise.all([getRecallPlan(), searchParams]);
  const plan = saved ?? EMPTY_RECALL_PLAN;
  const due = planReviewDue(plan);
  const card = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";

  return (
    <div>
      <AdminPageHeader
        title="Recall plan"
        subtitle="The written recall plan WAC 314-55-225(3)(d) requires. Review every year."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Recall plan" }]} />}
        help={
          <HelpPanel
            id="recall-plan"
            title="What the plan must hold"
            steps={[
              "(A) The recall coordinator: the admin. There is no back-up; the recall team is the owner and the manager (D37).",
              "(B) How affected product is identified and isolated.",
              "(C) How product is retrieved and destroyed. Recalled product goes back to the vendor (D65).",
              "(D) The communications plan: who tells the LCB, the vendor, customers and staff. Public / press: owner only.",
              "Review it every year and whenever the coordinator, the LCB officer or SOP-05a changes. Print it for the binder with the staff signatures (form 8.4).",
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {sp.saved ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">Recall plan saved.</div>
        ) : null}
        {sp.error ? (
          <div className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</div>
        ) : null}
        <p className="mb-4 text-sm text-[var(--admin-text-muted)]">
          {saved ? (due ? `Next annual review due ${due}.` : "Not yet approved: enter the approval date.") : "No plan saved yet. The four sections start with the wording of form 8.4."}
        </p>
        <form action={saveRecallPlanAction} className="max-w-3xl space-y-5">
          <section className={card}>
            <h2 className="mb-3 text-base font-semibold">(A) Recall coordinator and contacts</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Coordinator (the admin, D37)" required>
                <Input name="coordinatorName" defaultValue={plan.coordinatorName} required />
              </Field>
              <Field label="Coordinator phone">
                <Input name="coordinatorPhone" defaultValue={plan.coordinatorPhone} />
              </Field>
              <Field label="Owner">
                <Input name="ownerName" defaultValue={plan.ownerName} />
              </Field>
              <Field label="Owner phone">
                <Input name="ownerPhone" defaultValue={plan.ownerPhone} />
              </Field>
              <Field label="Local LCB enforcement officer" required>
                <Input name="officerName" defaultValue={plan.officerName} required />
              </Field>
              <Field label="Officer phone">
                <Input name="officerPhone" defaultValue={plan.officerPhone} />
              </Field>
              <Field label="Officer email" className="sm:col-span-2">
                <Input name="officerEmail" type="email" defaultValue={plan.officerEmail} />
              </Field>
            </div>
          </section>
          <section className={card}>
            <h2 className="mb-3 text-base font-semibold">(B) Identify and isolate</h2>
            <Textarea name="identifyIsolate" rows={6} defaultValue={plan.identifyIsolate} />
          </section>
          <section className={card}>
            <h2 className="mb-3 text-base font-semibold">(C) Retrieve and destroy</h2>
            <Textarea name="retrieveDestroy" rows={6} defaultValue={plan.retrieveDestroy} />
          </section>
          <section className={card}>
            <h2 className="mb-3 text-base font-semibold">(D) Communications</h2>
            <Textarea name="communications" rows={8} defaultValue={plan.communications} />
          </section>
          <section className={card}>
            <h2 className="mb-3 text-base font-semibold">Approval and annual review</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Approved by (owner)">
                <Input name="approvedBy" defaultValue={plan.approvedBy} />
              </Field>
              <Field label="Approved on">
                <Input name="approvedOn" type="date" defaultValue={plan.approvedOn} />
              </Field>
              <Field label="Last reviewed by">
                <Input name="lastReviewedBy" defaultValue={plan.lastReviewedBy} />
              </Field>
              <Field label="Last reviewed on" help="The next review is due one year after this date (or the approval date).">
                <Input name="lastReviewedOn" type="date" defaultValue={plan.lastReviewedOn} />
              </Field>
            </div>
          </section>
          <Button type="submit" variant="save">
            Save recall plan
          </Button>
        </form>
      </div>
    </div>
  );
}
