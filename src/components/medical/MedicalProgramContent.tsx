/**
 * src/components/medical/MedicalProgramContent.tsx
 *
 * PUBLIC medical-cannabis program page body (Task T / PR 3). Server component.
 *
 * HONESTY RULES (grounded in the register's own compliance cores — see
 * src/lib/medical/tax.ts and docs/MEDICAL_CANNABIS_COMPLIANCE.md):
 *   - SALES tax (RCW 82.08.9998): exempt ONLY on DOH-compliant (chapter 246-70
 *     WAC) products — for carded patients/DPs, and high-CBD compliant products
 *     for ANY adult. A card alone does NOT waive sales tax on regular product.
 *   - EXCISE tax (WAC 314-55-090): exempt ONLY for carded patients buying
 *     DOH-compliant product at an endorsed store, and only while the statutory
 *     exemption window is open.
 *   - Elevated limits (WAC 314-55-095): carded patients in the database only.
 *   - NO medical/therapeutic claims anywhere (WAC 314-55-155).
 *
 * Copy in the hero/intro is CMS-editable (medical.* blocks); the statutory
 * mechanics below are fixed copy so an edit can't accidentally overpromise.
 */
import Link from "next/link";
import { SiteText } from "@/components/site/SiteText";
import { purchaseLimitRows } from "@/lib/medical/purchase-limit-display-core";

const whatToBring = [
  "A valid medical cannabis authorization form (DOH 630-236) from your healthcare practitioner — tamper-resistant original, complete and signed.",
  "Valid government-issued photo ID matching the authorization.",
  "About 15–20 minutes: our certified medical cannabis consultant verifies your form, enters you into the state database, and prints your recognition card in store.",
];

const cardBenefits = [
  "Sales tax (9.3%) waived on DOH-compliant products (chapter 246-70 WAC) — look for the medical designation on qualifying items.",
  "Excise tax (37%) waived on DOH-compliant products while the state exemption window is open — the single biggest saving on qualifying purchases.",
  "Purchase limits three times higher than recreational limits (see the table below).",
  "Ages 18–20 may purchase with a valid recognition card (recreational sales are 21+).",
];

function SectionCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-[1.45rem] border border-white/10 bg-zinc-950/88 p-5 shadow-2xl shadow-black/40 md:rounded-[2.2rem] md:p-9">
      <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-[var(--gold)] md:text-xs">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-black uppercase leading-[0.95] tracking-tight text-[var(--orange)] md:text-4xl">
        {title}
      </h2>
      {children}
    </article>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-7 text-zinc-200 md:text-base md:leading-8">
      <span className="mr-2 text-[var(--orange)]">–</span>
      {children}
    </p>
  );
}

