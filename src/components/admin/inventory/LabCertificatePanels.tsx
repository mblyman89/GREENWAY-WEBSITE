/**
 * R28 - the "Lab certificate" and "Product facts" panels, shared by the lot
 * page (/admin/inventory/[id]) and the KB product page
 * (/admin/knowledge-base/products/[id]). Display only: every value comes from
 * coa-panel-core (pure, self-tested on the real certificates), and the one
 * edit path is the Product Onboarding facts action (resolveIntakeFactReview),
 * so the website, the register and the back office read the same numbers.
 */
import { servingFactsView } from "@/lib/catalog/serving-facts-view-core";
import Link from "next/link";
import { Button } from "@/components/admin/ui";
import { ProductFactsPanel } from "@/app/admin/inventory/drafts/ProductFactsPanel";
import {
  LAB_CERT_ANCHOR,
  PRODUCT_FACTS_ANCHOR,
  type CoaFactsView,
  type LabCertificateView,
} from "@/lib/inventory/coa-panel-core";
import type { LotFactsContext } from "@/lib/inventory/coa-panel-server";

const box = "scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const h3 = "mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";

function Banner({ text, tone }: { text: string; tone: "ok" | "warn" | "bad" }) {
  const cls =
    tone === "ok"
      ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
      : tone === "warn"
        ? "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"
        : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]";
  return <div className={`mb-3 rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${cls}`} data-testid="lab-cert-banner">{text}</div>;
}

