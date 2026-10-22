/**
 * /admin/settings/banking/policies   (R41 S18)
 *
 * Greenway's written ACH policies, each with the reason in the source's own
 * words (WA State Auditor ACH guide; Timberland ACH agreement), plus three
 * owner sign-offs kept forever in migration 0291 (ach_control_records):
 *   - adopt the policies for the year (re-adopt when the wording changes);
 *   - the quarterly ACH access review (who holds owner or admin);
 *   - the yearly key checks (token, logins, passkeys, encryption key, ...).
 * A printable packet is at policies/packet.
 *
 * Owner or admin can open the page (settings.manage); only the owner records
 * (ach.act, in policies-actions.ts).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, InfoHint } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { pacificToday } from "@/lib/reports/timezone";
import {
  ACH_POLICIES,
  KEY_ITEMS,
  POLICY_QUOTES,
  STALE_LOGIN_DAYS,
  TIMBERLAND_PHONE,
  buildAccessReport,
  controlStatus,
  policyTextFingerprint,
  previousQuarterKey,
  type PolicyQuoteId,
} from "@/lib/payments/ach-policies-core";
import { readControlRecords, readStaffLite } from "@/lib/payments/ach-policies-store";
import { BankingSubnav } from "../BankingHelpTabs";
import { recordControlAction } from "../policies-actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const h2 = "mb-3 flex items-center gap-2 text-base font-semibold text-white";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]";
const inputCls =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

function Quote({ id }: { id: PolicyQuoteId }) {
  const q = POLICY_QUOTES[id];
  return (
    <blockquote className="my-2 border-l-2 border-emerald-500/40 pl-3 text-sm italic text-white/70">
      &ldquo;{q.text}&rdquo;
      <span className="mt-1 block text-xs not-italic text-white/40">
        {q.where}. Verbatim, mirrored at docs/authorities/{q.file}
      </span>
    </blockquote>
  );
}

function OwnerForm({ kind, children, button }: { kind: string; children?: React.ReactNode; button: string }) {
  return (
    <form action={recordControlAction} className="mt-3 space-y-3 text-sm">
      <input type="hidden" name="kind" value={kind} />
      {children}
      <label className="block">
        <span className="text-white/70">What you looked at (no account numbers)</span>
        <textarea name="summary" required minLength={10} maxLength={2000} rows={2} className={inputCls} />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" value="1" required className="mt-1" />
        <span className="text-white/80">I did this check myself today.</span>
      </label>
      <button className={btnPrimary}>{button}</button>
    </form>
  );
}

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const session = await requirePermission("settings.manage");
  const sp = await searchParams;
  const today = pacificToday();
  const year = today.slice(0, 4);
  const isOwner = can(session.profile.role, "ach.act");
  const [records, staff] = await Promise.all([readControlRecords(), readStaffLite()]);
  const fp = policyTextFingerprint();
  const access = staff.ok ? buildAccessReport(staff.rows, today) : null;
  const st = records.ok && access ? controlStatus(records.rows, today, fp, access.fingerprint) : null;
  const nameOf = (id: string) => {
    const s = staff.ok ? staff.rows.find((x) => x.id === id) : undefined;
    return (s?.full_name ?? "").trim() || s?.email || "Unknown staff";
  };
  const canRecord = isOwner && records.ok;

  return (
    <div>
      <AdminPageHeader
        title="Written ACH policies"
        subtitle="What Greenway does with ACH, and why, in writing. Adopt them once a year, review who has access each quarter, and check the keys once a year."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Policies" }]} />}
        help={
          <HelpPanel
            id="ach-policies"
            title="What this page is for"
            steps={[
              "The WA State Auditor's ACH guide starts with: write down your ACH policy. These eight policies are Greenway's, and each one shows the source sentence it answers.",
              "Michael reads them and adopts them for the year. If the wording ever changes, the page asks him to re-adopt.",
              "Every quarter Michael looks at who holds owner or admin (the people who can touch ACH) and records that the list is right.",
              "Once a year he checks each key (Timberland token, logins, passkeys, the encryption key backup, the banking computer) and records it. Print the packet for the banking file.",
            ]}
          >
            <p>Stephen can read the page and print the packet. Only Michael records: these are the owner&apos;s sign-offs. Records are kept forever and never changed.</p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BankingSubnav active="policies" badge={st && st.todo.length ? { policies: String(st.todo.length) } : undefined} />
        {sp.msg ? <p className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</p> : null}
        {sp.error ? <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</p> : null}

        <section id="top" className={card} aria-label="Status">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-white">Status for {year}</h2>
            <a href="/admin/settings/banking/policies/packet" target="_blank" rel="noopener" className={`${btnGhost} ml-auto`}>
              Print the policy packet &#8599;
            </a>
          </div>
          {!records.ok ? (
            <p role="alert" className="mt-2 text-sm text-red-300">{records.error}</p>
          ) : !staff.ok ? (
            <p role="alert" className="mt-2 text-sm text-red-300">{staff.error}</p>
          ) : st && st.todo.length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-emerald-300">&#10003; Policies adopted, access reviewed this quarter, every key checked this year.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-200">
              {st?.todo.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <p className="mt-3 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.05] px-3 py-2 text-sm text-red-200">
            Something wrong (lost token, a login someone else may know, a payment that went astray)? Call Timberland now on <strong>{TIMBERLAND_PHONE}</strong>, then confirm in writing within 1 calendar day.
            <InfoHint text="Timberland's Schedule F: tell the bank by phone immediately, then in writing within 1 calendar day. Schedule G: report a lost, stolen or broken token at once." />
          </p>
        </section>

        <section id="policies" className={card}>
          <h2 className={h2}>
            The policies
            <InfoHint text="Each policy says what Greenway does. Under it, 'Why' quotes the source word for word. Links go to where the back office does it." />
          </h2>
          <div className="space-y-4">
            {ACH_POLICIES.map((p) => (
              <article key={p.id} id={`policy-${p.id}`} className="rounded-[var(--admin-radius)] border border-white/10 p-3">
                <h3 className="mb-1 flex items-center gap-2 font-semibold text-white">
                  {p.title}
                  <InfoHint text={p.hint} />
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-white/85">
                  {p.rules.map((r) => <li key={r}>{r}</li>)}
                </ul>
                {p.ownerProcedure ? <p className="mt-2 text-xs text-white/50">{p.ownerProcedure}</p> : null}
                {p.why.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-emerald-300">Why (the source&apos;s own words)</summary>
                    {p.why.map((q) => <Quote key={q} id={q} />)}
                  </details>
                ) : null}
                {p.links.length ? (
                  <p className="mt-2 flex flex-wrap gap-3 text-xs">
                    {p.links.map((l) => (
                      <Link key={l.href} href={l.href} className="font-semibold text-emerald-300 hover:underline">{l.label} &rarr;</Link>
                    ))}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section id="adopt" className={card}>
          <h2 className={h2}>
            Adopt the policies for {year}
            <InfoHint text="Adopting stores your name, today's date and a fingerprint of the exact wording above. If the wording changes later, the page shows that your adoption no longer covers it." />
          </h2>
          {st?.adoption.current ? (
            <p className={`text-sm ${st.adoption.textChanged ? "text-amber-200" : "text-emerald-300"}`}>
              {st.adoption.textChanged ? "The wording changed after you adopted it. " : "\u2713 "}
              Adopted {st.adoption.current.recorded_on} by {nameOf(st.adoption.current.created_by)}: {st.adoption.current.summary}
            </p>
          ) : (
            <p className="text-sm text-amber-200">Not adopted yet for {year}.</p>
          )}
          {canRecord ? <OwnerForm kind="policy_adoption" button={st?.adoption.current ? `Adopt again for ${year}` : `Adopt for ${year}`} /> : <p className="mt-2 text-xs text-white/50">Only Michael (the owner) adopts the policies.</p>}
        </section>

        <section id="access" className={card}>
          <h2 className={h2}>
            Quarterly ACH access review ({st?.access.quarterKey ?? ""})
            <InfoHint text={`The State Auditor asks for a yearly look at who can initiate and approve ACH. Greenway does it every quarter. A person who has not signed in for ${STALE_LOGIN_DAYS} days is flagged.`} />
          </h2>
          <Quote id="saoReviewPeople" />
          {access ? (
            <>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-white/50">
                  <tr><th className="py-1">Person</th><th>Role</th><th>Last sign-in</th><th>What they can do with ACH</th></tr>
                </thead>
                <tbody>
                  {access.people.map((p) => (
                    <tr key={p.id} className="border-t border-white/5 align-top text-white/85">
                      <td className="py-1">{p.who}{p.active ? "" : " (switched off)"}</td>
                      <td><Badge tone={p.role === "owner" ? "gold" : "neutral"}>{p.role}</Badge></td>
                      <td>{p.lastLogin ? `${p.lastLogin.slice(0, 10)} (${p.daysSinceLogin} days)` : "never"}</td>
                      <td className="text-xs">{p.powers.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {access.findings.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {access.findings.map((f) => <li key={f.text} className={f.level === "warn" ? "text-amber-200" : "text-white/60"}>{f.level === "warn" ? "Check: " : "Note: "}{f.text}</li>)}
                </ul>
              ) : <p className="mt-2 text-sm text-emerald-300">&#10003; Nothing to check in the list.</p>}
            </>
          ) : null}
          {st?.access.thisQuarter ? (
            <p className={`mt-2 text-sm ${st.access.listChanged ? "text-amber-200" : "text-emerald-300"}`}>
              {st.access.listChanged ? "The list changed after this review. " : "\u2713 "}Reviewed {st.access.thisQuarter.recorded_on} by {nameOf(st.access.thisQuarter.created_by)}: {st.access.thisQuarter.summary}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-200">Not reviewed yet this quarter.{st?.access.lastQuarter ? ` Last quarter: ${st.access.lastQuarter.recorded_on}.` : ""}</p>
          )}
          {canRecord && st ? (
            <OwnerForm kind="access_review" button="Record the access review">
              <label className="flex flex-col gap-1">
                <span className="text-white/70">Quarter</span>
                <select name="period_key" defaultValue={st.access.quarterKey} className={inputCls}>
                  <option value={st.access.quarterKey}>{st.access.quarterKey} (this quarter)</option>
                  <option value={previousQuarterKey(st.access.quarterKey)}>{previousQuarterKey(st.access.quarterKey)} (last quarter, recorded late)</option>
                </select>
              </label>
            </OwnerForm>
          ) : null}
        </section>

        <section id="keys" className={card}>
          <h2 className={h2}>
            Yearly key checks ({year})
            <InfoHint text="One check per item per year. 'Last changed' is optional: when you last changed that password or replaced that device, so the page can show how old it is." />
          </h2>
          <Quote id="tbCredentials" />
          <ul className="space-y-2 text-sm">
            {(st?.keys ?? KEY_ITEMS.map((item) => ({ item, latest: null, checkedThisYear: false, ageDays: null }))).map((k) => (
              <li key={k.item.id} className="rounded-[var(--admin-radius)] border border-white/10 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{k.item.label}</span>
                  <InfoHint text={`What to check: ${k.item.check} Why: "${POLICY_QUOTES[k.item.why].text}"`} />
                  {k.checkedThisYear ? <Badge tone="green">checked</Badge> : <Badge tone="gold">due</Badge>}
                </div>
                <p className="text-xs text-white/60">
                  {k.latest ? `Last check ${k.latest.recorded_on} by ${nameOf(k.latest.created_by)}.` : "Never checked."}
                  {k.ageDays !== null ? ` Last changed ${k.ageDays} days ago.` : ""}
                </p>
              </li>
            ))}
          </ul>
          {canRecord ? (
            <OwnerForm kind="key_check" button="Record the key check">
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-white/70">Which key</span>
                  <select name="item" className={inputCls} defaultValue={st?.keys.find((k) => !k.checkedThisYear)?.item.id ?? KEY_ITEMS[0].id}>
                    {KEY_ITEMS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-white/70">Last changed (optional)</span>
                  <input type="date" name="item_set_on" max={today} className={inputCls} />
                </label>
              </div>
            </OwnerForm>
          ) : null}
        </section>
      </div>
    </div>
  );
}