export function MedicalProgramContent() {
  const limitRows = purchaseLimitRows();

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_84%_16%,rgba(255,127,0,0.12),transparent_20rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl space-y-6 px-4 py-7 md:space-y-8 md:px-8 md:py-14">
        <header className="text-center">
          <SiteText
            blockKey="medical.hero.title"
            as="h1"
            className="text-4xl font-black leading-none tracking-tight text-white md:text-7xl"
          />
          <SiteText
            blockKey="medical.hero.subtitle"
            as="p"
            className="mx-auto mt-4 block max-w-3xl text-sm font-semibold leading-7 text-zinc-300 md:text-lg md:leading-8"
          />
          <SiteText
            blockKey="medical.intro.body"
            as="p"
            className="mx-auto mt-4 block max-w-4xl text-sm leading-7 text-zinc-400 md:text-base md:leading-8"
          />
        </header>

        <SectionCard eyebrow="Get carded in store" title="What to bring">
          <div className="mt-5 space-y-3">
            {whatToBring.map((line) => (
              <Bullet key={line}>{line}</Bullet>
            ))}
          </div>
          <p className="mt-5 text-xs leading-6 text-zinc-500 md:text-sm md:leading-7">
            Joining the state database is voluntary and free at Greenway. Your recognition card is
            issued under Washington&apos;s Medical Cannabis Authorization Database (RCW 69.51A) and
            renews with your authorization.
          </p>
        </SectionCard>

        <SectionCard eyebrow="Recognition card perks" title="What your card gets you">
          <div className="mt-5 space-y-3">
            {cardBenefits.map((line) => (
              <Bullet key={line}>{line}</Bullet>
            ))}
          </div>
          <p className="mt-5 text-xs leading-6 text-zinc-500 md:text-sm md:leading-7">
            Honest fine print: both tax exemptions apply only to DOH-compliant products (chapter
            246-70 WAC) — a card does not remove taxes on regular recreational products. Our
            register verifies each item&apos;s compliance status at checkout so your receipt is
            always exact.
          </p>
        </SectionCard>

        <SectionCard eyebrow="No card? No problem" title="High-CBD products — tax break for everyone">
          <p className="mt-5 text-sm leading-7 text-zinc-200 md:text-base md:leading-8">
            Washington waives the 9.3% sales tax on qualifying high-CBD compliant products
            (chapter 246-70 WAC — very low THC with a high CBD ratio) for{" "}
            <span className="font-black text-white">any adult customer</span> — no card required. Look for high-CBD items on our{" "}
            <Link href="/menu" className="font-black text-[var(--greenway)] underline-offset-2 hover:underline">
              menu
            </Link>{" "}
            or ask a budtender.
          </p>
        </SectionCard>

        <SectionCard eyebrow="Carry more, shop less often" title="Purchase limits: medical vs. recreational">
          <div className="mt-5 overflow-hidden rounded-xl border border-white/12">
            <table className="w-full text-left text-sm md:text-base">
              <thead>
                <tr className="border-b border-white/12 bg-white/[0.04] text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-400 md:text-xs">
                  <th scope="col" className="px-4 py-3">Product form</th>
                  <th scope="col" className="px-4 py-3">Recreational (21+)</th>
                  <th scope="col" className="px-4 py-3">Medical (carded)</th>
                </tr>
              </thead>
              <tbody>
                {limitRows.map((row) => (
                  <tr key={row.category} className="border-b border-white/8 last:border-b-0">
                    <td className="px-4 py-3 font-black text-white">{row.category}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-300">{row.recreational}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--greenway)]">{row.medical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-zinc-500 md:text-sm md:leading-7">
            Limits per WAC 314-55-095. Medical limits apply to validly carded patients and
            designated providers in the state database.
          </p>
        </SectionCard>

        <article className="rounded-[1.45rem] border border-white/10 bg-zinc-950/88 p-5 text-center shadow-2xl shadow-black/40 md:rounded-[2.2rem] md:p-9">
          <h2 className="text-2xl font-black uppercase tracking-tight text-white md:text-3xl">
            See your savings before you visit
          </h2>
          <p className="mx-auto mt-3 max-w-3xl text-sm leading-7 text-zinc-300 md:text-base md:leading-8">
            Add products to your cart, open it, and tap{" "}
            <span className="font-black text-zinc-100">&ldquo;Estimate my register total&rdquo;</span> — then
            switch on the medical toggle for an honest estimate of your tax savings on today&apos;s cart.
          </p>
          <Link
            href="/menu"
            className="mt-5 inline-flex rounded-full bg-[var(--greenway)] px-6 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-black transition hover:bg-white"
          >
            Shop the menu
          </Link>
          <p className="mx-auto mt-6 max-w-3xl text-[0.68rem] leading-5 text-zinc-600 md:text-xs md:leading-6">
            This page describes Washington state tax and purchase-limit rules (RCW 82.08.9998, WAC
            314-55-090, WAC 314-55-095, chapter 246-70 WAC). It is not medical advice, and cannabis
            products are not represented as having curative or therapeutic effects. Final
            eligibility and totals are verified at the register.
          </p>
        </article>
      </div>
    </section>
  );
}
