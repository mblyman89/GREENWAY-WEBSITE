/**
 * src/lib/payments/ach-reversal-sheet-core.ts  (R41 S13, PURE: no I/O, no clock)
 *
 * The reversal call sheet. Brenda (Email 3, answer 7): "Yes you would call us
 * to reverse a file.  The reversal will be completed using the original
 * uploaded file and should be used in a cautionary manner". Greenway's setup
 * has no debit files (Schedule C), so a reversal is a phone call to Timberland
 * Cash Management, and Timberland needs to find the original file and the
 * wrong payment in it. This sheet is built from the EXACT stored bytes of the
 * released file (ach_files, 0273; the SHA-256 and header facts are re-checked
 * by readAchFileForDownload before this runs) and lists what to read out:
 * file name, file date and File ID Modifier, effective date, upload time,
 * number of payments, total, fingerprint, and every payment with its name,
 * amount and trace number.
 *
 * NO ACCOUNT NUMBERS: the payee's account field (positions 13-29 of each
 * entry record) and the receiving routing number are never read into the
 * sheet. The trace number is what the builder wrote in positions 80-94: the
 * originating bank's first 8 routing digits plus the entry's sequence number
 * in this file (nacha-core.ts). Brenda did not say which detail Cash
 * Management asks for, so the sheet lists every one we hold except account
 * numbers. Field positions are the builder's own (nacha-core.ts entry record).
 */
import { headerFacts } from "@/lib/payments/ach-file-ledger-core";
import { REVERSAL_BANKING_DAYS, REVERSAL_HOURS_FROM_DISCOVERY, TIMBERLAND_PHONE } from "@/lib/payments/timberland-profile-core";

export const EMAIL3_REVERSAL_QUOTE = {
  file: "ach/timberland-brenda-2026-10-19-email-3.txt",
  section: "Email 3, answer 7 (Q8)",
  text: "Yes you would call us to reverse a file.  The reversal will be completed using the original uploaded file and should be used in a cautionary manner",
} as const;

/** Only a file that went to Timberland can need a reversal; a file not yet uploaded is voided instead. */
export const SHEET_STATUSES = ["uploaded", "bank_approved"] as const;

export type SheetFileRow = {
  filename: string;
  kind: string;
  status: string;
  file_date: string;
  file_id_modifier: string;
  effective_date: string;
  settlement_date: string | null;
  entry_count: number;
  total_cents: number;
  sha256: string;
  uploaded_at: string | null;
};

export type SheetEntry = { seq: number; name: string; amountCents: number; trace: string; kindText: string };

export type ReversalSheet = { ok: true; entries: SheetEntry[]; text: string } | { ok: false; error: string };

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Wed Oct 21, 3:05 pm Pacific" for an ISO instant. */
function pacific(iso: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()} Pacific`;
}

const KIND_TEXT: Record<string, string> = { "22": "credit to checking", "32": "credit to savings", "23": "prenote (checking, $0)", "33": "prenote (savings, $0)" };

/** Each entry record, read for the sheet: never the account or the receiving routing. */
export function sheetEntries(body: string): { ok: true; entries: SheetEntry[] } | { ok: false; error: string } {
  const rows = body.split(/\r?\n/).filter((r) => r.length > 0);
  const out: SheetEntry[] = [];
  for (const r of rows) {
    if (r[0] !== "6") continue;
    if (r.length !== 94) return { ok: false, error: "An entry record is not 94 characters. The sheet was not made." };
    const code = r.slice(1, 3);
    const amount = r.slice(29, 39);
    const trace = r.slice(79, 94);
    if (!/^\d{10}$/.test(amount) || !/^\d{15}$/.test(trace)) return { ok: false, error: "An entry record has a bad amount or trace number. The sheet was not made." };
    out.push({ seq: Number(trace.slice(8)), name: r.slice(54, 76).trim(), amountCents: Number(amount), trace, kindText: KIND_TEXT[code] ?? `transaction code ${code}` });
  }
  return { ok: true, entries: out };
}

/** The whole sheet as plain text (printable, no account numbers). */
export function reversalSheet(body: string, row: SheetFileRow): ReversalSheet {
  if (!(SHEET_STATUSES as readonly string[]).includes(row.status)) {
    return { ok: false, error: row.status === "voided" ? "This file was voided: it never went to Timberland, so there is nothing to reverse." : "This file is not marked uploaded to Timberland yet. If it should not go out, void it instead: nothing needs reversing." };
  }
  const f = headerFacts(body);
  if (!f.ok) return { ok: false, error: f.error };
  if (f.facts.entryCount !== row.entry_count || f.facts.totalCreditCents !== Number(row.total_cents) || f.facts.effectiveDate !== row.effective_date || f.facts.modifier !== row.file_id_modifier) {
    return { ok: false, error: "The stored file does not match its record. The sheet was not made; ask your developer." };
  }
  const e = sheetEntries(body);
  if (!e.ok) return e;
  const lines = [
    "REVERSAL CALL SHEET (no account numbers on this page)",
    "",
    `Call Timberland Bank, Cash Management: ${TIMBERLAND_PHONE}`,
    `Brenda (Email 3): "${EMAIL3_REVERSAL_QUOTE.text}".`,
    `Section 21: within ${REVERSAL_BANKING_DAYS} banking days of the original payment AND within ${REVERSAL_HOURS_FROM_DISCOVERY} hours of finding the error.`,
    "A reversal may not get the money back. Tell the payee before the reversal settles.",
    "",
    "THE ORIGINAL FILE",
    `  File name ............ ${row.filename}`,
    `  Kind ................. ${row.kind.replace("_", " ")}`,
    `  File date / ID ....... ${row.file_date} / File ID Modifier ${row.file_id_modifier}`,
    `  Effective date ....... ${row.effective_date}`,
    `  Settlement date ...... ${row.settlement_date ?? "not recorded (the next banking day on or after the effective date)"}`,
    `  Uploaded ............. ${row.uploaded_at ? pacific(row.uploaded_at) : "time not recorded"}`,
    `  Payments ............. ${row.entry_count}`,
    `  Total ................ ${usd(Number(row.total_cents))}`,
    `  SHA-256 .............. ${row.sha256}`,
    "",
    "THE PAYMENTS IN IT (tick the wrong one)",
    ...e.entries.map((x) => `  [ ] #${x.seq}  ${x.name.padEnd(22)}  ${usd(x.amountCents).padStart(12)}  trace ${x.trace}  (${x.kindText})`),
    "",
    "WRITE DOWN",
    "  Who you spoke to: ____________________   Time (Pacific): __________",
    "  What Timberland said: ______________________________________________",
    "",
    "Then log it on the Operations page: \"A wrong or duplicate payment went out (reversal)\".",
  ];
  return { ok: true, entries: e.entries, text: lines.join("\n") + "\n" };
}

