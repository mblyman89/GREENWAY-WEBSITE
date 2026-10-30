import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge, Input } from "@/components/admin/ui";
import { CountGrid } from "@/components/admin/registers/CountGrid";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents } from "@/lib/registers/cash";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { listEmployees } from "@/lib/staffing/store";
import { backHref } from "@/lib/admin/back-link-core";
import { undeclaredBagWarning } from "@/lib/accounting/safe-bag-core";
import {
  BAG_NO_MAX_LEN,
  BAG_NOTE_MAX_LEN,
  STAGE_LABEL,
  bagStage,
  bagCashMinor,
  compareNightMorning,
  depositCashInSafeMinor,
  depositShapeNotice,
  parseBusinessDay,
  showNightFigure,
  type BagRow,
  type BagStage,
} from "@/lib/registers/deposit-bag-flow-core";
import { drawersForDay, listBags, listBagsInRange, staffNames } from "@/lib/registers/deposit-bag-store";
import { nightAssembleAction, nightCountAction, morningRecountAction, sealBagAction, retrySealPostAction, bankRunAction } from "./actions";

/**
 * /admin/registers/deposit-bags — Fix Phase 2.6 (G-04, G-14; findings F-00-6,
 * F-03-9, F-03-10). The owner's flow: night count -> morning recount -> seal
 * the bag -> safe -> bank (SOP-03 §4.5–4.14). Owner rules D21, D23–D27.
 */

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";
const HERE = `${BASE}/deposit-bags`;

const STAGE_TONE: Record<BagStage, "neutral" | "green" | "gold" | "orange" | "danger" | "outline"> = {
  night_counted: "gold",
  needs_reason: "danger",
  ready_to_seal: "green",
  sealed_in_safe: "outline",
  banked: "neutral",
  other: "neutral",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h2>
      {children}
    </section>
  );
}

function PinField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-xs text-[var(--admin-text-muted)]">
      {label}
      <Input name={name} type="password" inputMode="numeric" pattern="[0-9]*" minLength={4} maxLength={6} autoComplete="off" required placeholder="PIN" />
    </label>
  );
}

