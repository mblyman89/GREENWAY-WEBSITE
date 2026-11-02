/**
 * D136 — "Which sections do I need?" guide for the promotion builder.
 *
 * The owner: "there are many different sections, and it is not clear if I
 * need the top one set in addition to the ones below or if I need to do
 * something is some specific way."
 *
 * One table, driven by DEAL_TYPE_GUIDE (promotion-guide-core), says for every
 * discount type exactly which fields to fill and which to leave alone. Shown
 * on the promotions list (compact, collapsed) and at the top of the form.
 */
import { DEAL_TYPE_GUIDE, SECTION_GUIDE } from "@/lib/promotions/promotion-guide-core";

export function PromotionBuildGuide({ compact = false, open = false }: { compact?: boolean; open?: boolean }) {
  return (
    <details
      open={open}
      className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-4 text-sm"
      data-testid="promotion-build-guide"
    >
      <summary className="cursor-pointer select-none font-semibold text-sky-100">
        🧭 Which sections do I need? {compact ? "(how a promotion is built)" : "(read me first)"}
      </summary>
      <div className="mt-3 space-y-3 text-white/75">
        <p>
          Every promotion needs three things: <strong>1. What kind of deal</strong> (Discount type),{" "}
          <strong>2. When</strong> (a weekday, or start/end dates), and <strong>3. What it applies to</strong>{" "}
          (storewide, categories, brands or products). Then you fill in <strong>only the one block</strong> your
          deal type uses. Everything else is ignored, so leave it blank.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-white/45">
              <tr>
                <th className="py-1 pr-3 font-semibold">If the deal is…</th>
                <th className="py-1 pr-3 font-semibold">Pick this type</th>
                <th className="py-1 pr-3 font-semibold">Fill in</th>
                <th className="py-1 font-semibold">Leave blank</th>
              </tr>
            </thead>
            <tbody>
              {DEAL_TYPE_GUIDE.map((g) => (
                <tr key={g.type} className="border-t border-white/10 align-top">
                  <td className="py-1.5 pr-3 text-white/85">{g.example}</td>
                  <td className="py-1.5 pr-3 font-semibold text-white">{g.typeLabel}</td>
                  <td className="py-1.5 pr-3">{g.fill}</td>
                  <td className="py-1.5 text-white/50">{g.ignore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!compact && (
          <ul className="grid gap-1 sm:grid-cols-2">
            {SECTION_GUIDE.map((s) => (
              <li key={s.section} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="font-semibold text-white/90">{s.section}</span>{" "}
                <span className="text-[11px] uppercase tracking-wide text-white/40">{s.need}</span>
                <span className="mt-0.5 block text-xs text-white/60">{s.what}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-white/50">
          Deals never stack: each item gets the single best deal running. The register never charges below cost, and
          cannabis is never free. Wording is checked as you type, with warnings only, never a block.
        </p>
      </div>
    </details>
  );
}
