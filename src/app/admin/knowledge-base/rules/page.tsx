/**
 * /admin/knowledge-base/rules
 *
 * READ-ONLY Washington compliance / safety REFERENCE (KB hardening v2, Slice 3).
 * This is the "know before you go / know before you consume" layer: 21+,
 * purchase & possession limits, no public use, don't drive impaired, edibles
 * start-low-go-slow, store safely, don't cross state lines. Each rule has a
 * neutral factual statement, a friendly house-voiced "what that means for you"
 * note, a severity for emphasis, and a statute citation.
 *
 * IMPORTANT: this is a REFERENCE / EDUCATION layer, NOT an enforcement path. The
 * actual single-transaction purchase-limit ENFORCEMENT lives in
 * src/lib/compliance/sales-limits-core.ts and /admin/compliance/sales-limits.
 * The purchase-limit NUMBERS shown here are derived from the same enforced
 * constants at seed time, so they can never disagree.
 *
 * COMPLIANCE (WA I-502): factual legal/safety education only — no medical claims,
 * no product-specific dosing directive. Degrades to a pre-migration notice if
 * kb_compliance_rules is empty (0088 not yet applied).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listKbComplianceRulesFull } from "@/lib/ai/kb/store";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

/** Category label for grouping display. */
const CATEGORY_LABELS: Record<string, string> = {
  age: "Age",
  "purchase-limit": "Purchase limit",
  possession: "Possession",
  "public-use": "Public use",
  driving: "Driving",
  "edibles-safety": "Edibles safety",
  storage: "Storage",
  transport: "Transport",
};

/** Severity badge — UI emphasis only, not a legal grade. */
function SeverityBadge({ value }: { value: string }) {
  const v = (value ?? "").toLowerCase();
  const style =
    v === "critical"
      ? { bg: "#b91c1c", label: "Critical" }
      : v === "important"
        ? { bg: "#b45309", label: "Important" }
        : { bg: "#15803d", label: "Info" };
  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ background: style.bg }}
    >
      {style.label}
    </span>
  );
}

export default async function KbRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const rules = await listKbComplianceRulesFull();

  return (
    <div>
      <AdminPageHeader
        title="WA rules & safety"
        subtitle="The Washington know-before-you-go facts we surface helpfully to keep customers safe — reference only"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "WA rules & safety" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {rules.length} rule{rules.length === 1 ? "" : "s"} in the reference set. Each is a factual
          Washington safety, purchase, or use fact plus a friendly plain-language note, so the AI can
          weave the right heads-up into an answer. This is <em>education</em>, not enforcement — the
          live single-transaction limit enforcement lives in{" "}
          <Link href="/admin/compliance/sales-limits" className="text-[var(--admin-accent)] underline">
            Compliance → Sales limits
          </Link>
          , and the purchase-limit numbers here are derived from those same enforced values.
        </p>

        {rules.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            No rules loaded yet. Apply migration{" "}
            <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-xs">
              0088_kb_compliance_rules.sql
            </code>{" "}
            then load the starter reference set from{" "}
            <Link href="/admin/knowledge-base/setup" className="text-[var(--admin-accent)] underline">
              Setup &amp; starter data
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                {/* Header bar */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-bg)] px-5 py-3.5">
                  <div className="min-w-0">
                    <span className="block text-lg font-bold text-[var(--admin-text)]">
                      {r.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--admin-text-muted)]">
                      {CATEGORY_LABELS[r.category ?? ""] ?? r.category ?? "—"}
                    </span>
                  </div>
                  <SeverityBadge value={r.severity} />
                </div>

                <div className="flex flex-1 flex-col space-y-4 p-5">
                  {/* The rule (factual statement) */}
                  {r.rule ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        The rule
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text)]">
                        {r.rule}
                      </p>
                    </div>
                  ) : null}

                  {/* House voice */}
                  {r.house_note ? (
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                        What that means for you
                      </h3>
                      <p className="mt-1.5 text-sm italic leading-relaxed text-[var(--admin-text-muted)]">
                        &ldquo;{r.house_note}&rdquo;
                      </p>
                    </div>
                  ) : null}

                  {/* Citation + sources */}
                  <div className="mt-auto pt-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                      Citation
                    </h3>
                    <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                      {r.citation ?? "—"}
                    </p>
                    {r.sources.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {r.sources.map((s) => (
                          <li key={s} className="truncate text-xs">
                            <a
                              href={s}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--admin-accent)] underline"
                            >
                              {s.replace(/^https?:\/\//, "")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {/* Provenance / status */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-3">
                    {r.status && r.status !== "published" ? (
                      <span className="inline-block rounded-full bg-[var(--admin-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                        {r.status}
                      </span>
                    ) : null}
                    {r.source ? (
                      <span className="inline-block text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                        source: {r.source}
                      </span>
                    ) : null}
                    {!r.active ? (
                      <span className="inline-block text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                        inactive
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[var(--admin-text-faint)]">
          Reference and education only — factual Washington legal/safety facts, not medical advice and
          not a product-specific dosing directive. Enforcement of purchase limits happens at checkout.
          Cannabis products have intoxicating effects and are for adults 21+.
        </p>
      </div>
    </div>
  );
}
