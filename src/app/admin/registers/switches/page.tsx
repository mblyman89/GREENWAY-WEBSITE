/**
 * /admin/registers/switches — the owner's register switches (D241).
 *
 * Owner (2026-11-12): "I want to add a toggle setting in register activity
 * that lets me turn off or disable use of the web browser registers. I only
 * want them on if the iPads have failed in some way. I also want a toggle for
 * dual approval on cash swaps with the master so I can turn it off if needed."
 *
 * One site_settings JSON row (no migration). The server enforces both:
 * /api/pos/unlock refuses a browser when browser registers are off, and
 * /api/pos/till skips the approver PIN on a swap only when approval is off.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Card } from "@/components/admin/ui";
import { RegisterSwitchesEditor } from "@/components/admin/registers/RegisterSwitchesEditor";
import { getRegisterSwitches } from "@/lib/pos/register-switches-store";

export const dynamic = "force-dynamic";

export default async function RegisterSwitchesPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Register switches" subtitle="Browser registers and swap approval." />
        <EmptyState title="Supabase not configured" description="Connect the database to change the register switches." />
      </div>
    );
  }

  const switches = await getRegisterSwitches();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Registers", href: "/admin/registers" },
          { label: "Register switches" },
        ]}
      />
      <AdminPageHeader
        title="Register switches"
        subtitle="Turn browser registers on only when the iPads fail, and choose whether change swaps need a manager PIN."
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="pos-register-switches"
          title="How these switches work"
          steps={[
            "Browser registers OFF: a register opened in a web browser cannot be unlocked. The iPad app works as normal. The server checks this on every unlock, so it cannot be skipped on the register.",
            "If the iPads fail: turn browser registers ON here, open greenwaymarijuana.com/pos on any computer or tablet that is set up as a register, and ring sales. Turn it OFF again when the iPads are back.",
            "With browser registers OFF, a browser register can still clock people in and out and still sends any sales it saved, so nothing is lost.",
            "Swap approval OFF: a change swap with the master till needs only the cashier's PIN. The bills both ways are still recorded and the audit says approval was not required. Turn it back ON to require a manager or lead PIN again.",
          ]}
        />
        <Card>
          <RegisterSwitchesEditor initial={switches} />
        </Card>
      </div>
    </div>
  );
}
