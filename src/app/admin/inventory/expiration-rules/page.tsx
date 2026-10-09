/**
 * /admin/inventory/expiration-rules  (R34)
 *
 * Owner: "a simple page added to the inventory page accessible via a button
 * ... a list of every one of our types and categories, and a box next to it
 * that lets me assign a date to it ... skipping the ones that have a json
 * set date. Perhaps a setting that allows me to override all manually set
 * dates."
 *
 * One form: every website category, with every type that rolls up to it
 * nested underneath. Each row has a box for the rule, the researched
 * suggestion (with its sources), and live coverage counts. Save writes
 * rules only; "Preview" shows exactly which lots would change and why the
 * rest are skipped; "Apply" writes only what the preview showed.
 * Server-rendered, no client JavaScript.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import { listInventoryTypes, listWebsiteCategoryTypes } from "@/lib/pos/types-store";
import { pacificToday } from "@/lib/reports/timezone";
import {
  EXPIRY_CITATIONS,
  citationByKey,
  confidenceLabel,
  suggestionForCategory,
  suggestionForType,
  suggestionLabel,
  type ExpirySuggestion,
} from "@/lib/inventory/expiry-research-core";
import {
  SKIP_REASON_LABELS,
  SOURCE_LABELS,
  buildRulePage,
  rulePageCategoriesFrom,
  computeExpiryStats,
  describeRule,
  planExpiryRuleApply,
  planFingerprint,
  formatMinor,
  type ExpiryRule,
  type ScopeCoverage,
  type SkipReason,
} from "@/lib/inventory/expiry-rules-core";
import { listExpiryRules, loadExpiryLots } from "@/lib/inventory/expiry-rules-store";
import { saveExpiryRulesAction, previewExpiryRulesAction, applyExpiryRulesAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

const KIND_LABELS = {
  fill: "Fill blank date",
  recompute: "Update rule date",
  override: "Replace owner-typed date",
  clear: "Clear rule date (no rule now)",
} as const;

const CELL = "px-3 py-2 align-top";
const INPUT =
  "admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1 text-sm text-[var(--admin-text)]";

function confidenceTone(c: ExpirySuggestion["confidence"]): "green" | "gold" | "neutral" {
  return c === "measured" ? "green" : c === "judgment" ? "gold" : "neutral";
}

/** What a row's inputs start with: the saved rule, else (when asked) the suggestion. */
function initialValues(rule: ExpiryRule | null, suggestion: ExpirySuggestion | null, prefill: boolean) {
  if (rule) {
    return {
      mode: rule.mode,
      amount: rule.amount != null ? String(rule.amount) : "",
      fixedDate: rule.fixed_date ?? "",
      basis: rule.basis,
      override: rule.override_manual,
      citation: rule.citation_key ?? "",
      notes: rule.notes ?? "",
      prefilled: false,
    };
  }
  if (prefill && suggestion) {
    return {
      mode: suggestion.mode,
      amount: suggestion.months != null ? String(suggestion.months) : "",
      fixedDate: "",
      basis: "received_on",
      override: false,
      citation: suggestion.citations[0] ?? "",
      notes: "",
      prefilled: true,
    };
  }
  return { mode: "", amount: "", fixedDate: "", basis: "received_on", override: false, citation: "", notes: "", prefilled: false };
}

function CoverageCell({ c }: { c: ScopeCoverage }) {
  if (c.lots === 0) return <span className="text-xs text-[var(--admin-text-faint)]">No lots</span>;
  return (
    <div className="text-xs leading-5 text-[var(--admin-text-muted)]">
      <div>
        <strong className="text-[var(--admin-text)]">{c.lots}</strong> lots
      </div>
      {c.blank ? <div className="text-[var(--admin-orange)]">{c.blank} blank</div> : null}
      {c.document ? <div>{c.document} document date</div> : null}
      {c.owner ? <div>{c.owner} owner-typed</div> : null}
      {c.rule ? <div>{c.rule} by rule</div> : null}
      {c.legacy ? <div>{c.legacy} unsourced</div> : null}
    </div>
  );
}

