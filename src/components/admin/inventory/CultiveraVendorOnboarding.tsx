/**
 * CultiveraVendorOnboarding  (R74 S11)
 *
 * Product Onboarding, "Cultivera manifests by vendor". Owner (round 7): "i
 * want to see the manifests in onboarding, grouped or groupable by vendor. i
 * want to see gemini telling me it can lookup all products from a vendor ...
 * i want to see the onboard page showing me all the mastering it is doing to
 * the products. i want to see the coas being attached and the facts from them
 * getting attached to the products."
 *
 *   - one line per vendor (manifests, lots, not started / in review /
 *     complete, products waiting in review), open work first;
 *   - choose a vendor -> its manifests, and two buttons:
 *       "Start every manifest from <vendor>" (resumable: Continue), and
 *       "Look up all N products from <vendor> with Gemini";
 *   - the mastering panel: facts attached by source (lab certificate,
 *     Cultivera, Gemini, remembered, knowledge base, a person), facts by field,
 *     knowledge-base links, lots linked to a lab result / certificate kept,
 *     Gemini lookups in progress, and the latest onboarding timeline notes.
 *
 * Presentational server component: all decisions are in cultivera-vendor-core;
 * the reads in cultivera-vendor.ts; the buttons are server actions passed in.
 */
import Link from "next/link";
import { Button } from "@/components/admin/ui";
import { draftsHref } from "@/lib/catalog/draft-deep-link-core";
import {
  FACT_SOURCE_LABEL,
  labCoverageLine,
  masteringEventLabel,
  type VendorBanner,
  type VendorRollup,
} from "@/lib/inventory/cultivera-vendor-core";
import type { CultiveraTableRow } from "@/lib/inventory/receiving-table-core";
import type { VendorMastering } from "@/lib/inventory/cultivera-vendor";

export const VENDOR_SECTION_HELP =
  "Every manifest rebuilt from Cultivera, rolled up per vendor. Pick a vendor to start all of its manifests at once and to have Gemini look up every product on them. Each answer Gemini finds is saved to the knowledge base, so it is reused the next time the same product comes in (also after a factory reset). Nothing here changes stock, prices or the live menu.";

function bannerClass(tone: VendorBanner["tone"]): string {
  if (tone === "bad") return "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]";
  if (tone === "warn") return "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]";
  return "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]";
}

const n = (v: number) => v.toLocaleString("en-US");

export function vendorOnboardingHref(vendor: string | null): string {
  return `${draftsHref({ extra: vendor ? { cv_vendor: vendor } : { cv_vendors: "1" } })}#cultivera-vendor`;
}