export function __runAchReversalSheetCoreTests(fixture: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ach-reversal-sheet-core self-test FAILED: ${name}`);
    }
  };
  const f = headerFacts(fixture);
  if (!f.ok) {
    ok(false, "fixture readable");
    return { passed, failed };
  }
  const row: SheetFileRow = { filename: "GW-test.ach", kind: "payroll", status: "uploaded", file_date: f.facts.fileDate, file_id_modifier: f.facts.modifier, effective_date: f.facts.effectiveDate, settlement_date: null, entry_count: f.facts.entryCount, total_cents: f.facts.totalCreditCents, sha256: "ab".repeat(32), uploaded_at: "2026-10-20T22:05:00.000Z" };
  const s = reversalSheet(fixture, row);
  ok(s.ok, "an uploaded file makes a sheet");
  if (s.ok) {
    ok(s.entries.length === f.facts.entryCount, "one line per payment");
    ok(s.entries.every((x, i) => x.seq === i + 1 && /^\d{15}$/.test(x.trace)), "sequence and trace from the file");
    ok(s.entries.reduce((a, x) => a + x.amountCents, 0) === f.facts.totalCreditCents, "amounts add to the File Control total");
    ok(s.text.includes("Cash Management: 1-800-562-8761"), "who to call");
    ok(s.text.includes("Tue Oct 20 2026, 3:05 pm Pacific"), "upload time in Pacific");
    ok(s.text.includes(`${EMAIL3_REVERSAL_QUOTE.text}`), "Brenda's answer quoted");
    const accts = fixture.split(/\r?\n/).filter((r) => r[0] === "6").map((r) => r.slice(12, 29).trim());
    ok(accts.length > 0 && accts.every((a) => !s.text.includes(a)), "no payee account number on the sheet");
    const routings = fixture.split(/\r?\n/).filter((r) => r[0] === "6").map((r) => r.slice(3, 12));
    ok(routings.every((r) => !s.text.includes(r)), "no receiving routing number on the sheet");
  }
  ok(!reversalSheet(fixture, { ...row, status: "released" }).ok, "a file not uploaded: void it instead");
  ok(/voided/.test((reversalSheet(fixture, { ...row, status: "voided" }) as { error: string }).error ?? ""), "a voided file: nothing to reverse");
  ok(reversalSheet(fixture, { ...row, status: "bank_approved" }).ok, "an approved file makes a sheet");
  ok(!reversalSheet(fixture, { ...row, total_cents: row.total_cents + 1 }).ok, "record and bytes must agree (total)");
  ok(!reversalSheet(fixture, { ...row, entry_count: row.entry_count + 1 }).ok, "record and bytes must agree (count)");
  ok(!sheetEntries(fixture.replace(/\n6/, "\n6X")).ok, "a broken entry record refuses");
  return { passed, failed };
}
