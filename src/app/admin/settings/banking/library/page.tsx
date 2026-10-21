/**
 * R40 - Banking -> Legal library (/admin/settings/banking/library).
 *
 * "Be my lawyer": court cases, statutes and regulations that decide who
 * pays when an ACH payment goes wrong, each quoted word for word from the
 * court's or legislature's own site, then explained in plain English, then
 * tied to the protection Greenway already has. The quotes are generated from
 * mirrored files (scripts/r40/gen-legal-library.py) and a test proves each
 * one is a verbatim substring of its mirror.
 *
 * Owner/admin only (settings.manage). Not legal advice; the page says so.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { BankingSubnav } from "../BankingHelpTabs";
import { ACH_LEGAL_LIBRARY, type LegalEntry, type LegalEntryKind } from "@/lib/payments/ach-legal-library";
import { ACH_AUTHORITIES } from "@/lib/payments/ach-authorities";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 text-base font-semibold text-white";

const KIND: Record<LegalEntryKind, { word: string; tone: "gold" | "green" | "neutral" }> = {
  case: { word: "Court case", tone: "gold" },
  statute: { word: "Washington law", tone: "green" },
  regulation: { word: "Regulation", tone: "neutral" },
  agreement: { word: "Timberland agreement", tone: "green" },
};

/** The short list: what to do, each tied to the entries above (ids are checked by tests). */
const PROTECT: { title: string; body: string; lawIds: string[] }[] = [
  {
    title: "Use every security feature Timberland offers, especially dual approval",
    body: "Two of the four cases were lost by the business, not the bank, because the business turned down or went around a security feature the bank offered. Ask Timberland in writing what it offers, switch all of it on, and keep the answer.",
    lawIds: ["case-choice-escrow-declined-dual-control", "case-patco-one-size-fits-all", "rcw-62a-4a-202-b", "rcw-62a-4a-202-c"],
  },
  {
    title: "Only trust a phone number that has been on file for a while",
    body: "Never confirm a bank change by calling a number or replying to an email that came with the change. The vault enforces this for you with a 90-day rule.",
    lawIds: ["case-apache-call-number-on-file", "case-beau-townsend-best-position"],
  },
  {
    title: "Check the bank statement every month, and tell the bank right away about anything odd",
    body: "The law gives you a short window to object (90 days to be sure of a refund of interest, one year before the transfer becomes final). The calendar adds a monthly reminder.",
    lawIds: ["rcw-62a-4a-204-a-ninety-days", "rcw-62a-4a-505-one-year"],
  },
  {
    title: "Protect the logins like cash",
    body: "If a fraudster did not get in through your systems, the law can put the loss on the bank. If they did, it cannot. Passkeys, no shared passwords, and remove people's access the day they leave.",
    lawIds: ["rcw-62a-4a-203-a-2"],
  },
  {
    title: "Never sign away a security feature, and keep Timberland's agreement on file",
    body: "A signed waiver can move the loss to you. Keep the agreement, read its security section once a year, and show any change to your lawyer before signing.",
    lawIds: ["rcw-62a-4a-202-b", "rcw-62a-4a-202-c", "timberland-s25-liability", "timberland-schedule-f-notice"],
  },
  {
    title: "Pay wages on payday, by check if the direct deposit is not ready",
    body: "Washington requires wages to be paid on the regular payday. If a hold or a check on the account would make a deposit late, pay that person by paper check.",
    lawIds: ["wac-296-128-035-7-on-payday", "reg-e-1005-10-e-2-no-forced-bank"],
  },
  {
    title: "Ask your insurance agent about crime and social-engineering cover",
    body: "In the Apache case the business recovered from its insurer, not the bank. Whether a policy pays for a fake bank-change request depends on its wording, so ask for it in writing.",
    lawIds: ["case-apache-call-number-on-file"],
  },
];

function EntryCard({ e }: { e: LegalEntry }) {
  const k = KIND[e.kind];
  return (
    <article id={`law-${e.id}`} className={card}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={k.tone}>{k.word}</Badge>
        <span className="text-xs text-white/50">{e.court}</span>
      </div>
      <h3 className="text-base font-semibold text-white">{e.title}</h3>
      <p className="mb-3 text-xs text-white/50">{e.citation}</p>

      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">The exact words</p>
      <blockquote className="my-2 border-l-2 border-emerald-500/50 pl-3 text-sm italic text-white/80">
        &ldquo;{e.quote}&rdquo;
      </blockquote>
      <p className="mb-3 text-xs text-white/40">
        Source:{" "}
        {e.kind === "agreement" ? (
          // R41 S8: the signed agreement is private (no public URL). Never render it as a link.
          <span data-private-source>{e.source.replace(/^private:\s*/, "")}. The repository mirror is {e.sourceFile}.</span>
        ) : (
          <a href={e.source} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/70">{e.source}</a>
        )}
      </p>

      {e.whatHappened ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/50">What happened</p>
          <p className="mb-3 text-sm text-white/80">{e.whatHappened}</p>
        </>
      ) : null}
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">In plain English</p>
      <p className="mb-3 text-sm text-white/80">{e.plainEnglish}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300/80">How Greenway protects you</p>
      <p className="mb-2 text-sm text-white/80">{e.howWeProtectYou}</p>
      <Link href={e.appLink} className="text-xs font-semibold text-emerald-300 hover:underline">See it in the back office →</Link>
    </article>
  );
}

