/**
 * /admin/settings/banking/bank-setup   (R41 S19)
 *
 * The bank-side checklist for the owner's meeting with Brenda (Timberland
 * Cash Management): what is already confirmed in her own words, what to ask
 * (testing, the release code, an ACH debit block, an ACH filter, the Fed
 * notice email) and what the owner decides (dual approval). Then the sourced
 * ACH glossary, each term with plain words and the source's own definition.
 *
 * Pure page: no database reads, no writes. The printable sheet is at
 * bank-setup/sheet. Owner or admin (settings.manage).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, InfoHint } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import {
  ACH_GLOSSARY,
  SETUP_QUOTES,
  TIMBERLAND_PHONE,
  checklistCounts,
  meetingOrder,
  statusLabel,
  type ChecklistStatus,
  type SetupQuoteId,
} from "@/lib/payments/ach-bank-setup-core";
import { BankingSubnav } from "../BankingHelpTabs";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 flex items-center gap-2 text-base font-semibold text-white";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";

const TONE: Record<ChecklistStatus, "orange" | "gold" | "green"> = { ask: "orange", decide: "gold", confirmed: "green" };

const STATUS_HINT: Record<ChecklistStatus, string> = {
  ask: "Not answered on record yet. Ask Brenda at the meeting and write her answer on the printed sheet.",
  decide: "Brenda has answered; the choice is the owner's.",
  confirmed: "Settled in Brenda's or the agreement's own words. Nothing left to ask.",
};

function Quote({ id, label }: { id: SetupQuoteId; label: string }) {
  const q = SETUP_QUOTES[id];
  return (
    <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
      <span className="mr-1 text-xs font-semibold not-italic text-white/50">{label}:</span>&ldquo;{q.text}&rdquo;
      <span className="mt-1 block text-xs not-italic text-white/40">
        {q.where}. Verbatim, mirrored at docs/authorities/{q.file}
      </span>
    </blockquote>
  );
}

export default async function BankSetupPage() {
  await requirePermission("settings.manage");
  const today = pacificToday();
  const counts = checklistCounts();
  const items = meetingOrder();

  return (
    <div>
      <AdminPageHeader
        title="Bank setup checklist"
        subtitle="Everything to settle with Timberland Cash Management, in one list: what is confirmed, what to ask, what you decide. Plus a glossary of ACH words."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Bank setup" }]} />}
        help={
          <HelpPanel
            id="ach-bank-setup"
            title="How to use this before the meeting with Brenda"
            steps={[
              "Print the sheet and take it to the meeting (or have it open on the call). The questions come first.",
              "Each item says what is on record, in Brenda's or the agreement's own words. Nothing is guessed: if it is not on record, it is a question.",
              "Write Brenda's answers on the sheet. Send them to your developer, who adds them to the record and moves the item to Confirmed.",
              "Dual approval is your decision: it is safer, but a second person needs their own Timberland login to approve each file.",
            ]}
          >
            <p>This page reads nothing from the database and changes nothing. It is a meeting aid.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="banksetup" badge={counts.ask ? { banksetup: String(counts.ask) } : undefined} />

        <section className={card} aria-label="Summary">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-white">Where things stand ({today})</h2>
            <Badge tone="orange">{counts.ask} to ask</Badge>
            <Badge tone="gold">{counts.decide} you decide</Badge>
            <Badge tone="green">{counts.confirmed} confirmed</Badge>
            <a href="/admin/settings/banking/bank-setup/sheet" target="_blank" rel="noopener" className={`${btnGhost} ml-auto`}>
              Print the meeting sheet &#8599;
            </a>
          </div>
          <p className="mt-3 text-sm text-white/70">
            Timberland Bank: <strong>{TIMBERLAND_PHONE}</strong>
            <InfoHint text="The number published in the Timberland agreement (Schedule G). Use it for a lost token or phone, a reversal, or anything urgent." />
          </p>
        </section>

        <section id="checklist" className={card}>
          <h2 className={h2}>
            The checklist
            <InfoHint text="Questions first, then your decisions, then what is already settled. 'Said' is Brenda's or the agreement's own words; 'Why' is the reason from the source." />
          </h2>
          <ol className="space-y-4">
            {items.map((it, n) => (
              <li key={it.id} id={`item-${it.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3">
                <h3 className="mb-1 flex flex-wrap items-center gap-2 font-semibold text-white">
                  <span className="text-white/40">{n + 1}.</span>
                  {it.title}
                  <InfoHint text={it.hint} />
                  <span className="flex items-center">
                    <Badge tone={TONE[it.status]}>{statusLabel(it.status)}</Badge>
                    <InfoHint text={STATUS_HINT[it.status]} />
                  </span>
                </h3>
                <p className="text-sm text-white/85">{it.onRecord}</p>
                {it.ask.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100">
                    {it.ask.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                ) : null}
                {it.said.length || it.why.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-emerald-300">The source&apos;s own words</summary>
                    {it.said.map((q) => <Quote key={q} id={q} label="Said" />)}
                    {it.why.map((q) => <Quote key={q} id={q} label="Why" />)}
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <section id="glossary" className={card}>
          <h2 className={h2}>
            ACH glossary
            <InfoHint text="Plain words first. Open a term to see the definition word for word from the Timberland agreement, Nacha, the Fed or the State Auditor." />
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {ACH_GLOSSARY.map((g) => (
              <div key={g.id} id={`term-${g.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3">
                <dt className="font-semibold text-white">{g.term}</dt>
                <dd className="mt-1 text-sm text-white/80">
                  {g.plain}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Source</summary>
                    <Quote id={g.source} label="Source" />
                  </details>
                  {g.href ? (
                    <Link href={g.href} className="mt-1 inline-block text-xs font-semibold text-emerald-300 hover:underline">
                      Where Greenway does it &rarr;
                    </Link>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
