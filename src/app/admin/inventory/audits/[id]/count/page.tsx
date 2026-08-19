/**
 * src/app/admin/inventory/audits/[id]/count/page.tsx   (slice books-12)
 *
 * THE COUNTING SCREEN.
 *
 * This route is the one a member of staff stands in front of with a scanner in
 * their hand. Everything about it is arranged for that person rather than for
 * the person reviewing afterwards: big scan box, immediate feedback, one lot at
 * a time, and no numbers they are supposed to match.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BLIND COUNT IS SAFE HERE
 * ---------------------------------------------------------------------------
 * `getCountSheet` returns `CountSheetLine`, which has NO `systemQty` field. The
 * expected quantity is not fetched, not serialised, and not sent to the
 * browser. It cannot be revealed by a styling mistake, a devtools poke, or a
 * careless `JSON.stringify` in a future edit -- because it was never in the
 * payload. That is the difference between hiding something and not sending it.
 *
 * ---------------------------------------------------------------------------
 * WHY A COUNT CAN STILL BE VIEWED AFTER IT CLOSES
 * ---------------------------------------------------------------------------
 * Once a session leaves the counting stage the sheet becomes read-only rather
 * than inaccessible. The record of what was counted is the evidence; hiding it
 * after the fact would make the audit harder to defend, not safer.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { getCountSheet } from "@/lib/inventory/audit-hub-store";
import { LABELS } from "@/lib/inventory/inventory-audit-post-core";
import { AuditCountSheet } from "../../AuditCountSheet";
import { HubRefusal } from "../../HubRefusal";
import { WhyBlockedPanel } from "../../WhyBlockedPanel";
import { BlindCountPanel } from "../../AuditHubExplainer";

export const dynamic = "force-dynamic";

export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ refusal?: string; refusalCode?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;

  const sheet = await getCountSheet(id);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Auditing", href: "/admin/inventory/audits" },
          { label: "Counting" },
        ]}
      />

      {!sheet.ok ? (
        <>
          <AdminPageHeader title="Counting" subtitle="This count sheet could not be opened." />
          <HubRefusal refusal={sheet.refusal} context="the count sheet" />
        </>
      ) : (
        <>
          <AdminPageHeader
            title={sheet.data.session.label}
            subtitle={`${LABELS[sheet.data.session.status]} — count what is on the shelf and enter what you find. You will not be shown what the system expects.`}
            action={
              <Button href={`/admin/inventory/audits/${id}`} variant="neutral" size="sm">
                Review and finish
              </Button>
            }
          />

          {sp.refusal ? (
            <WhyBlockedPanel blockers={[sp.refusal]} title="That entry was not recorded" />
          ) : null}

          <AuditCountSheet
            sessionId={id}
            lines={sheet.data.lines}
            // Counting is only open while the session is in the counting stage.
            // Before that the scope has not been agreed; after it, the numbers
            // are evidence and editing them silently would destroy the trail.
            readOnly={sheet.data.session.status !== "counting"}
          />

          {/* The doctrine sits under the working area so the counter can read
              WHY the sheet looks incomplete to them, instead of assuming the
              page is broken and going to find the expected numbers elsewhere. */}
          <BlindCountPanel />
        </>
      )}
    </div>
  );
}
