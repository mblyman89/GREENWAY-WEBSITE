/**
 * src/components/admin/syndication/LeaflyCertificationProofPanel.tsx  (SLICE L-47)
 *
 * "Can I prove to Leafly that every action works?"
 *
 * One row per Leafly action the certification reviewer looks for: the Menu
 * API's POST/PUT/DELETE, the six order webhooks, the order endpoints, and
 * both order endings. Each row is green ONLY from a recorded success; no
 * setting, toggle or claim can turn it green.
 *
 * NO LOGIC HERE. Every verdict, tone, label, date and sentence comes from
 * `src/lib/leafly/certification-proof-core.ts` (pure, self-tested). This
 * file owns layout only. Server component; the only client piece is the
 * existing copy button.
 */

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { CopyCommandButton } from "@/components/admin/orders/CopyCommandButton";
import {
  LEAFLY_PROOF_GROUPS,
  LEAFLY_PROOF_MIGRATION_FILE,
  describeAge,
  formatProofWhen,
  proofStateLabel,
  proofStateTone,
  requirementLabel,
  rowsInGroup,
  type ProofRow,
} from "@/lib/leafly/certification-proof-core";
import type { CertificationProofView } from "@/lib/leafly/certification-proof-server";

function requirementTone(r: ProofRow["def"]["requirement"]) {
  return r === "required" ? "danger" : r === "recommended" ? "gold" : "outline";
}

function ProofRowItem({ row }: { row: ProofRow }) {
  const s = row.latestSuccess;
  const f = row.latestFailure;
  return (
    <li className="border-t border-[var(--admin-border)] pt-2" data-proof-row={row.def.id} data-proof-state={row.state}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={proofStateTone(row)}>{proofStateLabel(row)}</Badge>
        <Badge tone={requirementTone(row.def.requirement)}>{requirementLabel(row.def.requirement)}</Badge>
        <span className="text-xs font-semibold text-[var(--admin-text)]">{row.def.label}</span>
      </div>
      <p className="font-mono text-[0.7rem] text-[var(--admin-text-muted)]">{row.def.endpoint}</p>
      {s ? (
        <p className="mt-1 text-xs text-[var(--admin-text)]">
          <strong>Last success:</strong> {formatProofWhen(s.at)} ({describeAge(row.ageDays)}) &middot; {s.via}
          {s.httpStatus !== null ? ` \u00b7 HTTP ${s.httpStatus}` : ""}
        </p>
      ) : null}
      {f && (row.regressed || !s) ? (
        <p className="mt-1 text-xs text-[var(--admin-text)]">
          <strong>Last failure:</strong> {formatProofWhen(f.at)} &middot; {f.via}
          {f.httpStatus !== null ? ` \u00b7 HTTP ${f.httpStatus}` : ""}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{row.note}</p>
      {row.state !== "proven" && row.state !== "not_applicable" ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
          <strong>How to prove it:</strong> {row.def.howToProve}
        </p>
      ) : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-[0.7rem] text-[var(--admin-text-muted)]">Where Leafly asks for this</summary>
        <p className="mt-1 text-[0.7rem] italic text-[var(--admin-text-muted)]">{row.def.source}</p>
        <p className="text-[0.7rem] text-[var(--admin-text-muted)]">Counts as proof: {row.def.provenBy}</p>
      </details>
    </li>
  );
}

export function LeaflyCertificationProofPanel({ view }: { view: CertificationProofView }) {
  const { proof, suggestion, recent } = view;
  const anyMigrationHint = proof.rows.some((r) => r.mayNeedMigration && r.state === "none");
  return (
    <Card>
      <CardHeader
        title="Leafly certification proof"
        subtitle={
          "Every action Leafly checks, and the recorded run that proves it. Leafly certifies by " +
          "reviewing logged activity, so a row turns green only when our own records show Leafly accepted it."
        }
        action={
          <Badge tone={proof.readyToNominate ? "green" : "orange"}>
            {proof.required.proven} of {proof.required.total} required proven
          </Badge>
        }
      />

      <p className="mt-2 text-xs text-[var(--admin-text)]" data-proof-headline>
        {proof.headline}
      </p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        Recommended: {proof.recommended.proven} of {proof.recommended.total} &middot; Optional:{" "}
        {proof.optional.proven} of {proof.optional.total} &middot; Environment: {view.environment}
      </p>

      {view.problem ? (
        <p className="mt-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2 text-xs text-[var(--admin-text)]">
          {view.problem}
        </p>
      ) : null}

      {anyMigrationHint ? (
        <p className="mt-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2 text-xs text-[var(--admin-text)]">
          <strong>One-time setup:</strong> Fetch Order and the ID-image checks are recorded only after
          migration <code>{LEAFLY_PROOF_MIGRATION_FILE}</code> has been run in the Supabase SQL editor. It is safe
          to run more than once.
        </p>
      ) : null}

      {LEAFLY_PROOF_GROUPS.map((g) => (
        <section key={g.id} className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">{g.label}</h3>
          <ul className="mt-1 space-y-3">
            {rowsInGroup(proof, g.id).map((row) => (
              <ProofRowItem key={row.def.id} row={row} />
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-5 border-t border-[var(--admin-border)] pt-3">
        <h3 className="text-sm font-bold text-[var(--admin-text)]">Choosing your certification window</h3>
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
          Leafly asks you to name a window of activity for the reviewer to look at, with{" "}
          {"two business days\u2019"} notice. Here is a plan worked out from today:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--admin-text)]">
          {suggestion.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-1 text-[0.7rem] text-[var(--admin-text-muted)]">{suggestion.caveat}</p>

        <div className="mt-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[var(--admin-text)]">
              If you emailed Leafly today ({recent.startLabel} to {recent.endLabel})
            </span>
            <Badge tone={recent.complete ? "green" : "orange"}>
              {recent.coveredRequired.length} of {recent.coveredRequired.length + recent.missingRequired.length} required
              inside it
            </Badge>
          </div>
          {recent.missingRequired.length > 0 ? (
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Not yet inside this window: {recent.missingRequired.join("; ")}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Every required action has a clean success inside this window.
            </p>
          )}
          {view.recentEmail ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--admin-text)]">
                Draft email to Leafly for this window
              </summary>
              <textarea
                readOnly
                className="mt-2 h-56 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-transparent p-2 font-mono text-[0.7rem] text-[var(--admin-text)]"
                defaultValue={view.recentEmail}
                aria-label="Draft certification window email"
              />
              <div className="mt-1">
                <CopyCommandButton command={view.recentEmail} describeAs="email draft" idleLabel="Copy email" />
              </div>
              <p className="mt-1 text-[0.7rem] text-[var(--admin-text-muted)]">
                The draft lists only what our records show. Review it before sending.
              </p>
            </details>
          ) : null}
        </div>
      </section>

      <ul className="mt-4 list-disc space-y-1 border-t border-[var(--admin-border)] pl-5 pt-2 text-[0.7rem] text-[var(--admin-text-muted)]">
        {proof.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Card>
  );
}
