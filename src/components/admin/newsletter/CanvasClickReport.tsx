/**
 * CanvasClickReport — D238 N-8c (SOP-22 G-118).
 *
 * Server component: which sections of this newsletter people tapped, and
 * the poll results, from the email provider's click events (each link
 * carries utm_content = the section id).
 */
import type { ClickReport } from "@/lib/cms/newsletter-motion-core";

export function CanvasClickReport({ report }: { report: (ClickReport & { sends: number }) | null }) {
  return (
    <section className="mt-6 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--admin-text)]">Clicks by section</h2>
      {!report ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Click data is not available (save the canvas first, or the database is not connected).</p>
      ) : report.sends === 0 ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Not sent yet. After it goes out, every tap on a section and every poll vote shows here (it needs the email provider&apos;s webhook, already set up for open and click stats).</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            {report.totalClicks} clicks from {report.people} people across {report.sends} send(s). Unsubscribe clicks: {report.unsubscribes}. Other links: {report.otherClicks}.
          </p>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-[var(--admin-text-faint)]">
              <tr>
                <th className="py-1 pr-2 font-medium">Section</th>
                <th className="py-1 pr-2 font-medium">Clicks</th>
                <th className="py-1 font-medium">People</th>
              </tr>
            </thead>
            <tbody className="text-[var(--admin-text)]">
              {report.rows.map((r) => (
                <tr key={r.blockId} className="border-t border-[var(--admin-border)] align-top">
                  <td className="py-1.5 pr-2">
                    {r.label}
                    {r.options.length ? (
                      <ul className="mt-1 space-y-0.5 text-[var(--admin-text-muted)]">
                        {r.options.map((o, i) => (
                          <li key={i}>
                            {o.label}: {o.people} vote{o.people === 1 ? "" : "s"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2">{r.clicks}</td>
                  <td className="py-1.5">{r.people}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
