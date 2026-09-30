import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { CHIP_ACTION } from "@/components/admin/ui";
import { getImport } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { loadStrainFixPlan } from "@/lib/pos/cultivera-strain-fix-store";
import { nameHintBulkGroups, type StrainFixGroup, type StrainFixKind } from "@/lib/pos/cultivera-strain-fix-core";
import { strainTypeDefinitions, strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import { applyKbExactStrainsAction, applyNameHintStrainsAction, applyStrainChoiceAction } from "../../fix-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KIND_TITLE: Record<StrainFixKind, string> = {
  kb_exact: "Exact Knowledge Base match — safe to apply in one press",
  kb_confirm: "Close Knowledge Base match — confirm each one",
  kb_no_type: "In the Knowledge Base without a type — pick one",
  no_match: "Not in the Knowledge Base — pick a type (optionally add the strain)",
};

const TYPE_OPTIONS = strainTypeDefinitions.filter((d) => d.value !== "unknown");

/**
 * R16: a Cultivera "strain" that is only a type word (seen on the real export:
 * Loconut topicals filed with strain "Hybrid" / "Sativa" / "Indica"). It is not
 * a strain, so it must never be added to the Strain library as one.
 */
const TYPE_WORD_STRAINS = new Set(["hybrid", "sativa", "indica", "cbd", "sativa hybrid", "indica hybrid", "sativa dominant", "indica dominant"]);
function isTypeWordStrain(key: string): boolean {
  return TYPE_WORD_STRAINS.has(key.trim().toLowerCase());
}

/**
 * R15b — unknown strain types, fixed from the Knowledge Base.
 * Owner, Round 15: "compare the strains in the cultivera list with the
 * strains we have confirmed and add the kb strain facts ... to the cultivera
 * products without strain types." See cultivera-strain-fix-core.ts.
 */
export default async function ImportStrainsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string; show?: string; back?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await getImport(id);
  if (!imp) notFound();
  const canFix = can(session.profile.role, "inventory.manage");
  const { plan, versionFound } = await loadStrainFixPlan(id);
  const showAll = sp.show === "all";
  const LIMIT = 150;
  const exact = plan.groups.filter((g) => g.kind === "kb_exact");
  const exactCards = exact.reduce((n, g) => n + g.count, 0);
  const hinted = nameHintBulkGroups(plan).filter((g) => g.nameHintIds.length > 0);
  const hintedCards = hinted.reduce((n, g) => n + g.nameHintIds.length, 0);
  const rest = plan.groups.filter((g) => g.kind !== "kb_exact");
  const visibleRest = showAll ? rest : rest.slice(0, LIMIT);

  return (
    <div>
      <AdminPageHeader
        title="Strain types from the Knowledge Base"
        subtitle={`Import ${formatDateTime(imp.created_at)} · cards whose Cultivera strain type was blank or unknown`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Import review
          </BackLink>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.done && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.done}
          </div>
        )}
        {sp.error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">{sp.error}</div>
        )}
        {!versionFound && (
          <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            This import has no menu version yet, so there is nothing to fix here.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Cards with no strain type" value={plan.unknownCards} hint={`${plan.groups.length} distinct strain names`} accent="orange" />
          <StatCard label="Exact KB matches" value={plan.counts.kb_exact} hint={`${exactCards} cards, one press`} accent="green" />
          <StatCard label="Need a confirm or pick" value={plan.counts.kb_confirm + plan.counts.kb_no_type + plan.counts.no_match} hint="one at a time" accent="gold" />
          <StatCard label="No strain name at all" value={plan.noStrainName} hint="set on the lot page" accent="muted" />
        </div>

        <p className="max-w-3xl text-xs text-white/50">
          Matching uses the same strain matcher as receiving: exact name, then alias, then a contained name, then close
          spelling. Only exact and alias matches with a curated type are applied in bulk — a contained match can be a
          different strain (&ldquo;Watermelon Sugar&rdquo; is not &ldquo;Watermelon&rdquo;), so those wait for your press.
          Every write fills a blank type only; a type someone already set is never overwritten. The cards&apos; lots get the
          same type, and saving to the Strain library makes the next import match on its own.
        </p>

        {exact.length > 0 && (
          <section className="rounded-xl border border-[var(--admin-accent)]/30 bg-[#0a0a0a] p-5" data-testid="strain-fix-exact">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">{KIND_TITLE.kb_exact}</h2>
              {canFix && (
                <form action={applyKbExactStrainsAction}>
                  <input type="hidden" name="importId" value={id} />
                  <button type="submit" className="rounded-full bg-[var(--admin-accent)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90" data-testid="strain-fix-apply-exact">
                    Apply {exact.length} Knowledge Base type{exact.length === 1 ? "" : "s"} to {exactCards} card{exactCards === 1 ? "" : "s"}
                  </button>
                </form>
              )}
            </div>
            <ul className="mt-3 grid gap-1 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-3">
              {exact.slice(0, 60).map((g) => (
                <li key={g.key} className="truncate">
                  {g.strainName} → <strong className="text-white">{strainTypeLabel(g.best?.type)}</strong>
                  <span className="text-white/40"> ×{g.count}{g.best?.method === "alias" ? ` · alias of ${g.best.name}` : ""}</span>
                </li>
              ))}
              {exact.length > 60 && <li className="text-white/40">+{exact.length - 60} more in the same press</li>}
            </ul>
          </section>
        )}

        {hinted.length > 0 && (
          <section className="rounded-xl border border-[var(--admin-gold,#d4a843)]/30 bg-[#0a0a0a] p-5" data-testid="strain-fix-name-hint">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">The product name states the type — one press</h2>
                <p className="mt-1 max-w-2xl text-xs text-white/50">
                  These strains are not an exact Knowledge Base match, but the product names carry an explicit type code
                  (like &ldquo;(I)&rdquo; or &ldquo;Sativa&rdquo;), every coded card agrees, and no Knowledge Base
                  candidate says otherwise. Only the cards whose own name carries the code are set; the rest stay below
                  for a per-strain pick. Nothing is added to the Strain library from a name code.
                </p>
              </div>
              {canFix && (
                <form action={applyNameHintStrainsAction}>
                  <input type="hidden" name="importId" value={id} />
                  <button type="submit" className="rounded-full border border-[var(--admin-accent)] px-4 py-2 text-xs font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/10" data-testid="strain-fix-apply-name-hint">
                    Apply the name code to {hintedCards} card{hintedCards === 1 ? "" : "s"} ({hinted.length} strain{hinted.length === 1 ? "" : "s"})
                  </button>
                </form>
              )}
            </div>
            <ul className="mt-3 grid gap-1 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-3">
              {hinted.slice(0, 60).map((g) => (
                <li key={g.key} className="truncate" title={g.sampleNames.join(" · ")}>
                  {g.strainName} → <strong className="text-white">{strainTypeLabel(g.nameHint!.value)}</strong>
                  <span className="text-white/40"> ×{g.nameHintIds.length}{g.nameHintIds.length < g.count ? ` of ${g.count}` : ""} · {g.nameHint!.evidence}</span>
                </li>
              ))}
              {hinted.length > 60 && <li className="text-white/40">+{hinted.length - 60} more in the same press</li>}
            </ul>
          </section>
        )}

        {rest.length > 0 && (
          <section className="space-y-2" data-testid="strain-fix-rest">
            <h2 className="text-sm font-semibold text-white">One at a time ({rest.length})</h2>
            {visibleRest.map((g) => (
              <StrainRow key={g.key} g={g} importId={id} canFix={canFix} />
            ))}
            {!showAll && rest.length > LIMIT && (
              <Link href={`/admin/menu-imports/${id}/strains?show=all`} className={CHIP_ACTION}>
                Show all {rest.length} →
              </Link>
            )}
          </section>
        )}

        {plan.groups.length === 0 && versionFound && (
          <p className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center text-sm text-white/70">
            Every card with a strain name has a strain type. Nothing to fix.
          </p>
        )}
      </div>
    </div>
  );
}

