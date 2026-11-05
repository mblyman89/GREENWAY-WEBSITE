/**
 * GuidedCashPanel (D181, round slice S4): the cash jobs, loud and in order.
 *
 * A server component used on the admin cockpit and on Register Activity.
 * It shows, top to bottom:
 *   1. DROP NOW alerts for any open drawer over $2,000 in undropped cash;
 *   2. the morning checklist for yesterday's drawers and bag (and today's,
 *      once today has drawers that are closed);
 *   3. days that had drawers but no deposit bag;
 *   4. registers whose float drifted from $167.50 / $300.00.
 *
 * Every read that fails says so (rule 135). Nothing here is a button that
 * changes money: each line links to the screen where the job is done.
 */
import Link from "next/link";
import { addPacificDays, pacificToday } from "@/lib/reports/timezone";
import { formatCents } from "@/lib/registers/cash";
import { floatNotices, liveDropStatuses, missingBagDaysRecent, morningDutiesFor } from "@/lib/registers/guided-cash-store";
import { DROP_THRESHOLD_MINOR, missingBagSentence, type MorningDuties } from "@/lib/registers/guided-cash-core";

export async function GuidedCashPanel({ isOwner, compact = false }: { isOwner: boolean; compact?: boolean }) {
  const today = pacificToday();
  const yesterday = addPacificDays(today, -1);
  const [drops, duties, missing, floats] = await Promise.all([
    liveDropStatuses(),
    morningDutiesFor(yesterday),
    missingBagDaysRecent(14),
    floatNotices().catch(() => [] as string[]),
  ]);

  const loudDrops = drops.ok ? drops.drops.filter((d) => d.status.state === "due" || d.status.state === "unknown") : [];
  const soonDrops = drops.ok ? drops.drops.filter((d) => d.status.state === "soon") : [];
  // Missing-bag days other than yesterday (yesterday is in the checklist).
  const olderMissing = missing.ok ? missing.days.filter((d) => d !== yesterday) : [];
  const missingText = missing.ok ? missingBagSentence(olderMissing) : `Whether every day has its bag could not be checked: ${missing.error}`;
  const dutiesOpen = duties.ok && duties.duties.next !== null;
  const ownerNext = duties.ok && duties.duties.next?.who === "owner";
  const showDuties = duties.ok ? dutiesOpen && (!ownerNext || isOwner || !compact) : true;
  const nothing = loudDrops.length === 0 && soonDrops.length === 0 && !showDuties && !missingText && floats.length === 0 && drops.ok;

  if (nothing) {
    return compact ? null : (
      <div data-testid="guided-cash-clear" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        ✅ Cash is on track: no drop is due, yesterday&apos;s drawers and bag are done, and every day has its bag.
      </div>
    );
  }

  return (
    <section data-testid="guided-cash" aria-label="Cash jobs" className="space-y-3">
      {!drops.ok ? (
        <Alert tone="danger" title="Drops could not be checked">
          {drops.error}. Count the twenties in each open drawer; drop if it is over {formatCents(DROP_THRESHOLD_MINOR)}.
        </Alert>
      ) : null}
      {loudDrops.map((d) => (
        <Alert key={d.sessionId} tone="danger" title={d.status.state === "due" ? `💰 ${d.registerName}: drop now` : `${d.registerName}: drop check unknown`} testId="drop-due">
          {d.status.sentence} <Link href="/admin/registers" className="underline">Open Register Activity</Link>, or use <strong>Cash drop</strong> on the iPad.
        </Alert>
      ))}
      {soonDrops.map((d) => (
        <Alert key={d.sessionId} tone="gold" title={`${d.registerName}: a drop is coming`} testId="drop-soon">
          {d.status.sentence}
        </Alert>
      ))}

      {!duties.ok ? (
        <Alert tone="danger" title="Morning cash jobs could not be checked">
          {duties.error}. Check Register Activity and Deposit bags by hand.
        </Alert>
      ) : showDuties ? (
        <DutyList duties={duties.duties} isOwner={isOwner} />
      ) : null}

      {missingText ? (
        <Alert tone="danger" title="A day has no deposit bag" testId="guided-missing-bag">
          {missingText}{" "}
          <Link href="/admin/registers/deposit-bags" className="underline">
            Open Deposit bags
          </Link>
        </Alert>
      ) : null}

      {floats.map((f) => (
        <Alert key={f} tone="gold" title="Float setting">
          {f}
        </Alert>
      ))}
    </section>
  );
}

function DutyList({ duties, isOwner }: { duties: MorningDuties; isOwner: boolean }) {
  return (
    <div data-testid="morning-duties" className="rounded-[var(--admin-radius)] border-2 border-[var(--admin-gold)]/60 bg-[var(--admin-gold-soft)] px-4 py-3">
      <p className="text-sm font-semibold text-[var(--admin-text)]">
        ☀️ Morning cash jobs for {duties.day}
        {duties.crewOpen > 0 ? ` · ${duties.crewOpen} left for the morning crew` : " · the crew is done"}
      </p>
      <ol className="mt-2 space-y-1 text-sm">
        {duties.steps.map((s, i) => {
          const isNext = duties.next?.key === s.key;
          return (
            <li key={s.key} className={`flex items-start gap-2 ${s.done ? "text-[var(--admin-text-faint)]" : "text-[var(--admin-text)]"}`}>
              <span aria-hidden className="w-5 shrink-0 text-center">{s.done ? "✅" : isNext ? "👉" : `${i + 1}.`}</span>
              <span className={isNext ? "font-semibold" : ""}>
                {s.done ? (
                  s.text
                ) : (
                  <Link href={s.href} className="underline decoration-dotted underline-offset-2">
                    {s.text}
                  </Link>
                )}
                {!s.done && s.who === "owner" ? (
                  <span className="ml-1 text-xs text-[var(--admin-text-muted)]">{isOwner ? "(you)" : "(Michael only)"}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Alert({ tone, title, children, testId }: { tone: "danger" | "gold"; title: string; children: React.ReactNode; testId?: string }) {
  const cls =
    tone === "danger"
      ? "border-[var(--admin-danger)]/50 bg-[var(--admin-danger)]/10"
      : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]";
  return (
    <div data-testid={testId} role={tone === "danger" ? "alert" : "status"} className={`rounded-[var(--admin-radius)] border px-4 py-3 text-sm ${cls}`}>
      <p className={`font-semibold ${tone === "danger" ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]"}`}>{title}</p>
      <p className="mt-1 text-[var(--admin-text)]">{children}</p>
    </div>
  );
}