export function CultiveraVendorOnboarding({
  error,
  vendors,
  selected,
  selectedRows,
  mastering,
  startBanner,
  lookupBanner,
  startCursor,
  startAction,
  lookupAction,
  open,
}: {
  error: string | null;
  vendors: readonly VendorRollup[];
  selected: VendorRollup | null;
  selectedRows: readonly CultiveraTableRow[];
  mastering: VendorMastering | null;
  startBanner: VendorBanner | null;
  lookupBanner: VendorBanner | null;
  startCursor: string | null;
  startAction: (formData: FormData) => Promise<void>;
  lookupAction: (formData: FormData) => Promise<void>;
  open: boolean;
}) {
  const s = mastering?.summary ?? null;
  return (
    <details
      id="cultivera-vendor"
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)] p-3 text-sm"
      data-testid="cultivera-vendor-section"
      open={open}
    >
      <summary className="cursor-pointer font-semibold">
        Cultivera manifests by vendor{error ? "" : ` (${n(vendors.length)} vendor${vendors.length === 1 ? "" : "s"})`}
      </summary>
      <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{VENDOR_SECTION_HELP}</p>
      {startBanner && (
        <p
          role={startBanner.tone === "bad" ? "alert" : "status"}
          data-testid="cultivera-vendor-start-banner"
          data-tone={startBanner.tone}
          className={`mt-2 rounded-[var(--admin-radius)] border px-3 py-2 text-xs ${bannerClass(startBanner.tone)}`}
        >
          {startBanner.text}
        </p>
      )}
      {lookupBanner && (
        <p
          role={lookupBanner.tone === "bad" ? "alert" : "status"}
          data-testid="cultivera-vendor-lookup-banner"
          data-tone={lookupBanner.tone}
          className={`mt-2 rounded-[var(--admin-radius)] border px-3 py-2 text-xs ${bannerClass(lookupBanner.tone)}`}
        >
          {lookupBanner.text}
        </p>
      )}
      {error ? (
        <p className="mt-2 text-xs text-[var(--admin-danger)]" data-testid="cultivera-vendor-error">
          The Cultivera manifests could not be read: {error}. Nothing was changed. Refresh to try again.
        </p>
      ) : vendors.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--admin-text-muted)]" data-testid="cultivera-vendor-empty">
          No manifests have been rebuilt from the Cultivera export yet.
        </p>
      ) : (
        <>
          {selected ? (
            <div className="mt-3 space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3" data-testid="cultivera-vendor-selected" data-vendor={selected.vendor}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-[var(--admin-text)]">{selected.vendor}</h3>
                <Link href={vendorOnboardingHref(null)} className="text-xs underline text-[var(--admin-text-muted)]">
                  {"\u2190"} All vendors
                </Link>
              </div>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {n(selected.manifests)} manifest{selected.manifests === 1 ? "" : "s"}, {n(selected.lots)} lot{selected.lots === 1 ? "" : "s"}:{" "}
                {n(selected.notStarted)} not started, {n(selected.inReview)} in review, {n(selected.done)} complete
                {selected.unknown > 0 ? `, ${n(selected.unknown)} unknown` : ""}.
              </p>
              <div className="flex flex-wrap items-start gap-3">
                <form action={startAction} className="flex flex-col gap-1" data-testid="cultivera-vendor-start">
                  <input type="hidden" name="vendor" value={selected.vendor} />
                  {startCursor && <input type="hidden" name="cursor" value={startCursor} />}
                  <Button type="submit" variant="neutral" size="sm" data-testid="cultivera-vendor-start-button">
                    {startCursor
                      ? `Continue starting ${selected.vendor}`
                      : `Start every manifest from ${selected.vendor} (${n(selected.notStarted + selected.inReview + selected.unknown)})`}
                  </Button>
                  <span className="max-w-xs text-[0.7rem] text-[var(--admin-text-faint)]">
                    Runs Start on each manifest not complete yet: onboarding rows, vendor lab results, lab certificates read,
                    knowledge base, facts. About a minute per manifest; one press does what fits, then Continue.
                  </span>
                </form>
                <form action={lookupAction} className="flex flex-col gap-1" data-testid="cultivera-vendor-lookup">
                  <input type="hidden" name="vendor" value={selected.vendor} />
                  <Button type="submit" variant="neutral" size="sm" data-testid="cultivera-vendor-lookup-button">
                    {selected.productsInReview > 0
                      ? `Look up all ${n(selected.productsInReview)} products from ${selected.vendor} with Gemini`
                      : `Look up all products from ${selected.vendor} with Gemini`}
                  </Button>
                  <span className="max-w-xs text-[0.7rem] text-[var(--admin-text-faint)]">
                    Gemini can look up every product from this vendor that is waiting in review (web search, then facts
                    attached for you to check). It works in the background, several manifests at once; every answer is
                    saved to the knowledge base for reuse.
                  </span>
                </form>
              </div>

              {/* The mastering panel. */}
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs" data-testid="cultivera-vendor-mastering">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">What onboarding has done to these products</h4>
                {mastering && mastering.errors.length > 0 && (
                  <p className="mb-2 text-[var(--admin-gold)]" data-testid="cultivera-vendor-mastering-errors">
                    Some parts could not be read (shown as unreadable, never as zero): {mastering.errors.join("; ")}
                  </p>
                )}
                {s ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p data-testid="mastering-drafts">
                        <strong>{n(s.drafts)}</strong> product{s.drafts === 1 ? "" : "s"} in onboarding: {n(s.inReview)} in review, {n(s.approved)} approved,{" "}
                        {n(s.dismissed)} dismissed.
                      </p>
                      <p data-testid="mastering-kb">
                        <strong>{n(s.linkedToKb)}</strong> linked to a knowledge-base product.
                      </p>
                      <p data-testid="mastering-facts">
                        <strong>{n(s.facts)}</strong> fact{s.facts === 1 ? "" : "s"} attached in all.
                      </p>
                      <ul className="mt-1 space-y-0.5" data-testid="mastering-by-source">
                        {(
                          [
                            ["coa", s.withCoa],
                            ["cultivera", s.withCultivera],
                            ["gemini", s.withGemini],
                            ["remembered", s.withRemembered],
                            ["kb_published", s.withKb],
                            ["human", s.withHuman],
                          ] as const
                        ).map(([src, count]) => (
                          <li key={src} data-source={src}>
                            {FACT_SOURCE_LABEL[src]}: {n(count)} product{count === 1 ? "" : "s"}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p data-testid="mastering-lab">{labCoverageLine(mastering?.lab ?? null)}</p>
                      <p data-testid="mastering-lookup">
                        {mastering?.lookup == null
                          ? "Gemini lookups could not be read."
                          : mastering.lookup.jobs === 0
                            ? "No Gemini lookups running for this vendor."
                            : `Gemini is working: ${n(mastering.lookup.done)} of ${n(mastering.lookup.total)} products looked up across ${n(mastering.lookup.jobs)} manifest${mastering.lookup.jobs === 1 ? "" : "s"}. Refresh to follow along.`}
                      </p>
                      {s.byField.length > 0 && (
                        <p className="mt-1" data-testid="mastering-by-field">
                          Facts by field: {s.byField.slice(0, 12).map((f) => `${f.field} ${n(f.count)}`).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[var(--admin-text-muted)]">The onboarding rows could not be read.</p>
                )}
                {mastering?.events && mastering.events.length > 0 && (
                  <div className="mt-3" data-testid="mastering-events">
                    <h5 className="mb-1 font-semibold text-[var(--admin-text-muted)]">Latest activity</h5>
                    <ul className="space-y-1">
                      {mastering.events.map((e, i) => (
                        <li key={`${e.manifestId}-${e.at}-${i}`} data-testid="mastering-event" data-type={e.type}>
                          <span className="text-[var(--admin-text-faint)]">{e.at.slice(0, 16).replace("T", " ")}</span>{" "}
                          <strong>{masteringEventLabel(e.type)}</strong>{" "}
                          <Link href={draftsHref({ manifestId: e.manifestId })} className="underline">
                            {selectedRows.find((r) => r.id === e.manifestId)?.number ?? "manifest"}
                          </Link>
                          : {e.note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <table className="w-full text-xs" data-testid="cultivera-vendor-manifests">
                <tbody className="divide-y divide-[var(--admin-border)]">
                  <tr className="text-left text-[var(--admin-text-faint)]">
                    <th scope="col" className="py-1 pr-2">Manifest</th>
                    <th scope="col" className="py-1 pr-2">Received</th>
                    <th scope="col" className="py-1 pr-2">Lots</th>
                    <th scope="col" className="py-1 pr-2">Onboarding</th>
                  </tr>
                  {selectedRows.map((r) => (
                    <tr key={r.id} data-testid="cultivera-vendor-manifest-row" data-state={r.state}>
                      <td className="py-1 pr-2 font-mono">
                        <Link href={draftsHref({ manifestId: r.id })} className="underline">
                          {r.number}
                        </Link>
                      </td>
                      <td className="py-1 pr-2">{r.day ?? "\u2014"}</td>
                      <td className="py-1 pr-2">{r.lots ?? "\u2014"}</td>
                      <td className="py-1 pr-2">{r.completion === "unknown" ? "Unknown" : r.stateLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <table className="mt-3 w-full text-xs" data-testid="cultivera-vendor-list">
            <tbody className="divide-y divide-[var(--admin-border)]">
              <tr className="text-left text-[var(--admin-text-faint)]">
                <th scope="col" className="py-1 pr-2">Vendor</th>
                <th scope="col" className="py-1 pr-2 text-right">Manifests</th>
                <th scope="col" className="py-1 pr-2 text-right">Not started</th>
                <th scope="col" className="py-1 pr-2 text-right">In review</th>
                <th scope="col" className="py-1 pr-2 text-right">Complete</th>
                <th scope="col" className="py-1 pr-2 text-right">Products waiting</th>
              </tr>
              {vendors.map((g) => (
                <tr key={g.key || "unknown"} data-testid="cultivera-vendor-row" data-vendor={g.vendor} aria-current={selected?.key === g.key ? "true" : undefined}>
                  <td className="py-1 pr-2">
                    {g.key ? (
                      <Link href={vendorOnboardingHref(g.vendor)} className="font-medium underline">
                        {g.vendor}
                      </Link>
                    ) : (
                      <span className="text-[var(--admin-text-muted)]">{g.vendor}</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{n(g.manifests)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{n(g.notStarted)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{n(g.inReview)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {n(g.done)}
                    {g.unknown > 0 ? ` (+${n(g.unknown)} unknown)` : ""}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{n(g.productsInReview)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </details>
  );
}