export default async function DepositBagsPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; error?: string; done?: string; day?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await requirePermission("orders.manage");
  const isOwner = canReadBooks(session.profile.role);
  const today = pacificToday();
  const crumbs = <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Deposit bags" }]} />;
  const back = (
    <Button href={backHref(BASE, sp.back)} variant="neutral">
      ← Register Activity
    </Button>
  );

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Deposit bags" subtitle="Night count, morning recount, seal, bank." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to record deposit bags." />
      </div>
    );
  }

  // Which business day the night form is for (F-03-8 pattern: a bad ?day= is an error, not today).
  const dayRes = parseBusinessDay(sp.day, today);
  const nightDay = dayRes.ok ? dayRes.day : today;
  const fromRes = parseBusinessDay(sp.from, addPacificDays(today, -30));
  const toRes = parseBusinessDay(sp.to, today);
  const logFrom = fromRes.ok ? fromRes.day : addPacificDays(today, -30);
  const logTo = toRes.ok ? toRes.day : today;
  const rangeError = !fromRes.ok ? fromRes.error : !toRes.ok ? toRes.error : logFrom > logTo ? "The log's From day is after its To day." : null;

  const [bagsRes, logRes, drawers, employees] = await Promise.all([
    listBags({ sinceDay: addPacificDays(today, -14) }),
    listBagsInRange(logFrom, logTo),
    drawersForDay(nightDay),
    listEmployees({ includeInactive: true }),
  ]);

  if (!bagsRes.ok) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Deposit bags" subtitle="Night count, morning recount, seal, bank." action={back} />
        {bagsRes.missingSchema ? (
          <EmptyState
            title="Deposit bag screen not set up yet"
            description="Apply migration 0316_deposit_bag_custody.sql in the Supabase SQL editor, then reload this page. Until then, use the paper night sheet and bag log (SOP-03 forms 8.1 and 8.2). Nothing is recorded silently."
          />
        ) : (
          <EmptyState title="The bags could not be read" description={`${bagsRes.error}. This is not the same as there being no bags; reload the page.`} />
        )}
      </div>
    );
  }

  const bags = bagsRes.bags;
  const empName = new Map(employees.map((e) => [e.id, e.full_name]));
  const nameOf = (id: string | null) => (id ? (empName.get(id) ?? "—") : "—");
  const logBags = logRes.ok ? logRes.bags : [];
  const bankers = await staffNames([...bags, ...logBags].map((b) => b.bankedBy ?? ""));
  const bankerOf = (id: string | null) => (id ? (bankers.ok ? (bankers.names.get(id) ?? "Owner") : "Owner") : "—");

  const unbanked = bags.filter((b) => !b.bankedOn);
  const waitingRecount = unbanked.filter((b) => b.status === "undeclared" && !b.sealedAt);
  const readyToSeal = unbanked.filter((b) => b.status === "counted" && !b.sealedAt);
  const sealedInSafe = unbanked.filter((b) => b.sealedAt);
  const notPosted = sealedInSafe.filter((b) => !b.sealJournalId);
  const nightBagExists = bags.some((b) => b.businessDay === nightDay);
  const olderUndeclared = waitingRecount.filter((b) => b.businessDay < today);
  const d27 = undeclaredBagWarning(olderUndeclared.map((b) => ({ bagNo: b.bagNo, status: b.status, businessDay: b.businessDay })));
  const inSafe = depositCashInSafeMinor(bags);
  const sealedTotal = sealedInSafe.reduce((s, b) => s + bagCashMinor(b), 0);
  const bankShape = depositShapeNotice(sealedTotal, depositCashInSafeMinor(bags, sealedInSafe.map((b) => b.id)));
  const exp = drawers.ok ? drawers.expected : null;

  return (
    <div className="space-y-6">
      <div className="print:hidden">{crumbs}</div>
      <div className="print:hidden">
        <AdminPageHeader
          title="Deposit bags"
          subtitle="Night count → morning recount by a different employee → seal → store safe → the owner takes it to the bank."
          action={back}
          help={
            <HelpPanel id="registers-deposit-bags" title="How deposit bags work (SOP-03)">
              <p>
                <strong>Night (one person, D24, D82).</strong> After every drawer is closed, the closer pulls each till&apos;s takings
                (closing count minus its float; the float stays in the drawer), adds the day&apos;s drops from the safe, checks each
                stack against its line on this screen, ticks it, and saves the bag with the number printed on the bag and their PIN
                (assembled and verified). Only if a stack does not match do they count the bag by denomination instead. The bag goes into the
                store safe <strong>unsealed</strong> overnight (D23).
              </p>
              <p>
                <strong>Morning (a different employee, D24).</strong> The morning employee recounts the bag blind: the screen does
                not show last night&apos;s figure until the recount is saved. The same person who counted at night is refused. If the
                two counts differ by more than $5.00, a reason is required (D21) and the bag is not ready to seal until it is written.
              </p>
              <p>
                <strong>Seal (anyone, D25).</strong> Seal the tamper-evident bag (D26) and press Seal. That posts the books entry
                10400 Undeposited Funds ← 10100 Vault, dated on the bag&apos;s business day. A sealed bag cannot be changed or deleted.
              </p>
              <p>
                <strong>Bank (owner only, D25).</strong> The owner ticks every sealed bag taken to the bank. When the deposit shows
                on Books → Bank, the owner presses <strong>Clear against bags</strong> on that line.
              </p>
              <p>
                <strong>Warnings, never blocks (D27).</strong> A bag still waiting for its morning recount shows a warning here and on
                Register Activity. It never stops a drawer from closing.
              </p>
            </HelpPanel>
          }
        />
      </div>

      <div className="space-y-6 px-5 sm:px-8 print:px-0">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:hidden">{sp.error}</div>
        ) : sp.done ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)] print:hidden">{sp.done}</div>
        ) : null}
        {!dayRes.ok ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:hidden">
            {dayRes.error} Showing today ({today}) instead.
          </div>
        ) : null}
        {d27 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)] print:hidden">{d27}</div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          <StatCard label="Waiting for the morning recount" value={String(waitingRecount.length)} hint="Unsealed in the safe" />
          <StatCard label="Ready to seal" value={String(readyToSeal.length)} hint="Recounted and agreed" />
          <StatCard label="Sealed, in the safe for the bank" value={String(sealedInSafe.length)} hint={formatCents(sealedTotal)} />
          <StatCard label="Deposit cash in the safe" value={formatCents(inSafe)} hint={notPosted.length > 0 ? `${notPosted.length} sealed bag(s) NOT POSTED to the books` : "Every bag not yet banked"} />
        </div>

        {/* ── Night count ───────────────────────────────────────────── */}
        <Panel title={`Night: assemble and verify the deposit for ${nightDay}`} className="print:hidden">
          <form method="get" action={HERE} className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block text-xs text-[var(--admin-text-muted)]">
              Business day
              <Input type="date" name="day" defaultValue={nightDay} max={today} />
            </label>
            <Button type="submit" variant="neutral" size="sm">
              Show this day
            </Button>
          </form>

          {!drawers.ok ? (
            <p className="mt-3 text-sm text-[var(--admin-danger)]">{drawers.error} The expected deposit cannot be shown; count what is there.</p>
          ) : exp && exp.sessionCount === 0 ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No drawer was opened on {nightDay}. No bag: write &quot;NO SALES — no bag&quot; on the bag log (SOP-03 §4.16).</p>
          ) : exp ? (
            <div className="mt-3 overflow-x-auto">
              <p className="text-xs text-[var(--admin-text-muted)]">What the drawers say goes in the bag: each till&apos;s closing count minus its float, plus the drops (SOP-03 §4.1).</p>
              <table className="mt-2 w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <th className="py-2 pr-3">Till</th>
                    <th className="py-2 pr-3 text-right">Float stays</th>
                    <th className="py-2 pr-3 text-right">Closing count</th>
                    <th className="py-2 pr-3 text-right">Takings</th>
                    <th className="py-2 pr-3 text-right">Drops</th>
                    <th className="py-2 text-right">To the bag</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.lines.map((l) => (
                    <tr key={l.sessionId} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)]">
                      <td className="py-2 pr-3">{l.registerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCents(l.floatMinor)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCents(l.closingMinor)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCents(l.takingsMinor)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCents(l.dropsMinor)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCents(l.toBagMinor)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-[var(--admin-text)]">
                    <td className="py-2 pr-3">Expected deposit</td>
                    <td colSpan={4} />
                    <td className="py-2 text-right tabular-nums">{exp.expectedMinor === null ? "Cannot be worked out" : formatCents(exp.expectedMinor)}</td>
                  </tr>
                </tbody>
              </table>
              {exp.problems.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-[var(--admin-gold)]">
                  {exp.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {nightBagExists ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">A bag is already recorded for {nightDay}. One day, one bag (SOP-03 §4.14). It is listed below.</p>
          ) : (
            <>
            {exp && exp.expectedMinor !== null && exp.lines.some((l) => l.toBagMinor > 0) ? (
              <form action={nightAssembleAction} className="mt-4 space-y-3 rounded-lg border border-[var(--admin-accent)]/30 p-3">
                <input type="hidden" name="business_day" value={nightDay} />
                <p className="text-sm font-semibold text-[var(--admin-text)]">Assemble and verify the deposit (the normal way, owner rule D82)</p>
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Pull each till&apos;s takings and its drops, check each stack against the line above, and tick it. The bag total is the
                  expected deposit. No denomination count at night: the morning employee counts the bag blind (D24).
                </p>
                <ul className="space-y-1">
                  {exp.lines
                    .filter((l) => l.toBagMinor > 0)
                    .map((l) => (
                      <li key={l.sessionId}>
                        <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                          <input type="checkbox" name="confirm_session" value={l.sessionId} required />
                          {l.registerName}: {formatCents(l.toBagMinor)} is in my hand and goes in the bag
                        </label>
                      </li>
                    ))}
                </ul>
                <p className="text-sm font-semibold text-[var(--admin-text)]">Bag total: {formatCents(exp.expectedMinor)}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-xs text-[var(--admin-text-muted)]">
                    Bag # (printed on the bag)
                    <Input name="bag_no" required maxLength={BAG_NO_MAX_LEN} placeholder="e.g. 1041" autoComplete="off" />
                  </label>
                  <label className="block grow text-xs text-[var(--admin-text-muted)]">
                    Note (optional)
                    <Input name="night_note" maxLength={BAG_NOTE_MAX_LEN} placeholder="e.g. drawer 2 stack checked twice" />
                  </label>
                  <PinField name="assemble_pin" label="Your PIN (the closer)" />
                  <Button type="submit" variant="primary" size="sm">
                    Save assembled bag
                  </Button>
                </div>
                <p className="text-xs text-[var(--admin-text-faint)]">
                  A stack that does not match its line: do not tick it. Count the whole bag by denomination below instead, and write what you found.
                </p>
              </form>
            ) : null}
            <details className="mt-4" open={!(exp && exp.expectedMinor !== null && exp.lines.some((l) => l.toBagMinor > 0))}>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">Count by denomination instead (when a stack does not match, or the expected deposit cannot be worked out)</summary>
            <form action={nightCountAction} className="mt-4 space-y-3">
              <input type="hidden" name="business_day" value={nightDay} />
              <CountGrid namePrefix="night_" expectedMinor={exp?.expectedMinor ?? null} expectedLabel="Expected deposit" totalLabel="Counted into the bag" />
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  Bag # (printed on the bag)
                  <Input name="bag_no" required maxLength={BAG_NO_MAX_LEN} placeholder="e.g. 1041" autoComplete="off" />
                </label>
                <label className="block grow text-xs text-[var(--admin-text-muted)]">
                  What you checked, if the count differs from expected (optional)
                  <Input name="night_note" maxLength={BAG_NOTE_MAX_LEN} placeholder="e.g. recounted twice; drawer 2 short at reconcile" />
                </label>
                <PinField name="night_pin" label="Your PIN (the closer)" />
                <Button type="submit" variant="primary" size="sm">
                  Save night count
                </Button>
              </div>
              <p className="text-xs text-[var(--admin-text-faint)]">
                Then put the cash and the night sheet in the bag, <strong>unsealed</strong>, in the store safe&apos;s &quot;TO VERIFY&quot; slot (SOP-03 §4.6).
              </p>
            </form>
            </details>
            </>
          )}
        </Panel>

        {/* ── Morning recount ───────────────────────────────────────── */}
        <Panel title="Morning: recount by a different employee" className="print:hidden">
          {waitingRecount.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No bag is waiting for its morning recount.</p>
          ) : (
            <div className="mt-2 space-y-4">
              {waitingRecount.map((b) => (
                <form key={b.id} action={morningRecountAction} className="space-y-3 rounded-lg border border-[var(--admin-border)] p-3">
                  <input type="hidden" name="bag_id" value={b.id} />
                  <p className="text-sm text-[var(--admin-text)]">
                    Bag <strong>{b.bagNo}</strong> · business day {b.businessDay} · {b.nightAssembled ? "assembled and verified" : "counted"} at night by {nameOf(b.nightCountedBy)} at {fmtTime(b.nightCountedAt)}.{" "}
                    <span className="text-[var(--admin-text-muted)]">Count it without looking at last night&apos;s figure (SOP-03 §4.10); the screen shows it after you save.</span>
                  </p>
                  <CountGrid namePrefix="morning_" totalLabel="Morning recount" />
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block grow text-xs text-[var(--admin-text-muted)]">
                      Reason (only when the screen says the counts differ by more than $5.00)
                      <Input name="variance_reason" maxLength={BAG_NOTE_MAX_LEN} placeholder="Leave blank unless asked" />
                    </label>
                    <PinField name="morning_pin" label="Your PIN (not last night's closer)" />
                    <Button type="submit" variant="primary" size="sm">
                      Save recount
                    </Button>
                  </div>
                </form>
              ))}
            </div>
          )}
        </Panel>

        {/* ── Seal ──────────────────────────────────────────────────── */}
        <Panel title="Seal the bag (anyone) and put it back in the safe" className="print:hidden">
          {readyToSeal.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No bag is ready to seal.</p>
          ) : (
            <div className="mt-2 space-y-4">
              {readyToSeal.map((b) => {
                const cmp = b.nightCountMinor !== null && b.morningCountMinor !== null ? compareNightMorning(b.nightCountMinor, b.morningCountMinor) : null;
                const shape = depositShapeNotice(b.morningCountMinor ?? 0, depositCashInSafeMinor(bags, [b.id]));
                return (
                  <form key={b.id} action={sealBagAction} className="space-y-2 rounded-lg border border-[var(--admin-border)] p-3">
                    <input type="hidden" name="bag_id" value={b.id} />
                    <p className="text-sm text-[var(--admin-text)]">
                      Bag <strong>{b.bagNo}</strong> · {b.businessDay} · night {formatCents(b.nightCountMinor)} ({nameOf(b.nightCountedBy)}) · morning{" "}
                      <strong>{formatCents(b.morningCountMinor)}</strong> ({nameOf(b.morningCountedBy)})
                    </p>
                    {cmp ? <p className="text-xs text-[var(--admin-text-muted)]">{cmp.sentence}{b.varianceReason ? ` Reason: ${b.varianceReason}` : ""}</p> : null}
                    {shape ? <p className="text-xs text-[var(--admin-gold)]">{shape.message}</p> : null}
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block text-xs text-[var(--admin-text-muted)]">
                        Bag # on the sealed bag (change only if a new bag was used, SOP-03 §4.11 step 2)
                        <Input name="seal_bag_no" defaultValue={b.bagNo} maxLength={BAG_NO_MAX_LEN} required autoComplete="off" />
                      </label>
                      <PinField name="seal_pin" label="Your PIN (who sealed)" />
                      <Button type="submit" variant="primary" size="sm">
                        Seal bag {b.bagNo} for {formatCents(b.morningCountMinor)}
                      </Button>
                    </div>
                  </form>
                );
              })}
            </div>
          )}
        </Panel>

        {/* ── Sealed in the safe ────────────────────────────────────── */}
        <Panel title="Sealed bags in the safe (for the bank)" className="print:hidden">
          {sealedInSafe.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No sealed bag is waiting for the bank.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-[var(--admin-text)]">
              {sealedInSafe.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    Bag <strong>{b.bagNo}</strong> · {b.businessDay} · {formatCents(b.amountMinor)} · sealed by {nameOf(b.sealedBy)} {fmtTime(b.sealedAt)}
                  </span>
                  {b.sealJournalId ? (
                    <Badge tone="green">In the books</Badge>
                  ) : (
                    <>
                      <Badge tone="danger">NOT POSTED to the books</Badge>
                      <form action={retrySealPostAction}>
                        <input type="hidden" name="bag_id" value={b.id} />
                        <Button type="submit" variant="neutral" size="sm">
                          Post to the books
                        </Button>
                      </form>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── Bank run (owner only, D25) ────────────────────────────── */}
        {isOwner ? (
          <Panel title="Bank run (owner only)" className="print:hidden">
            {sealedInSafe.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No sealed bag to take to the bank.</p>
            ) : (
              <form action={bankRunAction} className="mt-2 space-y-3">
                <p className="text-xs text-[var(--admin-text-muted)]">
                  Take <strong>every</strong> sealed bag, oldest first (SOP-03 §4.13–4.14). All are ticked. If one must stay behind, untick it and write why in the note, at the time.
                </p>
                {sealedInSafe
                  .slice()
                  .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
                  .map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                      <input type="checkbox" name="bag_ids" value={b.id} defaultChecked />
                      Bag {b.bagNo} · {b.businessDay} · {formatCents(b.amountMinor)}
                    </label>
                  ))}
                {bankShape ? <p className="text-xs text-[var(--admin-gold)]">{bankShape.message}</p> : null}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-xs text-[var(--admin-text-muted)]">
                    Day taken to the bank
                    <Input type="date" name="banked_on" defaultValue={today} required />
                  </label>
                  <label className="block grow text-xs text-[var(--admin-text-muted)]">
                    Note (required if a sealed bag stays behind)
                    <Input name="bank_note" maxLength={BAG_NOTE_MAX_LEN} />
                  </label>
                  <Button type="submit" variant="primary" size="sm">
                    Record bank run ({formatCents(sealedTotal)})
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        ) : null}

        {/* ── The bag log (print + CSV) ─────────────────────────────── */}
        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">Deposit bag log · {logFrom} to {logTo}</h2>
              <p className="text-xs text-[var(--admin-text-muted)] print:text-black/70">Greenway Marijuana · WA license 413541 · keep with the books papers (SOP-03 form 8.2)</p>
            </div>
            <div className="flex flex-wrap items-end gap-2 print:hidden">
              <form method="get" action={HERE} className="flex flex-wrap items-end gap-2">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  From
                  <Input type="date" name="from" defaultValue={logFrom} />
                </label>
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  To
                  <Input type="date" name="to" defaultValue={logTo} />
                </label>
                <Button type="submit" variant="neutral" size="sm">
                  Show
                </Button>
              </form>
              <Button href={`${HERE}/csv?from=${logFrom}&to=${logTo}`} variant="neutral" size="sm">
                Download CSV
              </Button>
              <PrintButton />
            </div>
          </div>
          {rangeError ? <p className="mt-2 text-sm text-[var(--admin-danger)]">{rangeError}</p> : null}
          {!logRes.ok ? (
            <p className="mt-2 text-sm text-[var(--admin-danger)]">The log could not be read: {logRes.error}. This is not the same as there being no bags.</p>
          ) : logBags.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No bags in this range.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--admin-border)] uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black">
                    <th className="py-2 pr-2">Day</th>
                    <th className="py-2 pr-2">Bag #</th>
                    <th className="py-2 pr-2">Stage</th>
                    <th className="py-2 pr-2 text-right">Expected</th>
                    <th className="py-2 pr-2 text-right">Night</th>
                    <th className="py-2 pr-2 text-right">Morning</th>
                    <th className="py-2 pr-2">Reason / notes</th>
                    <th className="py-2 pr-2">Sealed</th>
                    <th className="py-2 pr-2">Books</th>
                    <th className="py-2">Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {logBags.map((b: BagRow) => {
                    const st = bagStage(b);
                    const shown = showNightFigure(b);
                    return (
                      <tr key={b.id} className="border-b border-[var(--admin-border)]/50 align-top text-[var(--admin-text)] print:text-black">
                        <td className="py-2 pr-2 whitespace-nowrap">{b.businessDay}</td>
                        <td className="py-2 pr-2 font-semibold">{b.bagNo}</td>
                        <td className="py-2 pr-2">
                          <Badge tone={STAGE_TONE[st]}>{STAGE_LABEL[st]}</Badge>
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">{b.expectedMinor === null ? "—" : formatCents(b.expectedMinor)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {shown ? formatCents(b.nightCountMinor) : "hidden until recount"}
                          <div className="text-[var(--admin-text-faint)] print:text-black/60">{nameOf(b.nightCountedBy)}{b.nightAssembled ? " · assembled" : ""}</div>
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {b.morningCountMinor === null ? "—" : formatCents(b.morningCountMinor)}
                          <div className="text-[var(--admin-text-faint)] print:text-black/60">{b.morningCountedBy ? nameOf(b.morningCountedBy) : ""}</div>
                        </td>
                        <td className="py-2 pr-2">{[b.varianceReason, b.nightNote, b.bankNote].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="py-2 pr-2">{b.sealedAt ? `${formatCents(b.amountMinor)} · ${nameOf(b.sealedBy)} · ${fmtTime(b.sealedAt)}` : "—"}</td>
                        <td className="py-2 pr-2">{b.sealJournalId ? "posted" : b.sealedAt ? "NOT POSTED" : "—"}</td>
                        <td className="py-2">{b.bankedOn ? `${b.bankedOn} · ${bankerOf(b.bankedBy)}` : "—"}{b.depositConfirmedOn ? ` · confirmed ${b.depositConfirmedOn}` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-6 hidden grid-cols-2 gap-8 text-xs text-black print:grid">
            <div className="border-t border-black pt-1">Reviewed by (signature)</div>
            <div className="border-t border-black pt-1">Date</div>
          </div>
        </section>
      </div>
    </div>
  );
}
