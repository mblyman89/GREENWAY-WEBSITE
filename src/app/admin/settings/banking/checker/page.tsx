/**
 * /admin/settings/banking/checker   (R41 S9, plan points 3 and 5)
 *
 * The last check before a file goes to Timberland. Section 18 of the
 * agreement: Company has "no right to cancel or amend any Entry/File after
 * its receipt by Financial Institution", so this check is the real protection.
 * Owner or admin (settings.manage). Reads only; stores nothing.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { BankingSubnav } from "../BankingHelpTabs";
import { CheckerForm } from "./CheckerForm";
import { checkFileAction, practiceRunAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FileCheckerPage() {
  await requirePermission("settings.manage");
  return (
    <div>
      <AdminPageHeader
        title="Check a file before you upload it"
        subtitle="Pick the file you downloaded. Every Timberland rule is checked again, and the app confirms it is the exact file you released."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "File checker" }]} />}
        help={
          <HelpPanel
            id="ach-file-checker"
            title="How to use the file checker"
            steps={[
              "On ACH operations, press Download on the file. Do not open or edit it.",
              "Come here, pick that file and press Check this file.",
              "Green means upload it to Timberland. Red means do not: read each line, fix the cause, release a new file if needed.",
              "Then confirm funding on ACH operations, upload in Timberland's portal, and mark it uploaded.",
            ]}
          >
            <p>Once Timberland has a file it cannot be cancelled (agreement section 18). This page reads the file in memory and keeps nothing.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="checker" />
        <section id="check" className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-lg font-semibold text-white">What is checked</h2>
          <p className="mb-4 text-sm text-white/60">
            94-character records in full blocks of 10; the header, batch and control records in order; every count, hash and total; Timberland&apos;s routing number and Greenway&apos;s Company ID; credits only, PPD or CCD only; the PAYROLL description; that the effective date still makes Timberland&apos;s deadline; that it fits the $50,000 limits; and that it is byte for byte a file released here, not yet uploaded or voided.
          </p>
          <CheckerForm check={checkFileAction} practice={practiceRunAction} />
        </section>
      </div>
    </div>
  );
}
