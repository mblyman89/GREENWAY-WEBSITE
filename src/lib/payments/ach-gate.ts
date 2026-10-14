/**
 * R41 S0: the owner-authority gate every live and stop ACH action goes through.
 *
 * Owner decisions this builds (recorded verbatim in R41-TIMBERLAND-SLICE-PLAN.md):
 *   D-6  "I think I like option b better now that I think of it. Please build it that way."
 *        Option B = Stephen's stop-the-money actions (hold, return/NOC notice)
 *        take effect at once, email Michael and land on his review list to
 *        check off; every other live change Stephen makes waits for Michael.
 *   D-7  requests never expire; a daily reminder; stale requests are refused.
 *   D-8  every owner ACH action sends Michael a "Was this you?" receipt.
 *   D-9  Stephen is an admin.
 *
 * Routing (ach-authority-core.routeAchAction):
 *   owner         run now; receipt to Michael; Stephen's pending requests for
 *                 the same record are marked superseded (nothing waits on him).
 *   admin + stop  run now; review item + alert email to Michael.
 *   admin + live  store an encrypted request; email Michael; change nothing.
 *   anyone else   requirePermission("ach.request") sends them to the normal
 *                 "no access" page (/admin?denied=1).
 *
 * Approval replay: approving re-runs the SAME exported action as the owner
 * inside a replay context (AsyncLocalStorage, per request). The gate then
 * runs the body only if the signed-in person is the owner AND the kind and
 * record match the request (ach-gate-core.replayMatches), so a request can
 * never be replayed against another record. Raw action bodies are never
 * exported: every export of a "use server" file is a public endpoint.
 *
 * The database enforces the same rules (0271): the owner stamp on every live
 * write, ach_request_decide (owner, requester, staleness under a row lock).
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { redirect } from "next/navigation";
import { requirePermission, type StaffSession } from "@/lib/auth/session";
import {
  achAuthority,
  formToEntries,
  maskedSummary,
  ownerReceiptEmail,
  REQUEST_SENT_MESSAGE,
  requestArrivedEmail,
  routeAchAction,
  STOP_DONE_SUFFIX,
  stopAlertEmail,
  type AchActionKind,
} from "@/lib/auth/ach-authority-core";
import {
  KIND_SPECS,
  pacificWhen,
  redirectOutcome,
  redirectUrlFromDigest,
  replayMatches,
  summaryArray,
  targetIdFrom,
  withOutcomeSuffix,
  type RedirectOutcome,
} from "@/lib/payments/ach-gate-core";
import {
  insertChangeRequest,
  insertOwnerReview,
  labelForTarget,
  readTargetVersion,
  supersedePendingFor,
} from "@/lib/payments/ach-requests-store";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { encryptSecret } from "@/lib/security/at-rest-crypto";

export const APPROVALS_PATH = "/admin/settings/banking/approvals";

type ReplayContext = { kind: AchActionKind; targetId: string | null; ownerId: string };
const replayStore = new AsyncLocalStorage<ReplayContext>();

/** Run fn with the approval replay context set (the approvals action only). */
export function runAsApprovalReplay<T>(ctx: ReplayContext, fn: () => Promise<T>): Promise<T> {
  return replayStore.run(ctx, fn);
}

export const REPLAY_MISMATCH = "This approval does not match the request it came from, so nothing was changed.";
export const NO_KEY_REFUSAL =
  "Stephen's request could not be stored safely: the server's encryption key (DATA_ENCRYPTION_KEY) is not set. Nothing was changed.";

export type GateOptions<T> = {
  /** The record id when it is bound to the action rather than a form field (payroll run). */
  explicitId?: string | null;
  /** Name the record differently from its target (a notice is named by its payee). */
  labelFrom?: { kind: AchActionKind; id: string | null };
  /** Tell the person the result: redirect actions throw back(); data actions return a value. */
  reply: (r: RedirectOutcome) => T;
  /** For data actions (no redirect): read the result in words from the returned value. */
  outcomeOf?: (value: T) => RedirectOutcome;
};

function isNextRedirect(e: unknown): string | null {
  return redirectUrlFromDigest((e as { digest?: unknown } | null)?.digest);
}

async function mailMichael(msg: { subject: string; html: string }): Promise<boolean> {
  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  try {
    const r = await resendOpsMailer()([to], msg);
    return r.ok;
  } catch {
    return false;
  }
}

function bankingUrl(path = "/admin/settings/banking"): string {
  return `${opsSiteUrl(process.env)}${path}`;
}

