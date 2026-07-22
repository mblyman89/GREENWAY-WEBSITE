import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { HANDBOOK_SECTIONS, HANDBOOK_VERSION } from "@/lib/staffing/handbook-content";
import { PrintHandbookButton } from "./PrintHandbookButton";
import { backHref } from "@/lib/admin/back-link-core";

export const dynamic = "force-dynamic";

export default async function HandbookPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  await requirePermission("staffing.manage");

  return (
    <div>
      <div className="print:hidden">
        <AdminPageHeader
          title="Employee handbook & policies"
          subtitle={`Version ${HANDBOOK_VERSION} — print it, have each employee read and sign the last page, then mark the handbook "Read & signed" in their file.`}
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Employees" },
                { label: "Roster", href: "/admin/staffing/employees" },
                { label: "Handbook" },
              ]}
            />
          }
          action={
            <div className="flex gap-2">
              <PrintHandbookButton />
              <Button href={backHref("/admin/staffing/employees", back)} variant="neutral" size="sm">
                ← Back to roster
              </Button>
            </div>
          }
          help={
            <HelpPanel
              id="employee-handbook"
              title="Using the handbook"
              steps={[
                "Click Print to get a clean paper copy (the admin chrome is hidden when printing).",
                "Give a copy to every new hire during onboarding.",
                "They sign the acknowledgment on the last page; keep the signed page in their paper file.",
                "Mark the handbook document 'Read & signed' in their employee file so the tracker is green.",
                "Policies cite the statute or rule they come from, so you can always answer 'why?'.",
              ]}
            >
              <p>
                This is store policy, not legal advice — worth a one-time review by your attorney
                before adopting. When you change a policy, re-print, bump the version, and collect
                fresh signatures.
              </p>
            </HelpPanel>
          }
        />
      </div>

      <div className="px-5 py-6 sm:px-8 print:px-0 print:py-0">
        <article className="mx-auto max-w-3xl rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-8 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
          <header className="border-b border-white/10 pb-6 print:border-black/20">
            <h1 className="text-2xl font-bold text-white print:text-black">
              Greenway Marijuana — Employee Handbook
            </h1>
            <p className="mt-1 text-sm text-white/50 print:text-black/60">
              Version {HANDBOOK_VERSION} · WSLCB license 413541 · Port Orchard, WA
            </p>
          </header>

          {HANDBOOK_SECTIONS.map((section, i) => (
            <section key={section.id} className="mt-8">
              <h2 className="text-lg font-semibold text-white print:text-black">
                {i + 1}. {section.title}
              </h2>
              {section.paragraphs.map((p, j) => (
                <p key={j} className="mt-3 text-sm leading-relaxed text-white/75 print:text-black/80">
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-white/75 print:text-black/80">
                  {section.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
