/**
 * src/components/loyalty/LoyaltyProgramTerms.tsx
 *
 * PUBLIC program-terms section for /loyalty (Task T / PR 3). Server component:
 * the page passes in the LIVE loyalty config + tier ladder from
 * `@/lib/loyalty/loyalty-store`, and this renders the same numbers the
 * register pays with — the back office is the single source of truth.
 */
import Link from "next/link";
import type { LoyaltyTermsSummary, TierDisplayRow } from "@/lib/loyalty/program-terms-core";

type LoyaltyProgramTermsProps = {
  terms: LoyaltyTermsSummary;
  tiers: TierDisplayRow[];
};

export function LoyaltyProgramTerms({ terms, tiers }: LoyaltyProgramTermsProps) {
  const bullets = [
    terms.earnLine,
    terms.valueLine,
    terms.redeemLine,
    ...(terms.signupBonusLine ? [terms.signupBonusLine] : []),
    ...(terms.expiryLine ? [terms.expiryLine] : []),
  ];

  return (
    <section aria-labelledby="loyalty-terms-heading" className="relative bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 pb-10 md:px-8 md:pb-16">
        <article className="rounded-[1.45rem] border border-white/10 bg-zinc-950/88 p-5 shadow-2xl shadow-black/40 md:rounded-[2.2rem] md:p-9 lg:p-11">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-[var(--gold)] md:text-xs">
            How Greenway Points work
          </p>
          <h2
            id="loyalty-terms-heading"
            className="mt-3 text-3xl font-black uppercase leading-[0.95] tracking-tight text-[var(--orange)] md:text-5xl"
          >
            Program terms
          </h2>

          <div className="mt-5 space-y-3 md:mt-7">
            {bullets.map((line) => (
              <p key={line} className="text-sm leading-7 text-zinc-200 md:text-base md:leading-8">
                <span className="mr-2 text-[var(--orange)]">–</span>
                {line}
              </p>
            ))}
          </div>

          {tiers.length > 0 ? (
            <div className="mt-7 md:mt-9">
              <h3 className="text-xl font-black text-white md:text-2xl">Member tiers</h3>
              <div className="mt-4 overflow-hidden rounded-xl border border-white/12">
                <table className="w-full text-left text-sm md:text-base">
                  <thead>
                    <tr className="border-b border-white/12 bg-white/[0.04] text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-400 md:text-xs">
                      <th scope="col" className="px-4 py-3">Tier</th>
                      <th scope="col" className="px-4 py-3">Lifetime points</th>
                      <th scope="col" className="px-4 py-3">Perk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((tier) => (
                      <tr key={tier.name} className="border-b border-white/8 last:border-b-0">
                        <td className="px-4 py-3 font-black text-white">{tier.name}</td>
                        <td className="px-4 py-3 font-semibold text-zinc-300">{tier.thresholdLabel}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--greenway)]">
                          {tier.perkLabel || "Member perks"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="mt-6 text-xs leading-6 text-zinc-500 md:text-sm md:leading-7">
            Points accrue on the pre-tax subtotal after discounts. Discounts never stack — the
            register always applies the single best deal for you. Want to see what your points are
            worth on today&apos;s cart? Open your cart and tap{" "}
            <span className="font-black text-zinc-300">&ldquo;Estimate my register total&rdquo;</span>, or{" "}
            <Link href="/menu" className="font-black text-[var(--greenway)] underline-offset-2 hover:underline">
              start shopping
            </Link>
            . Program details are set by Greenway and may change; the register total is always final.
          </p>
        </article>
      </div>
    </section>
  );
}