export default async function AchLegalLibraryPage() {
  await requirePermission("settings.manage");
  const cases = ACH_LEGAL_LIBRARY.filter((e) => e.kind === "case");
  const laws = ACH_LEGAL_LIBRARY.filter((e) => e.kind !== "case" && e.kind !== "agreement");
  const agreement = ACH_LEGAL_LIBRARY.filter((e) => e.kind === "agreement");
  const title = (id: string) => ACH_LEGAL_LIBRARY.find((l) => l.id === id)?.title ?? id;

  return (
    <div>
      <AdminPageHeader
        title="Legal library"
        subtitle="The court cases and laws behind Greenway's ACH rules: the exact words, in plain English, and how to protect the business."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Legal library" }]} />}
        help={
          <HelpPanel
            id="ach-library"
            title="How to read this page"
            steps={[
              "Start with \"Protect your business\": seven things to do, each linked to the case or law that backs it.",
              "Each case or law shows the exact words from the court or legislature's own website, then what happened, then plain English.",
              "\"How Greenway protects you\" says what the software already does, with a link to where.",
              "Use the source link to read the original. If something here looks wrong, trust the source.",
              "\"Your Timberland agreement\" quotes the contract Greenway signed: liability, indemnity, cancellations, reversals, account numbers, the 30-day statement rule and Schedule F.",
            ]}
          >
            <p>This is education, not legal advice. Take anything that affects a real decision to a Washington business lawyer.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        <BankingSubnav active="library" />

        <p role="note" className="rounded-[var(--admin-radius)] border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
          <span className="font-semibold">Not legal advice.</span> I am software, not a lawyer. These are real, public sources quoted word for word, with a plain-English reading. Courts decide cases on their own facts, and laws change. For a real dispute or before signing anything with the bank, ask a Washington business lawyer.
        </p>

        <section id="protect" className={card}>
          <h2 className={h2}>Protect your business: seven things to do</h2>
          <ol className="space-y-4">
            {PROTECT.map((p, i) => (
              <li key={i} className="text-sm text-white/85">
                <p className="font-semibold text-white">{i + 1}. {p.title}</p>
                <p className="text-white/70">{p.body}</p>
                <p className="mt-1 text-xs text-white/50">
                  Backed by:{" "}
                  {p.lawIds.map((id, j) => (
                    <span key={id}>{j ? ", " : ""}<a href={`#law-${id}`} className="text-emerald-300 hover:underline">{title(id)}</a></span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm">
            <Link href="/admin/settings/banking/calendar" className="font-semibold text-emerald-300 hover:underline">Reminders for all of this are in the Calendar tab →</Link>
          </p>
        </section>

        <section id="cases" className="space-y-4">
          <h2 className="text-base font-semibold text-white">Court cases ({cases.length})</h2>
          {cases.map((e) => <EntryCard key={e.id} e={e} />)}
        </section>

        <section id="laws" className="space-y-4">
          <h2 className="text-base font-semibold text-white">Laws and regulations ({laws.length})</h2>
          {laws.map((e) => <EntryCard key={e.id} e={e} />)}
        </section>

        <section id="timberland" className="space-y-4">
          <h2 className="text-base font-semibold text-white">Your Timberland agreement: the parts that matter most ({agreement.length})</h2>
          <p className="text-sm text-white/70">
            Word for word from the ACH Origination Agreement, signed by Greenway on 10/13/26 and countersigned by Timberland on 10/14/26. The signed PDF is kept by Michael, not on the website. The
            text here comes from a redacted copy with the PDF&apos;s fingerprint (SHA-256), so anyone with the PDF can prove it matches. Section 28 lets
            Timberland change the agreement by notice, so the Calendar has a yearly task to re-read it.
          </p>
          {agreement.map((e) => <EntryCard key={e.id} e={e} />)}
        </section>

        <section id="more-sources" className={card}>
          <h2 className={h2}>More sources the software is built on ({ACH_AUTHORITIES.length})</h2>
          <p className="mb-3 text-sm text-white/60">Nacha rules, bank guidance and Washington State Auditor advice, each quoted word for word.</p>
          <div className="space-y-2">
            {ACH_AUTHORITIES.map((a) => (
              <details key={a.id} id={`src-${a.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-white/90">{a.citation}</summary>
                <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 italic text-white/70">&ldquo;{a.quote}&rdquo;</blockquote>
                <p className="text-white/80"><span className="font-semibold">What it means here:</span> {a.whatItMeansHere}</p>
                <p className="mt-1 text-xs text-white/40">
                  Source: <a href={a.source} target="_blank" rel="noopener noreferrer" className="underline">{a.source}</a>
                </p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
