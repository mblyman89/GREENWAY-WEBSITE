/**
 * src/components/admin/syndication/LeaflyEvidencePanel.tsx  (SLICE L-8)
 *
 * "Is Leafly actually reaching us, and are the signatures good?"
 *
 * WHY THIS CARD EXISTS
 * --------------------
 * Slice L-5 wired all six webhook routes to write every delivery into
 * `public.leafly_webhook_events`. Migration 0225 describes that table, in its
 * own words, as "the evidence Leafly reviews at certification" and insists the
 * delivery log is "evidence, not debug noise". It then creates
 *
 *     create index leafly_webhook_events_unverified_idx
 *       on public.leafly_webhook_events (received_at desc)
 *       where signature_verified = false;
 *
 * -- an index whose only possible purpose is "show me the rejected deliveries,
 * newest first". Nothing read it. Until this card, the log was write-only and
 * the three failures below were completely invisible from the admin:
 *
 *   * the HMAC key is missing or mistyped, so every delivery 401s;
 *   * Leafly is not sending at all, which needs the OPPOSITE fix and looked
 *     identical (an empty orders board);
 *   * an unknown event type arrived, which the routes tolerate on purpose --
 *     and that tolerance is only safe if a human can see it afterwards.
 *
 * WHY THERE IS NO LOGIC IN THIS FILE
 * ----------------------------------
 * Every verdict, tone, label, explanation and next step below is computed in
 * `src/lib/leafly/evidence-core.ts`, which is pure and carries 316 self-test
 * assertions. This component owns layout, reading order and nothing else. A
 * `.tsx` file is the worst place to keep a rule: the mutation sweep cannot
 * sabotage it and inline ternaries breed (house rule 11).
 *
 * WHY IT IS A SERVER COMPONENT WITH NO INTERACTIVITY
 * --------------------------------------------------
 * Every control here is a link or a form GET. There is nothing to mutate: the
 * delivery log is append-only by design, so a screen that could change it would
 * destroy the one property that makes it evidence. No `"use client"`, no state,
 * no hydration risk, and relative times come from the server's clock rather
 * than the browser's so the first paint agrees with itself.
 */

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import type { BadgeTone } from "@/components/admin/ui/Badge";
import {
  type EvidenceTone,
  type EvidenceEventRow,
  classifyEvidenceDelivery,
  evidenceDispositionLabel,
  evidenceDispositionTone,
  evidenceDispositionExplanation,
  evidenceClockSkewMinutes,
  findEvidenceAnomalies,
  evidenceAnomalyLabel,
  ALL_EVIDENCE_DISPOSITIONS,
} from "@/lib/leafly/evidence-core";
import type { EvidenceView } from "@/lib/leafly/evidence-server";
import { EVIDENCE_PANEL_LIMIT } from "@/lib/leafly/evidence-server";
import { describeElapsed } from "@/lib/leafly/schedule-core";

/**
 * Map the core's semantic tone onto the shared Badge palette.
 *
 * This is presentation plumbing, not a decision: the core decides WHAT tone a
 * thing has, and this table only says which existing colour that tone wears.
 * Kept here rather than in the core so the core stays free of UI vocabulary.
 */
