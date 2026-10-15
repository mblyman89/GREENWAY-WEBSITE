/**
 * src/lib/payments/timberland-file-checker-store.ts   (R41 S9, plan point 3)
 *
 * The reads the pre-upload file checker needs, and the practice build. The
 * file itself is never stored, logged or sent anywhere: it is read in memory,
 * checked by the pure core (timberland-file-checker-core) and dropped.
 *
 *   - ledger rows whose sha256 is the file's exact fingerprint or its CRLF
 *     fingerprint (so a file whose line ends were changed is named, not just
 *     "unknown");
 *   - the company originator (the same readiness answer releases use);
 *   - the limits ledger for today (the same read releases use).
 *
 * Every failed read is passed to the core as a failure, which turns it into a
 * problem on the page. Nothing is ever shown as "all clear" when it could not
 * be read.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import { readLedgerForLimits } from "@/lib/payments/ach-file-ledger-store";
import { ledgerDbErrorMessage } from "@/lib/payments/ach-file-ledger-core";
import { buildNachaFile, type AchOriginator } from "@/lib/payments/nacha-core";
import { earliestEffectiveDate } from "@/lib/payments/timberland-deadline-core";
import { PAYROLL_DESCRIPTION } from "@/lib/payments/ach-authorization-core";
import { fingerprints, type CheckContext, type LedgerMatchRow } from "@/lib/payments/timberland-file-checker-core";

const KINDS = ["payroll", "vendor", "prenote", "micro_entry"] as const;
const STATUSES = ["released", "uploaded", "bank_approved", "voided"] as const;

/** Ledger rows carrying either fingerprint of the pasted file. */
export async function readLedgerMatches(raw: string): Promise<{ ok: true; rows: LedgerMatchRow[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const fp = fingerprints(raw.replace(/^\uFEFF/, ""));
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_files")
    .select("id, sha256, filename, kind, status, file_date")
    .in("sha256", [...new Set([fp.exact, fp.crlf])])
    .limit(10);
  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };
  const rows: LedgerMatchRow[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const ok =
      typeof r.id === "string" &&
      typeof r.sha256 === "string" &&
      typeof r.filename === "string" &&
      (KINDS as readonly unknown[]).includes(r.kind) &&
      (STATUSES as readonly unknown[]).includes(r.status) &&
      typeof r.file_date === "string";
    if (!ok) return { ok: false, error: "A ledger row could not be read." };
    rows.push({
      id: r.id as string,
      sha256: r.sha256 as string,
      filename: r.filename as string,
      kind: r.kind as LedgerMatchRow["kind"],
      status: r.status as LedgerMatchRow["status"],
      fileDate: r.file_date as string,
    });
  }
  return { ok: true, rows };
}

async function readOriginator(): Promise<CheckContext["originator"]> {
  try {
    const { getOriginatorReadiness } = await import("@/lib/payroll/payroll-store");
    const { readiness } = await getOriginatorReadiness();
    if (!readiness.originator) return { ok: false, error: `the company ACH settings do not match Timberland's setup (Banking > My banking): ${readiness.problems.join(" ")}` };
    return { ok: true, value: readiness.originator };
  } catch {
    return { ok: false, error: "the company ACH settings could not be read." };
  }
}

/** Everything the core needs, read fresh for one check. */
export async function loadCheckContext(raw: string, nowUtc: Date, practice = false): Promise<CheckContext> {
  const today = pacificDayKey(nowUtc);
  const [originator, ledgerMatches, limits] = await Promise.all([
    readOriginator(),
    readLedgerMatches(raw),
    isSupabaseServiceConfigured ? readLedgerForLimits(today) : Promise.resolve({ ok: false as const, error: "Database not connected." }),
  ]);
  return { nowUtc, today, originator, ledgerMatches, limitsLedger: limits.ok ? { ok: true, ledger: limits.ledger } : { ok: false, error: limits.error }, practice };
}

/**
 * The practice run (plan point 5): a real file from the real builder and the
 * REAL company settings, with two made-up test payees at $0 (prenotes, so it
 * would move no money even if someone uploaded it). It is never released,
 * never stored, and the checker warns that it must never be uploaded.
 */
export async function buildPracticeFile(nowUtc: Date): Promise<{ ok: true; file: string; originator: AchOriginator } | { ok: false; error: string }> {
  const o = await readOriginator();
  if (!o.ok) return { ok: false, error: `The practice file needs the company ACH settings: ${o.error}` };
  const effective = earliestEffectiveDate(nowUtc);
  const r = buildNachaFile({
    originator: o.value,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "000000000001", amountCents: 0, name: "PRACTICE PAYEE ONE", idNumber: "PRACTICE1", prenote: true },
      { accountType: "savings", routing: "011000015", accountNumber: "000000000002", amountCents: 0, name: "PRACTICE PAYEE TWO", idNumber: "PRACTICE2", prenote: true },
    ],
    secCode: "PPD",
    companyEntryDescription: PAYROLL_DESCRIPTION,
    effectiveDate: new Date(`${effective}T12:00:00Z`),
    createdAt: nowUtc,
    fileIdModifier: "Z",
  });
  if (!r.ok) return { ok: false, error: `The practice file could not be built: ${r.error}` };
  return { ok: true, file: r.file, originator: o.value };
}