function SuggestionCell({ s, inherited, href, custom = false }: { s: ExpirySuggestion | null; inherited: boolean; href: string | null; custom?: boolean }) {
  if (!s) {
    return (
      <div className="max-w-xs text-xs text-[var(--admin-text-faint)]" data-testid={custom ? "expiry-no-research-custom" : undefined}>
        No researched default
        {custom ? (
          <p className="mt-1">
            You created this in Settings &rarr; Types, so no published research covers it. Use the manufacturer&rsquo;s stated shelf
            life, or leave it blank.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-[var(--admin-text)]">{suggestionLabel(s)}</span>
        <Badge tone={confidenceTone(s.confidence)}>{s.confidence === "not_applicable" ? "n/a" : s.confidence}</Badge>
        {inherited ? <span className="text-[var(--admin-text-faint)]">(from category)</span> : null}
      </div>
      <details>
        <summary className="cursor-pointer text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]">Why</summary>
        <p className="mt-1 max-w-sm text-[var(--admin-text-muted)]">{s.why}</p>
        <p className="mt-1 text-[var(--admin-text-faint)]">{confidenceLabel(s.confidence)}</p>
        {s.citations.length ? (
          <ul className="mt-1 list-disc pl-4">
            {s.citations.map((k) => {
              const c = citationByKey(k);
              return c ? (
                <li key={k}>
                  <a href={c.url} target="_blank" rel="noreferrer" className="underline hover:text-[var(--admin-text)]">
                    {c.title}
                  </a>
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
      </details>
      {href ? (
        <Link href={href} className="text-[var(--admin-orange)] underline">
          Use suggestion
        </Link>
      ) : null}
    </div>
  );
}

function RuleInputs({
  i,
  scope,
  scopeKey,
  label,
  v,
}: {
  i: number;
  scope: "category" | "type";
  scopeKey: string;
  label: string;
  v: ReturnType<typeof initialValues>;
}) {
  return (
    <div className="space-y-1.5">
      <input type="hidden" name={`row_${i}_scope`} value={scope} />
      <input type="hidden" name={`row_${i}_key`} value={scopeKey} />
      <input type="hidden" name={`row_${i}_label`} value={label} />
      <input type="hidden" name={`row_${i}_citation`} value={v.citation} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select name={`row_${i}_mode`} defaultValue={v.mode} className={INPUT} aria-label={`${label} rule`}>
          <option value="">No rule</option>
          <option value="months">Months after</option>
          <option value="days">Days after</option>
          <option value="fixed">Fixed date</option>
          <option value="exempt">Does not expire</option>
        </select>
        <input
          type="number"
          min={1}
          max={3650}
          step={1}
          name={`row_${i}_amount`}
          defaultValue={v.amount}
          placeholder="#"
          className={`${INPUT} w-20`}
          aria-label={`${label} months or days`}
        />
        <input type="date" name={`row_${i}_fixed_date`} defaultValue={v.fixedDate} className={INPUT} aria-label={`${label} fixed date`} />
        <select name={`row_${i}_basis`} defaultValue={v.basis} className={INPUT} aria-label={`${label} count from`}>
          <option value="received_on">from received date</option>
          <option value="lab_tested_on">from lab test date</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--admin-text-muted)]">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name={`row_${i}_override`} defaultChecked={v.override} /> Also replace owner-typed dates
        </label>
        <input name={`row_${i}_notes`} defaultValue={v.notes} placeholder="Note (optional)" maxLength={1000} className={`${INPUT} w-56 text-xs`} />
        {v.prefilled ? <Badge tone="orange">Suggested - not saved yet</Badge> : null}
      </div>
    </div>
  );
}

export default async function ExpirationRulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const today = pacificToday();

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="p-8 text-sm text-[var(--admin-text-muted)]">
        Supabase is not configured in this environment, so expiration rules are unavailable.
      </div>
    );
  }

  // Categories and types are read LIVE from Settings -> Types (inactive rows
  // included so a hidden one that still carries a rule or lots stays visible);
  // anything the owner creates there appears here on the next load.
  const [rulesRead, lotsRead, ownerTypes, categoryRows] = await Promise.all([
    listExpiryRules(),
    loadExpiryLots(),
    listInventoryTypes({ includeInactive: true }),
    listWebsiteCategoryTypes({ includeInactive: true }),
  ]);
  const rules = rulesRead.ok ? rulesRead.rules : [];
  const lots = lotsRead.ok ? lotsRead.lots : [];
  const migrated = !((!rulesRead.ok && !rulesRead.migrated) || (!lotsRead.ok && !lotsRead.migrated));

  const page = buildRulePage({
    categories: rulePageCategoriesFrom(categoryRows, {
      ruleCategoryKeys: rules.filter((r) => r.scope === "category").map((r) => r.scope_key),
      lotCategories: lots.map((l) => l.category),
    }),
    catalogTypes: INVENTORY_TYPE_CATALOG,
    ownerTypes,
    lots,
    rules,
  });
  const stats = computeExpiryStats(lots, today);

  // Suggestion pre-fill: ?suggest=all or ?suggest=category:flower / type:bho
  const suggest = String(sp.suggest ?? "");
  const prefillAll = suggest === "all";
  const prefillOne = new Set(suggest && !prefillAll ? suggest.split(",") : []);

  // Preview (in-page): plan exactly what Apply would write.
  const previewing = sp.preview === "1" && lotsRead.ok && rulesRead.ok;
  const previewOverride = sp.override === "1";
  const previewRule = sp.rule ?? null;
  const plan = previewing ? planExpiryRuleApply(lots, rules, { overrideManual: previewOverride, onlyRuleId: previewRule }) : null;
  const fp = plan ? planFingerprint(plan.writes) : "";
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const previewRuleObj = previewRule ? rules.find((r) => r.id === previewRule) ?? null : null;

  let rowIndex = 0;
  const ruleCount = rules.filter((r) => r.enabled).length;

  return (
    <div>
      <AdminPageHeader
        title="Expiration rules"
        subtitle="Give products without a manufacturer date a best-by date, by category or type. Dates from the vendor manifest / JSON, a COA or the POS are never changed."
        breadcrumbs={<Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Expiration rules" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="/admin/reports/expiration" variant="neutral" size="sm">
              Expiration report
            </Button>
            <Button href="/admin/settings/types" variant="neutral" size="sm">
              Manage categories & types
            </Button>
            <Button href="/admin/inventory" variant="neutral" size="sm">
              Back to inventory
            </Button>
          </div>
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        {!migrated ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-text)]">One-time setup needed</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
              {(!rulesRead.ok && rulesRead.error) || (!lotsRead.ok && lotsRead.error)}
            </p>
          </Card>
        ) : null}
        {migrated && !lotsRead.ok ? (
          <Card accent="orange">
            <p className="text-sm text-[var(--admin-text-muted)]">{lotsRead.error} Coverage counts and Preview are unavailable until every lot can be read.</p>
          </Card>
        ) : null}
        {migrated && !rulesRead.ok ? (
          <Card accent="orange">
            <p className="text-sm text-[var(--admin-text-muted)]">{rulesRead.error}</p>
          </Card>
        ) : null}
        {sp.error ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-danger)]">Nothing was saved</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-[var(--admin-text-muted)]">
              {sp.error.split(" | ").map((e, k) => (
                <li key={k}>{e}</li>
              ))}
            </ul>
          </Card>
        ) : null}
        {sp.saved !== undefined ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]">
              Rules saved: {sp.saved} saved, {sp.removed ?? 0} removed, {sp.unchanged ?? 0} unchanged. Lots are not changed until you
              Preview and Apply.
            </p>
          </Card>
        ) : null}
        {sp.applied !== undefined ? (
          <Card accent="green">
            <p className="text-sm text-[var(--admin-text)]">
              Applied to {sp.applied} lots: {sp.fill ?? 0} blank dates filled, {sp.recompute ?? 0} rule dates updated, {sp.overrode ?? 0} owner-typed
              dates replaced, {sp.cleared ?? 0} rule dates cleared.
              {Number(sp.changed ?? 0) > 0 ? ` ${sp.changed} lots changed since the preview and were left alone.` : ""}
              {Number(sp.failed ?? 0) > 0 ? ` ${sp.failed} writes failed - see the audit log.` : ""}
            </p>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Lots on hand" value={stats.onHandLots.toLocaleString()} />
          <StatCard
            label="Have a date"
            value={`${stats.coveragePct}%`}
            hint={`${stats.dated.toLocaleString()} of ${stats.onHandLots.toLocaleString()}`}
            accent={stats.coveragePct >= 90 ? "green" : "gold"}
          />
          <StatCard label="Rules active" value={String(ruleCount)} />
          <StatCard
            label="Value at risk"
            value={formatMinor(stats.valueAtRiskMinor)}
            hint="Expired or due in 30 days, at cost"
            accent={stats.valueAtRiskMinor > 0 ? "orange" : "muted"}
            href="/admin/reports/expiration"
          />
        </div>

        <Card>
          <p className="text-sm font-semibold text-[var(--admin-text)]">How this works</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--admin-text-muted)]">
            <li>
              A rule gives a lot a <strong>best-by date</strong> counted from the day it was received (or its lab test date). Washington does not
              require an expiration date; WAC 314-55-105(8) lists a &quot;best by&quot; date as optional label information.
            </li>
            <li>
              A <strong>type</strong> rule beats its <strong>category</strong> rule. Leave a box on &quot;No rule&quot; to skip it.
            </li>
            <li>
              Dates from the <strong>vendor manifest / JSON, a COA, or the POS</strong> are always kept. Old dates with no recorded source are kept too.
            </li>
            <li>
              Dates you typed yourself are kept unless you tick &quot;Also replace owner-typed dates&quot; on the rule or on the Preview.
            </li>
            <li>
              Save first, then Preview: it shows every lot that would change. Apply writes exactly that and nothing else. New deliveries get rule
              dates automatically when you finalize a manifest (blank dates only).
            </li>
          </ul>
        </Card>

        {/* -------------------------------- Preview -------------------------------- */}
        <Card accent="gold">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--admin-text)]">Preview and apply</p>
              <p className="text-xs text-[var(--admin-text-faint)]">Uses the SAVED rules. Nothing changes until you press Apply.</p>
            </div>
            <form action={previewExpiryRulesAction} className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-sm text-[var(--admin-text-muted)]">
                <input type="checkbox" name="override_manual" defaultChecked={previewOverride} /> Override all owner-typed dates
              </label>
              <Button type="submit" variant="primary" size="sm" disabled={!migrated || !lotsRead.ok || ruleCount === 0}>
                Preview all rules
              </Button>
            </form>
          </div>

          {plan ? (
            <div className="mt-4 space-y-3">
              {sp.stale === "1" ? (
                <p className="rounded-[var(--admin-radius)] bg-[var(--admin-orange-soft)] px-3 py-2 text-sm text-[var(--admin-orange)]">
                  Something changed since your preview (a lot, a rule, or a date). Nothing was written. Here is the fresh preview - review it and apply
                  again.
                </p>
              ) : null}
              <p className="text-sm text-[var(--admin-text)]">
                {previewRuleObj ? (
                  <>
                    Only the <strong>{previewRuleObj.scope_label ?? previewRuleObj.scope_key}</strong> rule ({describeRule(previewRuleObj)}).{" "}
                  </>
                ) : null}
                {previewOverride ? "Override is ON: owner-typed dates under a rule will be replaced. " : ""}
                <strong>{plan.writes.length.toLocaleString()}</strong> lots would change; {plan.counts.skipped.toLocaleString()} are left alone.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) =>
                  plan.counts[k] ? (
                    <Badge key={k} tone={k === "override" || k === "clear" ? "orange" : "green"}>
                      {KIND_LABELS[k]}: {plan.counts[k]}
                    </Badge>
                  ) : null,
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-[var(--admin-text-faint)]">Why lots are left alone</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-text-muted)]">
                  {(Object.keys(plan.skipCounts) as SkipReason[])
                    .filter((k) => plan.skipCounts[k] > 0)
                    .map((k) => (
                      <li key={k}>
                        {SKIP_REASON_LABELS[k]}: {plan.skipCounts[k]}
                      </li>
                    ))}
                </ul>
              </details>
              {plan.writes.length ? (
                <div className="max-h-96 overflow-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--admin-surface-2)] text-left uppercase tracking-wide text-[var(--admin-text-faint)]">
                      <tr>
                        <th className={CELL}>Lot</th>
                        <th className={CELL}>Category</th>
                        <th className={CELL}>Change</th>
                        <th className={CELL}>From</th>
                        <th className={CELL}>To</th>
                        <th className={CELL}>How</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.writes.slice(0, 300).map((w) => {
                        const l = lotById.get(w.lotId);
                        return (
                          <tr key={w.lotId} className="border-t border-[var(--admin-border)]">
                            <td className={CELL}>
                              <Link href={`/admin/inventory/${w.lotId}`} className="underline">
                                {l?.product_name || l?.lot_code || w.lotId.slice(0, 8)}
                              </Link>
                            </td>
                            <td className={CELL}>{l?.category_label ?? ""}</td>
                            <td className={CELL}>{KIND_LABELS[w.kind]}</td>
                            <td className={CELL}>{w.prev ?? "blank"}</td>
                            <td className={CELL}>{w.date ?? "blank"}</td>
                            <td className={`${CELL} text-[var(--admin-text-faint)]`}>{w.note ?? "No enabled rule governs this lot any more"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {plan.writes.length > 300 ? (
                    <p className="p-2 text-xs text-[var(--admin-text-faint)]">
                      Showing 300 of {plan.writes.length.toLocaleString()}. All of them are applied and recorded lot by lot in the audit log.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {plan.writes.length ? (
                <form action={applyExpiryRulesAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="fp" value={fp} />
                  <input type="hidden" name="override_manual" value={previewOverride ? "1" : "0"} />
                  {previewRule ? <input type="hidden" name="only_rule_id" value={previewRule} /> : null}
                  <Button type="submit" variant="confirm" size="sm">
                    Apply to {plan.writes.length.toLocaleString()} lots
                  </Button>
                  <Link href="/admin/inventory/expiration-rules" className="text-xs text-[var(--admin-text-faint)] underline">
                    Cancel
                  </Link>
                </form>
              ) : (
                <p className="text-sm text-[var(--admin-text-muted)]">Nothing to change - every lot is already in step with the rules.</p>
              )}
            </div>
          ) : null}
        </Card>

        {/* -------------------------------- Rules form -------------------------------- */}
        <form action={saveExpiryRulesAction} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[var(--admin-text-faint)]">
              {page.categories.length} groups &middot; {page.categories.reduce((n, c) => n + c.types.length, 0)} types &middot; types come from the
              POS catalog, your Settings &rarr; Types, and types seen on lots.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button href="/admin/inventory/expiration-rules?suggest=all" variant="special" size="sm">
                Fill blanks with suggestions
              </Button>
              <Button type="submit" variant="save" size="sm" disabled={!migrated}>
                Save rules
              </Button>
            </div>
          </div>

          {page.categories.map((cat) => {
            const catSuggestion = cat.value ? suggestionForCategory(cat.value) : null;
            const catIdx = cat.value ? rowIndex++ : -1;
            const catPrefill = prefillAll || prefillOne.has(`category:${cat.value}`);
            const catV = initialValues(cat.rule, catSuggestion, catPrefill);
            const typeRules = cat.types.filter((t) => t.rule).length;
            return (
              <details
                key={cat.value || "__unmapped"}
                open={Boolean(prefillAll || cat.rule || typeRules || catPrefill || cat.types.some((t) => prefillOne.has(`type:${t.key}`)))}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
                  <span className="font-semibold text-[var(--admin-text)]">{cat.label}</span>
                  {cat.custom ? <Badge tone="gold">Custom</Badge> : null}
                  {cat.hidden ? <Badge>Hidden in Settings</Badge> : null}
                  {cat.custom && !cat.rule && !typeRules ? <Badge tone="orange">New - no rule yet</Badge> : null}
                  {cat.rule ? <Badge tone="green">{describeRule(cat.rule)}</Badge> : <Badge>No category rule</Badge>}
                  {typeRules ? <Badge tone="gold">{typeRules} type rules</Badge> : null}
                  <span className="text-xs text-[var(--admin-text-faint)]">
                    {cat.types.length} types &middot; {cat.coverage.lots} lots
                    {cat.coverage.blank ? ` \u00b7 ${cat.coverage.blank} blank` : ""}
                  </span>
                </summary>
                <div className="overflow-x-auto border-t border-[var(--admin-border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                      <tr>
                        <th className={CELL}>Applies to</th>
                        <th className={CELL}>Rule</th>
                        <th className={CELL}>Research suggests</th>
                        <th className={CELL}>Lots</th>
                        <th className={CELL}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.value ? (
                        <tr className="border-t border-[var(--admin-border)] bg-[var(--admin-surface-2)]/40">
                          <td className={CELL}>
                            <div className="font-semibold text-[var(--admin-text)]">Every {cat.label} item</div>
                            <div className="text-xs text-[var(--admin-text-faint)]">Category rule - types without their own rule use this</div>
                          </td>
                          <td className={CELL}>
                            <RuleInputs i={catIdx} scope="category" scopeKey={cat.value} label={cat.label} v={catV} />
                          </td>
                          <td className={CELL}>
                            <SuggestionCell
                              s={catSuggestion}
                              custom={Boolean(cat.custom)}
                              inherited={false}
                              href={!cat.rule && catSuggestion ? `/admin/inventory/expiration-rules?suggest=category:${encodeURIComponent(cat.value)}` : null}
                            />
                          </td>
                          <td className={CELL}>
                            <CoverageCell c={cat.coverage} />
                          </td>
                          <td className={CELL}>
                            {cat.rule ? <PreviewOne ruleId={cat.rule.id} disabled={!lotsRead.ok} /> : null}
                          </td>
                        </tr>
                      ) : null}
                      {cat.types.map((t) => {
                        const i = rowIndex++;
                        const st = suggestionForType(t.key, cat.value || null);
                        const pre = prefillAll || prefillOne.has(`type:${t.key}`);
                        // A type only needs its own rule when it differs from its category.
                        const v = initialValues(t.rule, st && st.source === "type" ? st.suggestion : null, pre);
                        return (
                          <tr key={t.key} className="border-t border-[var(--admin-border)]">
                            <td className={`${CELL} pl-6`}>
                              <div className="flex flex-wrap items-center gap-1.5 text-[var(--admin-text)]">
                                {t.label}
                                {t.custom ? <Badge tone="gold">Custom</Badge> : null}
                                {t.hidden ? <Badge>Hidden in Settings</Badge> : null}
                              </div>
                              <div className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
                                type &middot; {t.sources.join(" + ")}
                              </div>
                            </td>
                            <td className={CELL}>
                              <RuleInputs i={i} scope="type" scopeKey={t.key} label={t.label} v={v} />
                              {!t.rule && cat.rule ? (
                                <p className="mt-1 text-xs text-[var(--admin-text-faint)]">Uses the {cat.label} rule: {describeRule(cat.rule)}</p>
                              ) : null}
                            </td>
                            <td className={CELL}>
                              <SuggestionCell
                                s={st?.suggestion ?? null}
                                custom={Boolean(t.custom || cat.custom)}
                                inherited={st?.source === "category"}
                                href={!t.rule && st?.source === "type" ? `/admin/inventory/expiration-rules?suggest=type:${encodeURIComponent(t.key)}` : null}
                              />
                            </td>
                            <td className={CELL}>
                              <CoverageCell c={t.coverage} />
                            </td>
                            <td className={CELL}>{t.rule ? <PreviewOne ruleId={t.rule.id} disabled={!lotsRead.ok} /> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
          <input type="hidden" name="row_count" value={rowIndex} />
          <div className="flex justify-end">
            <Button type="submit" variant="save" size="sm" disabled={!migrated}>
              Save rules
            </Button>
          </div>
        </form>

        {page.orphans.length ? (
          <Card accent="orange">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Rules for types that no longer exist</p>
            <p className="text-xs text-[var(--admin-text-faint)]">
              No category, catalog type, Settings type or lot uses these keys now. They still match a lot if one appears with that type.
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--admin-text-muted)]">
              {page.orphans.map((r) => (
                <li key={r.id}>
                  {r.scope} &ldquo;{r.scope_label ?? r.scope_key}&rdquo;: {describeRule(r)}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <p className="text-sm font-semibold text-[var(--admin-text)]">Where dates come from now</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {stats.bySource.map((s) => (
              <Badge key={s.key} tone={s.key === "none" ? "orange" : s.key === "rule" ? "gold" : "neutral"}>
                {SOURCE_LABELS[s.key] ?? s.key}: {s.lots}
              </Badge>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-sm font-semibold text-[var(--admin-text)]">Sources behind the suggestions</p>
          <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
            Each suggestion is the longest room-temperature storage time the cited data shows a product still stable, or losing no more than about a
            fifth of its potency. &quot;Measured&quot; means a study covered that product; &quot;judgment&quot; means the closest evidence, read
            conservatively.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {EXPIRY_CITATIONS.map((c) => (
              <li key={c.key}>
                <a href={c.url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--admin-text)] underline">
                  {c.title}
                </a>{" "}
                <span className="text-xs text-[var(--admin-text-faint)]">
                  {c.publisher} &middot; {c.kind}
                </span>
                <p className="text-xs text-[var(--admin-text-muted)]">{c.finding}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Per-rule preview link (a GET to the preview, scoped to one rule). */
function PreviewOne({ ruleId, disabled }: { ruleId: string; disabled: boolean }) {
  if (disabled) return null;
  return (
    <Link
      href={`/admin/inventory/expiration-rules?preview=1&rule=${encodeURIComponent(ruleId)}`}
      className="whitespace-nowrap text-xs text-[var(--admin-orange)] underline"
    >
      Preview this rule
    </Link>
  );
}
