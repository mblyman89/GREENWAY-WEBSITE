/**
 * vendor-reconcile-store.ts — server store for the P7-a vendor payment ↔ bank
 * reconciliation view. Server-only (Supabase + Plaid I/O). All the judgment
 * lives in the PURE vendor-reconcile-core; this file only fetches the plain
 * arrays that core needs.
 *
 * WHAT IT GATHERS (verified, not guessed):
 *   • Recorded vendor payments — every vendor_manifest_payments row (the real
 *     "what we paid" ledger, migrations 0067/0068): amount_minor_units (CENTS),
 *     payment_method, created_at (→ Pacific paid date), vendor_name,
 *     manifest_number, ach_batch_ref, reference.
 *   • Main-account withdrawals — money-OUT Plaid transactions from every account
 *     tagged role="main" (Michael's Timberland operating account).
 *
 * Returns empty/flagged inputs when the DB isn't configured or no Main account
 * is tagged, so the page shows guidance instead of crashing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listPlaidAccounts, listPlaidTransactions } from "@/lib/plaid/store";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  toBankWithdrawals,
  type BankWithdrawal,
  type VendorPaymentMethod,
  type VendorPaymentRecord,
} from "@/lib/payments/vendor-reconcile-core";

/** Known payment methods; anything unexpected falls back to "other". */
const KNOWN_METHODS: ReadonlySet<VendorPaymentMethod> = new Set<VendorPaymentMethod>([
  "ach",
  "check",
  "cash",
  "wire",
  "other",
]);

function normalizeMethod(raw: string | null | undefined): VendorPaymentMethod {
  const m = (raw ?? "ach").trim().toLowerCase();
  return KNOWN_METHODS.has(m as VendorPaymentMethod) ? (m as VendorPaymentMethod) : "other";
}

type PaymentRow = {
  id: string;
  vendor_name: string | null;
  manifest_number: string | null;
  amount_minor_units: number | null;
  payment_method: string | null;
  ach_batch_ref: string | null;
  reference: string | null;
  created_at: string;
};

/**
 * List recorded vendor payments as reconcilable records, newest first. Payment
 * date = created_at converted to the Pacific business day (so it lines up with
 * the yyyy-mm-dd posted dates on bank transactions). Reference prefers the
 * human reference (check #, wire conf) and falls back to the ACH batch stamp.
 */
export async function listVendorPaymentRecords(limit = 500): Promise<VendorPaymentRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("vendor_manifest_payments")
    .select(
      "id, vendor_name, manifest_number, amount_minor_units, payment_method, ach_batch_ref, reference, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  const rows = (data as PaymentRow[] | null) ?? [];
  return rows.map((r) => ({
    paymentId: r.id,
    vendorName: r.vendor_name ?? "",
    manifestNumber: r.manifest_number ?? "",
    amountCents: Number(r.amount_minor_units) || 0,
    paidDate: pacificDayKey(r.created_at),
    method: normalizeMethod(r.payment_method),
    reference: r.reference ?? r.ach_batch_ref ?? null,
  }));
}

export type VendorReconcileInputs = {
  payments: VendorPaymentRecord[];
  withdrawals: BankWithdrawal[];
  /** True when at least one bank account is tagged as the Main operating account. */
  hasMainAccount: boolean;
  /** Display names of the Main-role account(s), for the UI header. */
  mainAccountNames: string[];
};

/**
 * Gather everything the vendor reconciliation engine needs: recorded vendor
 * payments + Main-account withdrawals. Never throws; returns empty/flagged
 * inputs when unconfigured so the page can guide instead of crash.
 */
export async function getVendorReconcileInputs(
  paymentLimit = 500,
): Promise<VendorReconcileInputs> {
  if (!isSupabaseServiceConfigured) {
    return { payments: [], withdrawals: [], hasMainAccount: false, mainAccountNames: [] };
  }

  const payments = await listVendorPaymentRecords(paymentLimit);

  const accounts = await listPlaidAccounts();
  const mainAccounts = accounts.filter((a) => a.role === "main" && a.active);
  const mainAccountNames = mainAccounts.map(
    (a) => a.customName ?? a.officialName ?? a.name ?? "Main account",
  );

  const withdrawals: BankWithdrawal[] = [];
  for (const acct of mainAccounts) {
    const txns = await listPlaidTransactions(acct.accountId);
    const asWithdrawals = toBankWithdrawals(
      txns.map((t) => ({
        transactionId: t.transactionId,
        amountCents: t.amountCents,
        date: t.date,
        name: t.name,
        merchantName: t.merchantName,
        pending: t.pending,
      })),
    );
    withdrawals.push(...asWithdrawals);
  }

  return {
    payments,
    withdrawals,
    hasMainAccount: mainAccounts.length > 0,
    mainAccountNames,
  };
}