function StrainRow({ g, importId, canFix }: { g: StrainFixGroup; importId: string; canFix: boolean }) {
  const typeWord = isTypeWordStrain(g.key);
  const preset = g.best?.type ?? g.nameHint?.value ?? (typeWord ? canonicalTypeWord(g.key) : "");
  return (
    <div className="rounded-lg border border-white/10 bg-[#0a0a0a] px-4 py-3 text-xs" data-testid="strain-fix-row" data-kind={g.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <strong className="text-sm text-white">{g.strainName}</strong>
          <span className="ml-2 text-white/40">×{g.count} · {KIND_TITLE[g.kind].split(" — ")[0]}</span>
        </span>
        <span className="truncate text-white/40">{g.sampleNames.join(" · ")}</span>
      </div>
      {g.nameHint && (
        <p className="mt-1 text-white/50">Product name says {strainTypeLabel(g.nameHint.value)} ({g.nameHint.evidence}).</p>
      )}
      {typeWord && (
        <p className="mt-1 text-orange-200/80" data-testid="strain-fix-type-word">
          Cultivera filed &ldquo;{g.strainName}&rdquo; as the strain name — that is a type, not a strain. Setting the
          type here is fine; the Strain library box is unticked so it is not added as a strain.
        </p>
      )}
      {canFix && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {g.candidates.map((c) => (
            <form key={c.slug} action={applyStrainChoiceAction}>
              <input type="hidden" name="importId" value={importId} />
              <input type="hidden" name="key" value={g.key} />
              <input type="hidden" name="kbSlug" value={c.slug} />
              <input type="hidden" name="strainType" value={c.type ?? ""} />
              <button type="submit" className={CHIP_ACTION} title={c.reason} data-testid="strain-fix-confirm">
                It&apos;s {c.name} → {strainTypeLabel(c.type)} ({Math.round(c.score * 100)}%)
              </button>
            </form>
          ))}
          <form action={applyStrainChoiceAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="importId" value={importId} />
            <input type="hidden" name="key" value={g.key} />
            {g.kind === "kb_no_type" && g.best && <input type="hidden" name="kbSlug" value={g.best.slug} />}
            <select name="strainType" defaultValue={preset} className="rounded border border-white/15 bg-black px-2 py-1 text-xs text-white">
              <option value="">Pick a type…</option>
              {TYPE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-white/60">
              <input type="checkbox" name="saveToKb" value="1" defaultChecked={!typeWord} />
              {g.kind === "kb_no_type" ? "save to the Strain library" : "add to the Strain library"}
            </label>
            <button type="submit" className={CHIP_ACTION} data-testid="strain-fix-pick">Set type</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** "Indica" → "indica" etc. Only for the exact type-word strain names above; else "". */
function canonicalTypeWord(key: string): string {
  const k = key.trim().toLowerCase();
  return TYPE_OPTIONS.some((d) => d.value === k) ? k : "";
}