const BADGE_TONE: Record<EvidenceTone, BadgeTone> = {
  good: "green",
  warn: "gold",
  bad: "danger",
  info: "neutral",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: EvidenceTone }) {
  return (
    <div className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] px-3 py-2">
      <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {label}
      </div>
      <div
        className={`mt-0.5 text-base font-semibold ${
          tone === "bad"
            ? "text-[var(--admin-danger)]"
            : tone === "warn"
              ? "text-[var(--admin-gold)]"
              : tone === "good"
                ? "text-[var(--admin-accent)]"
                : "text-[var(--admin-text)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** ISO → short, readable, explicitly UTC. Never a bare ambiguous string. */
function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function LeaflyEvidencePanel({
  view,
  nowIso,
}: {
  view: EvidenceView;
  nowIso: string;
}) {
  const { verdict, summary, ack, criteria, events } = view;

  return (
    <Card>
      <CardHeader
        title="Leafly webhook evidence"
        subtitle={
          "Every delivery Leafly makes to us, verified or not. This is the log Leafly reviews at " +
          "order certification, and it is the first place to look if Leafly orders are not arriving."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Plain links, not buttons: this is a download, and a link is the
                accessible, right-clickable, keyboard-native way to express one. */}
            <a
              href="/admin/integrations/leafly/evidence-export?format=xlsx"
              className="inline-flex items-center rounded-[var(--admin-radius-sm)] bg-[var(--admin-gold-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-gold)] hover:opacity-90"
            >
              Download evidence (Excel)
            </a>
            <a
              href="/admin/integrations/leafly/evidence-export?format=csv"
              className="inline-flex items-center rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-text-muted)] hover:opacity-90"
            >
              CSV
            </a>
          </div>
        }
      />

      {/* ── The verdict strip. One sentence, then what to do about it. ────── */}
      <div
        className={`rounded-[var(--admin-radius-sm)] border p-3 ${
          verdict.tone === "bad"
            ? "border-[var(--admin-danger)] bg-[var(--admin-danger-soft)]"
            : verdict.tone === "warn"
              ? "border-[var(--admin-gold)] bg-[var(--admin-gold-soft)]"
              : verdict.tone === "good"
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]"
                : "border-[var(--admin-border)] bg-[var(--admin-surface-2)]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={BADGE_TONE[verdict.tone]}>{verdict.code.replace(/_/g, " ")}</Badge>
          <span className="text-sm font-semibold text-[var(--admin-text)]">
            {verdict.headline}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--admin-text-muted)]">
          {verdict.detail}
        </p>
        {verdict.nextStep ? (
          <p className="mt-1.5 text-xs font-semibold leading-relaxed text-[var(--admin-text)]">
            What to do: {verdict.nextStep}
          </p>
        ) : null}
      </div>

      {/* A read failure is reported, never swallowed. The owner is often here
          BECAUSE something is broken; a blank card would be a second failure. */}
      {view.problem ? (
        <p className="mt-3 rounded-[var(--admin-radius-sm)] bg-[var(--admin-danger-soft)] p-2 text-xs text-[var(--admin-danger)]">
          {view.problem}
        </p>
      ) : null}

      {/* ── Totals ───────────────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Deliveries (all time)"
          value={view.totalDeliveries === null ? "—" : String(view.totalDeliveries)}
        />
        <Stat
          label="Rejected (all time)"
          value={view.totalUnverified === null ? "—" : String(view.totalUnverified)}
          tone={view.totalUnverified && view.totalUnverified > 0 ? "bad" : "good"}
        />
        <Stat label="Orders referenced" value={String(summary.distinctOrders)} />
        <Stat
          label="Last delivery"
          value={
            summary.lastReceivedAt ? describeElapsed(summary.lastReceivedAt, nowIso) : "never"
          }
        />
      </div>

      {/* ── Acknowledgement record. Leafly's only hard number. ──────────── */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Acknowledgements — Leafly&rsquo;s {ack.windowMinutes}-minute rule
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
          Leafly auto-cancels any order not acknowledged within {ack.windowMinutes} minutes of the
          submission webhook. Lateness is measured against the deadline Leafly itself sent us, never
          against a deadline we worked out ourselves.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Submissions" value={String(ack.submissions)} />
          <Stat label="Acknowledged" value={String(ack.acknowledged)} tone="good" />
          <Stat
            label="Late"
            value={String(ack.lateAcknowledged)}
            tone={ack.lateAcknowledged > 0 ? "bad" : "good"}
          />
          <Stat label="Missed" value={String(ack.missed)} tone={ack.missed > 0 ? "bad" : "good"} />
          <Stat label="Pending" value={String(ack.pending)} tone={ack.pending > 0 ? "warn" : "good"} />
        </div>
        {ack.fastestAckMinutes !== null ? (
          <p className="mt-1.5 text-xs text-[var(--admin-text-muted)]">
            Acknowledgement took between {ack.fastestAckMinutes} and {ack.slowestAckMinutes} minute(s)
            from first sight.
          </p>
        ) : null}
      </div>

      {/* ── Certification read-out ───────────────────────────────────────── */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          What this log currently proves
        </h4>
        <ul className="mt-2 space-y-1.5">
          {criteria.map((c) => (
            <li
              key={c.id}
              className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    c.status === "pass"
                      ? "green"
                      : c.status === "fail"
                        ? "danger"
                        : c.status === "attest"
                          ? "gold"
                          : "neutral"
                  }
                >
                  {c.status}
                </Badge>
                <span className="text-xs font-semibold text-[var(--admin-text)]">{c.title}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                {c.detail}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
          &ldquo;Unknown&rdquo; is used honestly: with no traffic yet we cannot claim a pass, and
          claiming one would be the exact thing that gets an integration failed at review.
        </p>
      </div>

      {/* ── Breakdown by outcome ─────────────────────────────────────────── */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Outcomes in the last {EVIDENCE_PANEL_LIMIT} deliveries
        </h4>
        <div className="mt-2 space-y-1.5">
          {ALL_EVIDENCE_DISPOSITIONS.filter((d) => summary.counts[d] > 0).map((d) => (
            <div
              key={d}
              className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={BADGE_TONE[evidenceDispositionTone(d)]}>
                  {summary.counts[d]}
                </Badge>
                <span className="text-xs font-semibold text-[var(--admin-text)]">
                  {evidenceDispositionLabel(d)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                {evidenceDispositionExplanation(d)}
              </p>
            </div>
          ))}
          {summary.total === 0 ? (
            <p className="text-xs text-[var(--admin-text-muted)]">
              Nothing to break down yet — no deliveries have been recorded.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── The deliveries themselves ────────────────────────────────────── */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Recent deliveries
        </h4>
        {events.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
            No deliveries recorded. Before Leafly activates the sandbox integration this is the
            expected state — it is not a fault, and it is not something to fix on this screen.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead>
                <tr className="text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
                  <th className="py-1.5 pr-3 font-semibold">Received (UTC)</th>
                  <th className="py-1.5 pr-3 font-semibold">Event</th>
                  <th className="py-1.5 pr-3 font-semibold">Order</th>
                  <th className="py-1.5 pr-3 font-semibold">Outcome</th>
                  <th className="py-1.5 pr-3 font-semibold">We answered</th>
                  <th className="py-1.5 pr-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e: EvidenceEventRow) => {
                  const disposition = classifyEvidenceDelivery(e);
                  const anomalies = findEvidenceAnomalies(e);
                  const skew = evidenceClockSkewMinutes(e);
                  return (
                    <tr key={e.id || e.bodySha256} className="border-t border-[var(--admin-border)]">
                      <td className="py-1.5 pr-3 align-top whitespace-nowrap text-[var(--admin-text-muted)]">
                        {fmt(e.receivedAt)}
                        <div className="text-[0.65rem]">
                          {describeElapsed(e.receivedAt, nowIso)}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 align-top text-[var(--admin-text)]">
                        {e.eventType ?? <span className="text-[var(--admin-danger)]">(none)</span>}
                      </td>
                      <td className="py-1.5 pr-3 align-top font-mono text-[0.65rem] text-[var(--admin-text-muted)]">
                        {e.orderId ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 align-top">
                        <Badge tone={BADGE_TONE[evidenceDispositionTone(disposition)]}>
                          {evidenceDispositionLabel(disposition)}
                        </Badge>
                        {e.rejectionReason ? (
                          <div className="mt-0.5 font-mono text-[0.65rem] text-[var(--admin-text-muted)]">
                            {e.rejectionReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-[var(--admin-text-muted)]">
                        {e.responseStatus ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 align-top text-[var(--admin-text-muted)]">
                        {anomalies.length === 0 ? (
                          <span className="text-[var(--admin-text-muted)]">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {anomalies.map((a) => (
                              <li key={a.code}>
                                <span className="font-semibold text-[var(--admin-gold)]">
                                  {evidenceAnomalyLabel(a.code)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {skew !== null && skew !== 0 ? (
                          <div className="text-[0.65rem]">skew {skew}m</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[var(--admin-text-muted)]">
        <strong className="text-[var(--admin-text)]">Nothing here can be edited.</strong> This log is
        append-only on purpose — it is the record Leafly reviews, and a screen that could change it
        would not be evidence. Deliveries are identified by a SHA-256 hash of the request body, so
        the log proves what arrived without storing any customer&rsquo;s details. The download
        carries no name, email, phone, date of birth, medical card or address.
      </p>
    </Card>
  );
}
