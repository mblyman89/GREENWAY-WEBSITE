/**
 * src/components/admin/HandbookGateScreen.tsx  (SLICE 36)
 *
 * Full-screen handbook + acknowledgment view shown by the admin layout
 * INSTEAD of the requested page when a signed-in staff member has not yet
 * acknowledged the CURRENT handbook version (owner directive: "new employees
 * have to read it and check a box … before being given access to the back
 * office and front end POS"). Rendering in place of children (rather than
 * redirecting) means there is no route to bookmark around and no redirect
 * loop to fight — every admin URL shows the handbook until the box is
 * checked. Owners never see this screen (they are exempt in the gate core).
 */
import { HANDBOOK_SECTIONS, HANDBOOK_VERSION } from "@/lib/staffing/handbook-content";
import { HandbookAckForm } from "@/components/admin/HandbookAckForm";

export function HandbookGateScreen({ fullName }: { fullName: string }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="rounded-[var(--admin-radius-lg)] border border-amber-500/40 bg-amber-500/10 p-5">
        <h1 className="text-lg font-semibold text-amber-200">
          One thing before you start{fullName ? `, ${fullName}` : ""}: read the employee handbook
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
          Store policy requires every employee to read the handbook and record their acknowledgment
          before using the back office or the registers. Read it below (it covers the law you must
          follow on the floor, our standards, and how discipline works), then check the box at the
          bottom. This takes one sitting and you only repeat it when the handbook version changes.
        </p>
      </div>

      <article className="mt-6 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-8">
        <header className="border-b border-white/10 pb-6">
          <h2 className="text-2xl font-bold text-white">Greenway Marijuana — Employee Handbook</h2>
          <p className="mt-1 text-sm text-white/50">
            Version {HANDBOOK_VERSION} · WSLCB license 413541 · Port Orchard, WA
          </p>
        </header>

        {HANDBOOK_SECTIONS.map((section, i) => (
          <section key={section.id} className="mt-8">
            <h3 className="text-lg font-semibold text-white">
              {i + 1}. {section.title}
            </h3>
            {section.paragraphs.map((p, j) => (
              <p key={j} className="mt-3 text-sm leading-relaxed text-white/75">
                {p}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-white/75">
                {section.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <div className="mt-10 border-t border-white/10 pt-6">
          <h3 className="text-lg font-semibold text-white">Acknowledgment</h3>
          <div className="mt-4">
            <HandbookAckForm version={HANDBOOK_VERSION} />
          </div>
        </div>
      </article>
    </div>
  );
}