export function LabCertificatePanel({
  view,
  facts,
  rereadAction,
  banner,
  heading = "Lab certificate (read by the system)",
}: {
  view: LabCertificateView;
  facts: CoaFactsView;
  /** Bound server action; absent = no button (e.g. the KB page links to the lot). */
  rereadAction?: () => Promise<void>;
  banner?: { text: string; tone: "ok" | "warn" | "bad" } | null;
  heading?: string;
}) {
  return (
    <div id={LAB_CERT_ANCHOR} className={box} data-testid="lab-certificate-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">{heading}</h2>
        {rereadAction && view.state !== "no-lab" && (
          <form action={rereadAction}>
            <Button type="submit" variant="neutral" size="sm">Re-read lab certificate</Button>
          </form>
        )}
      </div>
      {banner && <Banner {...banner} />}

      {view.state === "no-lab" && (
        <p className="text-sm text-[var(--admin-text-muted)]" data-testid="lab-cert-none">
          No lab result is attached, so there is no certificate to read.
        </p>
      )}
      {view.state === "unread" && (
        <p className="text-sm text-[var(--admin-orange)]" data-testid="lab-cert-unread">{view.reason}</p>
      )}
      {view.state === "read" && (
        <div className="text-sm" data-testid="lab-cert-read">
          <p>
            <span
              className={`font-semibold ${view.status === "ok" ? "text-[var(--admin-accent)]" : view.status === "partial" ? "text-[var(--admin-orange)]" : "text-[var(--admin-danger)]"}`}
              data-testid="lab-cert-status"
            >
              {view.statusLabel}
            </span>
            <span className="text-[var(--admin-text-muted)]"> - {view.summary}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
            Read {fmtWhen(view.extractedAt)} from {view.readVia}
            {view.labSampleId ? ` - lab sample ${view.labSampleId}` : ""}
            {view.servingWeightG !== null ? ` - serving ${view.servingWeightG} g` : ""}.
            {view.jsonUrl && (
              <>
                {" "}
                <a href={view.jsonUrl} target="_blank" rel="noopener noreferrer" className="underline">lab JSON</a>
              </>
            )}
            {view.coaUrl && (
              <>
                {" "}
                <a href={view.coaUrl} target="_blank" rel="noopener noreferrer" className="underline">COA PDF</a>
              </>
            )}
          </p>
          {view.amended && <p className="mt-2 text-xs text-[var(--admin-orange)]">Amended certificate: {view.amended}</p>}
          {view.identityProblem && (
            <p className="mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 px-3 py-2 text-xs text-[var(--admin-danger)]" data-testid="lab-cert-identity">
              {view.identityProblem}
            </p>
          )}

          {view.totals.length > 0 && (
            <>
              <h3 className={h3}>Totals</h3>
              <dl className="space-y-1">
                {view.totals.map((t) => (
                  <div key={t.label} className="flex justify-between gap-3">
                    <dt className="text-[var(--admin-text-faint)]">{t.label}</dt>
                    <dd className="text-right">{t.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {view.cannabinoids.length > 0 && (
            <>
              <h3 className={h3}>Every cannabinoid on the certificate</h3>
              <table className="w-full text-xs" data-testid="lab-cert-cannabinoids">
                <thead>
                  <tr className="text-left text-[var(--admin-text-faint)]">
                    <th className="py-1 font-normal">Cannabinoid</th>
                    <th className="py-1 text-right font-normal">Percent</th>
                    <th className="py-1 text-right font-normal">mg per serving</th>
                  </tr>
                </thead>
                <tbody>
                  {view.cannabinoids.map((c) => (
                    <tr key={c.label} className="border-t border-[var(--admin-border)]">
                      <td className="py-1">{c.label}</td>
                      <td className="py-1 text-right">{c.pct}%</td>
                      <td className="py-1 text-right">{c.mgPerServing !== null ? `${c.mgPerServing} mg` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.terpenes.length > 0 && (
            <>
              <h3 className={h3}>
                Terpenes{view.totalTerpenesPpm !== null ? ` (total ${view.totalTerpenesPpm} ppm)` : ""}
              </h3>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs" data-testid="lab-cert-terpenes">
                {view.terpenes.map((t) => (
                  <li key={t.name} className="flex justify-between gap-2">
                    <span>{t.name}</span>
                    <span className="text-[var(--admin-text-muted)]">{t.ppm} ppm</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {view.checks.length > 0 && (
            <details className="mt-4" data-testid="lab-cert-checks">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-accent)]">
                {view.checks.length} cross-checks{view.failedChecks > 0 ? ` - ${view.failedChecks} did not agree` : " - all agree"}
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {view.checks.map((c, i) => (
                  <li key={`${c.group}-${c.what}-${i}`} className={c.ok ? "text-[var(--admin-text-muted)]" : "text-[var(--admin-danger)]"}>
                    {c.ok ? "\u2713" : "\u2717"} <span className="text-[var(--admin-text-faint)]">{c.group}:</span> {c.what} - {c.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {view.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--admin-orange)]">
              {view.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CoaFactsBlock facts={facts} />
    </div>
  );
}

function CoaFactsBlock({ facts }: { facts: CoaFactsView }) {
  if (facts.state === "not-dosed") return null;
  return (
    <div className="mt-4 border-t border-[var(--admin-border)] pt-3" data-testid="coa-facts">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        What the certificate gives this product
      </h3>
      {facts.state === "none" ? (
        <p className="text-xs text-[var(--admin-orange)]">{facts.reason}</p>
      ) : (
        <>
          <dl className="space-y-1 text-xs">
            {facts.rows.map((r) => (
              <div key={r.label}>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--admin-text-faint)]">{r.label}</dt>
                  <dd className="text-right font-semibold">{r.value}</dd>
                </div>
                <p className="text-[11px] text-[var(--admin-text-muted)]">{r.how}</p>
              </div>
            ))}
          </dl>
          {facts.held && (
            <div className="mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 px-3 py-2 text-xs text-[var(--admin-danger)]" data-testid="coa-facts-held">
              <p className="font-semibold">Held - this product stays off the menu until a person looks:</p>
              <ul className="mt-1 list-disc pl-4">
                {facts.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {facts.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--admin-text-muted)]">
              {facts.notes.map((n) => (
                <li key={n}>Note: {n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The facts on the lot now (golden record) + the editable Product facts. */
export function ProductFactsSection({
  lotFacts,
  ctx,
  returnTo,
  banner,
  lotHref,
  canEdit = true,
}: {
  lotFacts: { label: string; value: string; source: string }[];
  ctx: LotFactsContext;
  returnTo: string;
  banner?: { text: string; tone: "ok" | "warn" | "bad" } | null;
  /** On the KB page: which lot these are (link). */
  lotHref?: { href: string; label: string } | null;
  /** False when the signed-in role cannot save facts (inventory.manage). */
  canEdit?: boolean;
}) {
  return (
    <div id={PRODUCT_FACTS_ANCHOR} className={box} data-testid="product-facts-section">
      <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Product facts</h2>
      <p className="mb-3 text-xs text-[var(--admin-text-faint)]">
        The facts the register and the website use for this product, and where each came from.
        {lotHref && (
          <>
            {" "}
            From lot <Link href={lotHref.href} className="underline">{lotHref.label}</Link>.
          </>
        )}
      </p>
      {banner && <Banner {...banner} />}
      {lotFacts.length > 0 ? (
        <dl className="space-y-1 text-sm" data-testid="lot-fact-rows">
          {lotFacts.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <dt className="text-[var(--admin-text-faint)]">{r.label}</dt>
              <dd className="text-right">
                {r.value} <span className="text-xs text-[var(--admin-text-muted)]">({r.source})</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-[var(--admin-text-muted)]">No serving or package facts are on this lot yet.</p>
      )}
      {!canEdit ? (
        <p className="mt-3 text-xs text-[var(--admin-text-muted)]" data-testid="product-facts-readonly">
          Setting facts needs the inventory permission. Ask a manager to set them on the lot page.
        </p>
      ) : ctx.reason ? (
        <p className={`mt-3 text-xs ${ctx.readOk ? "text-[var(--admin-text-muted)]" : "text-[var(--admin-danger)]"}`} data-testid="product-facts-reason">
          {ctx.reason}
        </p>
      ) : ctx.draft && ctx.draft.manifest_id && ctx.draft.pos_product_key ? (
        !ctx.migrated ? (
          <p className="mt-3 text-xs text-[var(--admin-orange)]">Facts cannot be saved yet: the database is missing migration 0237 (fact reviews).</p>
        ) : (
          <ProductFactsPanel
            draftId={ctx.draft.id}
            manifestId={ctx.draft.manifest_id}
            productKey={ctx.draft.pos_product_key}
            saved={ctx.saved}
            readOk={ctx.readOk}
            returnManifest={null}
            returnView={ctx.draft.status === "approved" ? "approved" : "draft"}
            returnTo={returnTo}
            category={ctx.draft.chosen_website_category ?? null}
            serving={servingFactsView({
              name: ctx.draft.name ?? null,
              inventoryType: ctx.draft.inventory_type ?? null,
              category: ctx.draft.chosen_website_category ?? null,
              saved: (ctx.saved?.facts as Record<string, unknown> | undefined) ?? null,
              coa: null,
            })}
          />
        )
      ) : null}
    </div>
  );
}

function fmtWhen(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "at an unknown time";
  return t.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