/**
 * The gate. `run` is the action body as it was before S0 (it may redirect).
 * Returns what run returns (data actions), or rethrows its redirect.
 */
export async function achGate<T>(kind: AchActionKind, fd: FormData, opts: GateOptions<T>, run: (session: StaffSession) => Promise<T>): Promise<T> {
  const session = await requirePermission("ach.request");
  const targetId = targetIdFrom(kind, (k) => fd.get(k), opts.explicitId);

  // Approval replay: owner only, same kind, same record.
  const replay = replayStore.getStore();
  if (replay) {
    if (achAuthority(session.profile.role) !== "act" || session.profile.id !== replay.ownerId || !replayMatches(replay, { kind, targetId })) {
      return opts.reply({ ok: false, message: REPLAY_MISMATCH });
    }
    return run(session);
  }

  const route = routeAchAction(session.profile.role, kind);
  if (route.route === "refuse") return opts.reply({ ok: false, message: route.refusal });

  if (route.route === "request") {
    const parsed = formToEntries(fd.entries());
    if (!parsed.ok) return opts.reply({ ok: false, message: parsed.refusal });
    const payloadEnc = encryptSecret(JSON.stringify(parsed.entries));
    if (!payloadEnc.startsWith("encv1:")) return opts.reply({ ok: false, message: NO_KEY_REFUSAL });
    const version = await readTargetVersion(kind, targetId);
    if (!version.ok) return opts.reply({ ok: false, message: version.error });
    const label = await labelForTarget(opts.labelFrom?.kind ?? kind, opts.labelFrom ? opts.labelFrom.id : targetId);
    const summary = maskedSummary(parsed.entries);
    const ins = await insertChangeRequest({
      kind,
      targetId,
      targetLabel: label,
      baseVersion: version.version,
      payloadEnc,
      summary: summaryArray(summary),
      reason: (parsed.entries["request_note"]?.[0] ?? "").trim() || null,
      requestedBy: session.profile.id,
    });
    if (!ins.ok) return opts.reply({ ok: false, message: ins.error });
    const mailed = await mailMichael(
      requestArrivedEmail({
        requester: session.profile.full_name || session.email,
        kind,
        target: label,
        summary,
        whenPacific: pacificWhen(new Date()),
        url: bankingUrl(APPROVALS_PATH),
      }),
    );
    return opts.reply({ ok: true, message: mailed ? REQUEST_SENT_MESSAGE : `${REQUEST_SENT_MESSAGE} (The email to Michael did not go; tell him it is waiting.)` });
  }

  // route.route === "run": the owner, or Stephen on a stop action.
  let value: T | undefined;
  let redirectUrl: string | null = null;
  let thrown: unknown = null;
  try {
    value = await run(session);
  } catch (e) {
    redirectUrl = isNextRedirect(e);
    if (redirectUrl === null) throw e; // a real error, or notFound(): not ours to handle
    thrown = e;
  }
  const outcome: RedirectOutcome =
    redirectUrl !== null ? redirectOutcome(redirectUrl) : opts.outcomeOf ? opts.outcomeOf(value as T) : { ok: true, message: "Done." };

  if (outcome.ok) {
    const label = await labelForTarget(opts.labelFrom?.kind ?? kind, opts.labelFrom ? opts.labelFrom.id : targetId);
    if (route.receipt) {
      if (targetId) await supersedePendingFor({ ownerKind: kind, targetType: KIND_SPECS[kind].targetType, targetId, actorId: session.profile.id });
      await mailMichael(ownerReceiptEmail({ kind, target: label, outcome: outcome.message, whenPacific: pacificWhen(new Date()), url: bankingUrl() }));
    } else if (route.review) {
      const parsed = formToEntries(fd.entries());
      const summary = parsed.ok ? maskedSummary(parsed.entries) : {};
      const rev = await insertOwnerReview({ kind, targetLabel: label, summary: summaryArray(summary), outcome: outcome.message, doneBy: session.profile.id });
      const mailed = await mailMichael(
        stopAlertEmail({ actor: session.profile.full_name || session.email, kind, target: label, summary, whenPacific: pacificWhen(new Date()), url: bankingUrl(APPROVALS_PATH) }),
      );
      const suffix =
        rev.ok && mailed
          ? STOP_DONE_SUFFIX
          : rev.ok
            ? "It is on Michael's review list, but the alert email did not go: tell him."
            : "The review item for Michael could NOT be saved: tell him yourself now.";
      if (redirectUrl !== null) redirect(withOutcomeSuffix(redirectUrl, suffix));
    }
  }
  if (thrown !== null) throw thrown;
  return value as T;
}
