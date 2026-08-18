"use server";

/**
 * src/app/admin/loans/actions.ts — server actions for the manual loans page.
 *
 * Each mutating action is gated on the "finances.view" permission (OWNER ONLY
 * as of slice books-06; same gate
 * as the Plaid connections page), records an audit entry, then redirects back to
 * /admin/loans with a friendly message. Money arrives as dollar strings from the
 * form and is converted to integer cents in loan-core; rates arrive as percent
 * strings and become integer milli-percent.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  dollarsToCents,
  percentToMilliPct,
  computeScheduledPaymentCents,
  type LoanKind,
} from "@/lib/loans/loan-core";
import {
  upsertLoan,
  deleteLoan,
  addLoanPayment,
  deleteLoanPayment,
} from "@/lib/loans/loan-store";

const ROOT = "/admin/loans";

function back(qs: { id?: string; msg?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (qs.id) p.set("id", qs.id);
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  const query = p.toString();
  redirect(query ? `${ROOT}?${query}` : ROOT);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Create or update a loan. Present `id` => update; absent => insert. */
export async function saveLoanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");

  const id = str(formData, "id");
  const name = str(formData, "name");
  const kindRaw = str(formData, "kind");
  const kind: LoanKind = kindRaw === "interest_free" ? "interest_free" : "amortizing";

  if (name === "") back({ id: id || undefined, error: "Loan name is required." });

  const originalPrincipalCents = dollarsToCents(str(formData, "original_principal"));
  if (originalPrincipalCents === null || originalPrincipalCents <= 0) {
    back({ id: id || undefined, error: "Enter a valid original principal (e.g. 475588.75)." });
  }

  const currentBalanceCents = dollarsToCents(str(formData, "current_balance"));

  const rateMilliPct = kind === "interest_free" ? 0 : percentToMilliPct(str(formData, "rate")) ?? 0;

  const termMonthsRaw = Number(str(formData, "term_months"));
  const termMonths = Number.isFinite(termMonthsRaw) ? Math.max(0, Math.trunc(termMonthsRaw)) : 0;
  if (termMonths <= 0) back({ id: id || undefined, error: "Enter the loan term in months (e.g. 180)." });

  const firstPaymentDate = str(formData, "first_payment_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstPaymentDate)) {
    back({ id: id || undefined, error: "Enter the first payment date as YYYY-MM-DD." });
  }

  const maturityRaw = str(formData, "maturity_date");
  const maturityDate = /^\d{4}-\d{2}-\d{2}$/.test(maturityRaw) ? maturityRaw : null;

  // Optional owner-provided fixed scheduled payment; else derive it.
  let scheduledPaymentCents = dollarsToCents(str(formData, "scheduled_payment"));
  if (scheduledPaymentCents === null || scheduledPaymentCents <= 0) {
    scheduledPaymentCents = computeScheduledPaymentCents(
      originalPrincipalCents as number,
      rateMilliPct,
      termMonths,
    );
  }

  const fundingAccountId = str(formData, "funding_account_id") || null;
  const notes = str(formData, "notes") || null;

  const result = await upsertLoan({
    id: id || undefined,
    name,
    kind,
    originalPrincipalCents: originalPrincipalCents as number,
    currentBalanceCents,
    rateMilliPct,
    termMonths,
    firstPaymentDate,
    maturityDate,
    scheduledPaymentCents,
    fundingAccountId,
    notes,
    active: true,
  });

  if (!result.ok) back({ id: id || undefined, error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: id ? "loan.updated" : "loan.created",
    entityType: "manual_loan",
    entityId: result.id,
    after: { name, kind, original_principal_cents: originalPrincipalCents, rate_milli_pct: rateMilliPct, term_months: termMonths },
  });

  back({ id: result.id, msg: id ? "Loan updated." : "Loan created." });
}

/** Delete a loan (cascades its payments). */
export async function deleteLoanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const id = str(formData, "id");
  if (id === "") back({ error: "Missing loan id." });

  const result = await deleteLoan(id);
  if (!result.ok) back({ id, error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "loan.deleted",
    entityType: "manual_loan",
    entityId: id,
  });

  back({ msg: "Loan deleted." });
}

/** Record a payment against a loan (optionally matched to a Timberland txn). */
export async function addLoanPaymentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const loanId = str(formData, "loan_id");
  if (loanId === "") back({ error: "Missing loan id." });

  const paidDate = str(formData, "paid_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    back({ id: loanId, error: "Enter the payment date as YYYY-MM-DD." });
  }

  const amountCents = dollarsToCents(str(formData, "amount"));
  if (amountCents === null || amountCents <= 0) {
    back({ id: loanId, error: "Enter a valid payment amount." });
  }

  const result = await addLoanPayment({
    loanId,
    paidDate,
    amountCents: amountCents as number,
    principalCents: dollarsToCents(str(formData, "principal")),
    interestCents: dollarsToCents(str(formData, "interest")),
    escrowCents: dollarsToCents(str(formData, "escrow")),
    feesCents: dollarsToCents(str(formData, "fees")),
    matchedTransactionId: str(formData, "matched_transaction_id") || null,
    description: str(formData, "description") || null,
  });

  if (!result.ok) back({ id: loanId, error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "loan.payment.added",
    entityType: "manual_loan_payment",
    entityId: result.id,
    after: { loan_id: loanId, paid_date: paidDate, amount_cents: amountCents },
  });

  back({ id: loanId, msg: "Payment recorded." });
}

/** Delete a recorded payment. */
export async function deleteLoanPaymentAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const id = str(formData, "id");
  const loanId = str(formData, "loan_id");
  if (id === "") back({ id: loanId || undefined, error: "Missing payment id." });

  const result = await deleteLoanPayment(id);
  if (!result.ok) back({ id: loanId || undefined, error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "loan.payment.deleted",
    entityType: "manual_loan_payment",
    entityId: id,
  });

  back({ id: loanId || undefined, msg: "Payment deleted." });
}
