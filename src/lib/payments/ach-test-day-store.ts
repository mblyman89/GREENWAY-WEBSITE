/**
 * R41 S21: reads the live state for the Test day page. READ ONLY: it calls
 * the same readers ACH operations, the ACH files list, the first-file gate,
 * My banking and Notice email already use, and writes nothing. Any read that
 * fails comes back as null, which the core never shows as done or ready.
 * No account number leaves this file: only payee name, type and last 4.
 */
import "server-only";
import { opsPageView } from "./ach-ops-store";
import { listAchFiles, readFirstFileGate } from "./ach-file-ledger-store";
import { getOriginatorReadiness } from "@/lib/payroll/payroll-store";
import { getNoticeSettings } from "./ach-notice-mail-store";
import { catchesBrendaSample } from "./ach-notice-mail-core";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import type { TestDayState } from "./ach-test-day-core";

export async function readTestDayState(todayIso: string): Promise<TestDayState> {
  const [orig, view, files, gate, notice] = await Promise.all([
    getOriginatorReadiness().catch(() => null),
    opsPageView(todayIso).catch(() => null),
    listAchFiles(200).catch(() => null),
    readFirstFileGate(todayIso).catch(() => null),
    getNoticeSettings().catch(() => null),
  ]);
  return {
    todayIso,
    originator: orig ? { ready: orig.readiness.ready, problems: orig.readiness.problems } : null,
    checks:
      view && view.ready && !view.error
        ? view.checks.map((c) => ({
            payee: c.payee,
            accountType: c.accountType,
            accountLast4: c.accountLast4,
            verificationStatus: c.verificationStatus,
            authState: c.authState,
            open: c.open ? { method: c.open.method, status: c.open.status, eligibleOn: c.open.eligible_on, stepKind: c.open.step.kind } : null,
          }))
        : null,
    prenoteFiles:
      files && files.tableReady && !files.error
        ? files.rows.filter((f) => f.kind === "prenote").map((f) => ({ filename: f.filename, status: f.status, effectiveDate: f.effective_date }))
        : null,
    gate: gate && gate.ok ? { open: gate.gate.open, stage: gate.gate.open ? undefined : gate.gate.stage, line: gate.gate.line } : null,
    noticeSendersOk: notice ? catchesBrendaSample(notice.senders) : null,
  };
}

/** True when the server can decrypt bank numbers (the prenote file needs them). Never reveals the key. */
export function encryptionKeySet(): boolean {
  return isAtRestEncryptionConfigured();
}
