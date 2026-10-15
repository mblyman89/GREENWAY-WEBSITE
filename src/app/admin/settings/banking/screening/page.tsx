/**
 * /admin/settings/banking/screening   (R41 S11)
 *
 * OFAC sanctions screening of every payee. Owner or admin (settings.manage).
 * Never blocks a payment; a possible match is a review item for the owner.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { readScreeningView } from "@/lib/payments/ofac-screening-store";
import { BankingSubnav } from "../BankingHelpTabs";
import { recordOfacReviewAction, screenNowAction } from "../screening-actions";
import { ScreeningPanel } from "./ScreeningPanel";

export const dynamic = "force-dynamic";
/** Screen now downloads about 7 MB and screens every payee. */
export const maxDuration = 300;

export default async function ScreeningPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const session = await requirePermission("settings.manage");
  const sp = await searchParams;
  const view = await readScreeningView();
  return (
    <div>
      <AdminPageHeader
        title="Sanctions screening (OFAC)"
        subtitle="Every employee and vendor name is checked each morning against OFAC's sanctions lists. It never blocks a payment."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Sanctions screening" }]} />}
        help={
          <HelpPanel
            id="ach-ofac-screening"
            title="What this page is for"
            steps={[
              "Each morning the site downloads OFAC's SDN and Consolidated lists and checks every payee's names against them.",
              "Most days nothing shows. If a name looks similar to a list entry, it appears under Possible matches and Michael gets an email.",
              "Compare the details (date of birth, country, business location). Record Not a match with what you compared, or True match.",
              "Payments are never held by this page. A true match means: do not send them money, and call your attorney and Timberland.",
            ]}
          >
            <p>Timberland&apos;s ACH agreement, section 3, makes Greenway responsible for OFAC information. This page is the record that you checked.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="screening" />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}
        <ScreeningPanel view={view} now={new Date()} isOwner={session.profile.role === "owner"} screenNow={screenNowAction} review={recordOfacReviewAction} />
      </div>
    </div>
  );
}
