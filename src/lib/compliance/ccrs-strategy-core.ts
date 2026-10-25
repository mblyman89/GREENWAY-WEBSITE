/**
 * src/lib/compliance/ccrs-strategy-core.ts  (CCRS Bible v2 slice S-18b). PURE.
 *
 * Turns a CCRS error email (read by the S-18a mailbox monitor) into a
 * STRATEGY REPORT the owner can act on: for every error file, what failed,
 * the LCB rule it breaks (quoted, pinned), the fix steps, and what to re-send.
 * When a message has never been seen before, it builds the examiner email as a
 * DRAFT (buildExaminerDraft, drafts-only, AGENTS rule 3). It also plans the
 * owner alert the cron sends once per email (claim in compliance_reminder_log).
 *
 * Nothing here decides ledger state. Apply (S-18a) still runs classifyEcho
 * against the uploaded file; this report only explains and plans.
 *
 * GROUNDING. Every playbook entry is keyed by the EXACT text of a
 * CCRS_KNOWN_MESSAGES entry (each was received in PREprod; the error CSVs are
 * in docs/ccrs-bible/evidence). Every guide/FAQ sentence quoted below is
 * embedded verbatim in SOURCE_QUOTES and re-checked line by line against
 * lcb/guide.txt and lcb/faq.txt wherever those files exist (the test does it),
 * and against the in-repo examiner thread always.
 *
 * WHAT TO RE-SEND. Brian (examiner): "Header and operation errors are full
 * file, individual row errors are specific to that row" [EXAM L0532]. PREprod
 * agrees for row errors (P20261006A: rows not listed were filed) and for the
 * checksum (T-54, whole file). One observation does NOT fit the "operation
 * errors are full file" half: P20261005A's "Operation is invalid ..." came
 * back on 3 of 8 rows and the other 5 were filed (U-17 closure). The report
 * says what was observed and flags the difference instead of choosing.
 */
import { CCRS_KNOWN_MESSAGES, rowIdColumn, type CcrsMessageClass } from "./ccrs-outcome-core";
import { ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";
import { buildExaminerDraft, type ExaminerDraft } from "./ccrs-error-triage-core";
import { knownCcrsMessage, type ErrorAttachment, type AuthVerdict } from "./ccrs-mail-core";

/* ------------------------------------------------------------------ *
 * Verbatim source lines (glyphs and indentation trimmed).
 * ------------------------------------------------------------------ */
export const SOURCE_QUOTES = {
  G: {
    84: "Group 1 file uploads are the Strain, Area, and Product records.",
    85: "o They are required for the Group 2 files.",
    86: "Group 2 file uploads are the Inventory and Plant records.",
    87: "o Inventory is dependent on Strain, Area, and Product files.",
    88: "o Plant is dependent on Strain and Area files.",
    89: "Group 3 file uploads are the Inventory Transfer, Inventory Adjustment, Harvest,",
    201: "NumberRecords",
    202: "The number of records listed below the field names.",
    203: "Note: This number must match the number of records or the file will fail to process.",
    220: "The external identifier is an alpha-numeric identification assigned by the licensee (or integrator).",
    221: "This must be unique for each row.",
    243: "Operation",
    244: "This field indicates the nature of the entry the database will make for the file.",
    245: "Valid Values:",
    246: "Insert (create a new record with a unique external identifier).",
    247: "Update (alter an existing record indicated by external identifier).",
    248: "Delete (delete a record indicated by external identifier).",
    325: "If Duplicate Strain/Strain Type error message is received, the reporting entity does not have an",
    326: "action to take for correction.",
    358: "Strain name is invalid, cannot be Unknown, THC, or Other.",
    434: "If Useable Cannabis is selected, Unit Weight Gram cannot be 0",
    529: "File Dependencies: The inventory file is dependent on existing data records in Strain, Area and",
    530: "Product. Referenced files must be submitted prior to this submission by at least 10 minutes.",
    579: "Invalid Product",
    580: "Note: If you receive this error message, ensure you have already",
    581: "submitted this product on the product.CSV, and validate that you have",
    582: "submitted this product name in the same format and spelling as previously",
    583: "submitted on the product.CSV",
    597: "QuanityOnHand is greater than InitialQuantity",
    614: "TotalCost cannot equal 0",
    1109: "o Required: when Other or Theft is selected for Adjustment reason.",
    1110: "o Error Messages:",
    1111: "Inventory AdjustmentDetail missing",
    1376: "CannabisExciseTax must be numeric (do not use $ symbol or parentheses)",
    1377: "CannabisExciseTax does not equal 37% of UnitPrice",
    1378: "Only Medical Sales can be 0",
    1390: "Duplicate Sale for Licensee",
    1391: "Note: If you have received this error ensure:",
    1392: "Records within a single sale have the same",
    1393: "SaleExternaldentifier.",
    1394: "Records with the same SaleExternalIdentifier have the same",
    1395: "SaleType and SaleDate",
    1396: "All records with the same SaleExternalIdentifier have a unique",
    1397: "SaleDetailExternalIdentifier",
  } as Record<number, string>,
  FAQ: {
    35: "A: CCRS requires a value above $0.00 to be entered on the Total Cost field for an inventory ID to be reported. While the provided Trade Samples do not have a value, a value of $0.01 needs to be entered into the Total Cost field for Trade Samples. Please ensure you are including in the name and Description: Trade Sample.",
    41: "A: Week is defined as Sunday - Saturday.  After the transition period, all licensee weekly reporting will be expected by no later than Sunday for the previous week. Reporting more frequently than weekly is allowed.",
    53: "A: The record doesn't exist, so an error message would be received.",
  } as Record<number, string>,
  EXAM: {
    532: "Header and operation errors are full file, individual row errors are specific to that row, so a file that passes operation and header validation can have 5 rows fail and 1 row pass.",
  } as Record<number, string>,
} as const;

/* ------------------------------------------------------------------ *
 * The playbook: one entry per CCRS_KNOWN_MESSAGES text.
 * ------------------------------------------------------------------ */
/** none: nothing to do. fix-resend: fix in the app, re-send the listed rows. whole-file: re-send the file. confirm: CCRS and our ledger disagree; settle first. */
export type StrategyAction = "none" | "fix-resend" | "whole-file" | "confirm";

export type PlaybookEntry = {
  cls: CcrsMessageClass;
  action: StrategyAction;
  /** Plain language: what CCRS refused and why. */
  meaning: string;
  /** Pins this entry rests on (each line is embedded in SOURCE_QUOTES). */
  cite: string[];
  /** Ordered steps for the owner. */
  fix: string[];
  /** The PREprod run where this exact text was received. */
  seen: string;
};

const RESEND_ROWS = "Export the week again from the hub. The export re-sends only what CCRS does not hold yet; the rows CCRS accepted are never sent as Insert again.";

export const STRATEGY_PLAYBOOK: Record<string, PlaybookEntry> = {
  "Duplicate Strain. The Strain must be unique for the LicenseNumber": {
    cls: "benign",
    action: "none",
    meaning: "CCRS already holds this strain for license 413541. The guide says no correction is needed.",
    cite: ["[G L0325-L0326]"],
    fix: ["Nothing to fix. Apply the error file so the hub records the strain as on file."],
    seen: "2026-09-17 T-11/T-12",
  },
  "Strain name is invalid cannot be Unknown THC or Other": {
    cls: "row",
    action: "fix-resend",
    meaning: "A strain was named Unknown, THC or Other, which CCRS refuses.",
    cite: ["[G L0358]"],
    fix: [
      "Open the product or lot that carries this strain and set its real strain name.",
      RESEND_ROWS,
      "Inventory that names this strain fails until the corrected Strain row is filed, so send the Strain file first.",
    ],
    seen: "2026-09-17 T-14",
  },
  "Duplicate External Identifier": {
    cls: "row-contradicts-ledger",
    action: "confirm",
    meaning:
      "The row was sent as Insert, but CCRS already holds a record with this external identifier. An identifier must be unique, and Insert only creates new records.",
    cite: ["[G L0220-L0221]", "[G L0246-L0247]"],
    fix: [
      "Apply the error file. The hub marks the id \"uncertain\" and holds it out of exports, so it cannot fail the same way again.",
      "If a later Sale or Adjustment that CCRS accepted names the same lot, the hub settles it by itself: CCRS only accepts such a row for inventory it already holds (R6-1).",
      "PREprod (test site) only: press \"Settle PREprod duplicates\" in the PREprod set-up box. PREprod cannot be reset, and the examiner says to work around its data.",
      "Production: settle it with a copy of the data from the CCRS Service Desk (servicedesk@lcb.wa.gov). Until then the id stays out of every export.",
      "Once settled, future changes to it go as Update. Never re-send it as Insert.",
    ],
    seen: "2026-09-17 T-16/T-17/T-33; 2026-10-20 PREprod Inventory (13 lots)",
  },
  "If Useable Cannabis is selected Unit Weight Gram cannot be Zero": {
    cls: "row",
    action: "fix-resend",
    meaning: "A Usable Cannabis product was sent with a unit weight of 0 grams.",
    cite: ["[G L0434]"],
    fix: ["Open the product and enter its unit weight in grams (more than 0).", RESEND_ROWS],
    seen: "2026-09-17 T-18",
  },
  "Total Cost cannot equal zero": {
    cls: "row",
    action: "fix-resend",
    meaning: "An inventory lot was sent with a total cost of 0. CCRS requires more than $0.00; trade samples use $0.01.",
    cite: ["[G L0614]", "[FAQ L0035]"],
    fix: ["Open the lot and enter what it cost. For a trade sample enter $0.01, and put \"Trade Sample\" in its name and description.", RESEND_ROWS],
    seen: "2026-09-17 T-31",
  },
  "QuantityOnHand is greater than InitialQuantity": {
    cls: "row",
    action: "fix-resend",
    meaning: "A lot shows more on hand than was received.",
    cite: ["[G L0597]"],
    fix: ["Open the lot and correct the received quantity or the on-hand count so on hand is not more than received.", RESEND_ROWS],
    seen: "2026-09-17 T-32",
  },
  "ExternalIdentifier not found": {
    cls: "row-contradicts-ledger",
    action: "confirm",
    meaning: "The row was sent as Update, but CCRS holds no record with this identifier. An Update only changes a record that already exists.",
    cite: ["[G L0247]", "[FAQ L0053]"],
    fix: [
      "Apply the error file. The hub marks the id \"uncertain\" and holds it out of exports.",
      "Settle it with a copy of the data from the CCRS Service Desk (servicedesk@lcb.wa.gov). Until then the id stays out of every export.",
      "If the copy shows CCRS does not hold it, it has to be sent as Insert.",
    ],
    seen: "2026-09-17 T-35",
  },
  "Invalid Product": {
    cls: "row",
    action: "fix-resend",
    meaning: "An inventory row names a product CCRS does not hold under that exact name.",
    cite: ["[G L0579-L0583]", "[G L0529-L0530]"],
    fix: [
      "Check that the Product file carrying this product got a CCRS confirmation email.",
      "Check that the inventory names the product with exactly the same spelling as the Product file.",
      "Send the Inventory rows at least 10 minutes after the Product file was submitted.",
      RESEND_ROWS,
    ],
    seen: "2026-09-17 T-37",
  },
  "CheckSum and number of records don't match": {
    cls: "file-fatal",
    action: "whole-file",
    meaning: "The NumberRecords line does not equal the number of data rows, so CCRS refused the whole file. Nothing in it was filed.",
    cite: ["[G L0201-L0203]"],
    fix: [
      "Download the file again from the hub and upload it without opening or editing it. The exporter writes NumberRecords equal to the data rows and checks it before the download.",
      "If the file was not edited by hand, keep the file and the error email and send the examiner draft below.",
    ],
    seen: "2026-09-17 T-54",
  },
  "Inventory Adjustment Details missing": {
    cls: "row",
    action: "fix-resend",
    meaning: "An adjustment with the reason Other or Theft was sent without the adjustment detail text.",
    cite: ["[G L1109-L1111]"],
    fix: ["Open the adjustment and write what happened in its detail field.", RESEND_ROWS],
    seen: "2026-09-17 T-48",
  },
  "Only Medical Sales Excise tax can be 0": {
    cls: "row",
    action: "fix-resend",
    meaning: "A sale line has $0 excise tax but is not a medical sale. Excise must be 37% of the unit price.",
    cite: ["[G L1376-L1378]"],
    fix: ["Find the sale in the POS import and correct its excise (37% of the unit price), or mark it medical only if it was a medical sale.", RESEND_ROWS],
    seen: "2026-09-17 T-42",
  },
  "Operation is invalid must be Insert, Update or Delete": {
    cls: "row",
    action: "fix-resend",
    meaning:
      "CCRS could not read Insert, Update or Delete in the Operation column. In PREprod (P20261005A) this was a comma inside a value: CCRS splits on every comma, so the later values moved one column right and Operation was left blank.",
    cite: ["[G L0243-L0248]", "[EXAM L0532]"],
    fix: [
      "Find the comma in the listed row (usually a product name or description) and remove it in the app.",
      "Since S-09b the exporter rewrites commas in free-text columns and withholds any other row holding one (E42/E44), so a fresh export should not carry it. If it did, send the examiner draft.",
      RESEND_ROWS,
      "Note: Brian wrote that operation errors are full file [EXAM L0532], but in P20261005A only the 3 comma rows failed and the other 5 were filed. Check the confirmation of the re-sent rows before assuming either way.",
    ],
    seen: "2026-10-06 P20261005A",
  },
  "Duplicate Sale for Licensee": {
    cls: "row-contradicts-ledger",
    action: "confirm",
    meaning:
      "The sale was sent as Insert, but CCRS already holds a sale with this SaleExternalIdentifier. In PREprod on 2026-10-25 every row of a re-uploaded, already-accepted Sale file came back this way: CCRS refuses the same sale twice. The guide also lists one other cause: lines of one sale that disagree on SaleType or SaleDate, or share a detail id.",
    cite: ["[G L1390-L1397]"],
    fix: [
      "First check: was this file (or the same sales) already uploaded and accepted? If so, nothing is wrong. Press \"Apply error file\": when every row ties to a file CCRS already answered, the hub sets the email aside by itself with the reason, and records nothing.",
      "Two uploaders (Cultivera and Greenway) filing the same week also causes it. Only one system may file each week.",
      "Otherwise apply the error file. The hub marks the lines \"uncertain\" and holds them out of exports. The exporter already keeps one SaleType and SaleDate per sale and a unique detail id per line [G L1392-L1397], so a fresh export should not repeat it.",
      "Production: settle it with a copy of the data from the CCRS Service Desk (servicedesk@lcb.wa.gov). Never re-send it as Insert.",
    ],
    seen: "2026-10-25 PREprod re-upload",
  },
};

/* ------------------------------------------------------------------ *
 * Building the report.
 * ------------------------------------------------------------------ */
export type MessageFinding = {
  message: string;
  /** Data lines of the error file carrying this message. */
  rows: number;
  /** Identifiers named on those lines (only where the line splits cleanly). */
  ids: string[];
  /** Lines whose id could not be read (the row was shifted by a comma). */
  unreadableIds: number;
  entry: PlaybookEntry | null;
};

export type FileStrategy = {
  filename: string;
  fileType: CcrsRetailerFileType | null;
  typeProblem: string | null;
  dataLines: number;
  /** none / listed-rows / whole-file / unknown (some message has no playbook entry). */
  scope: "none" | "listed-rows" | "whole-file" | "unknown";
  findings: MessageFinding[];
};

export type CcrsStrategy = {
  headline: string;
  files: FileStrategy[];
  /** File types to re-send, in the guide's dependency order. Empty when nothing needs re-sending. */
  resendOrder: CcrsRetailerFileType[];
  /** Why the owner should write to the examiner (empty = no need). */
  examinerReasons: string[];
  examinerDraft: ExaminerDraft | null;
  /** Shown on every report: the weekly deadline and the dependency wait. */
  notes: string[];
};

/** Group 1 -> 2 -> 3 [G L0084-L0089]; Strain/Area/Product before Inventory before the rest. */
export const RESEND_GROUP: Record<CcrsRetailerFileType, number> = {
  Strain: 1,
  Area: 1,
  Product: 1,
  Inventory: 2,
  InventoryAdjustment: 3,
  InventoryTransfer: 3,
  Sale: 3,
};
const TYPE_ORDER: CcrsRetailerFileType[] = ["Strain", "Area", "Product", "Inventory", "InventoryAdjustment", "InventoryTransfer", "Sale"];

const UNREADABLE_PREFIX = "(message not readable";

function lines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
}

/** Message per data line, the same rule readErrorAttachment uses (known text first, else the cell). */
export function findingsFor(e: ErrorAttachment): MessageFinding[] {
  const all = lines(e.csv);
  const head = e.header.length ? e.header : all.length ? ccrsReaderSplit(all[0]).map((h) => h.trim()) : [];
  const at = head.indexOf("ErrorMessage");
  const idCol = e.fileType ? rowIdColumn(e.fileType) : null;
  const idAt = idCol ? head.indexOf(idCol) : -1;
  const by = new Map<string, MessageFinding>();
  for (const l of all.slice(1)) {
    const cells = ccrsReaderSplit(l);
    const clean = cells.length === head.length;
    const cell = clean && at >= 0 ? (cells[at] ?? "").trim() : "";
    const msg = knownCcrsMessage(l) ?? (cell || "(message not readable: the row has a different number of cells than the header)");
    if (!by.has(msg)) by.set(msg, { message: msg, rows: 0, ids: [], unreadableIds: 0, entry: STRATEGY_PLAYBOOK[msg] ?? null });
    const f = by.get(msg)!;
    f.rows += 1;
    const id = clean && idAt >= 0 ? (cells[idAt] ?? "").trim() : "";
    if (id) {
      if (!f.ids.includes(id)) f.ids.push(id);
    } else f.unreadableIds += 1;
  }
  return [...by.values()];
}

function scopeOf(f: readonly MessageFinding[]): FileStrategy["scope"] {
  if (f.some((x) => !x.entry)) return "unknown";
  if (f.some((x) => x.entry!.action === "whole-file")) return "whole-file";
  if (f.every((x) => x.entry!.action === "none")) return "none";
  return "listed-rows";
}

export type StrategyContext = {
  licenseNumber: string;
  licenseeName: string;
  /** The reporting week, when known. Unknown -> the draft keeps a placeholder for the owner to fill in. */
  weekStart?: string | null;
  weekEnd?: string | null;
  contactEmail?: string;
};

export function buildCcrsStrategy(errors: readonly ErrorAttachment[], ctx: StrategyContext): CcrsStrategy {
  const files: FileStrategy[] = errors.map((e) => {
    const findings = findingsFor(e);
    return { filename: e.filename, fileType: e.fileType, typeProblem: e.typeProblem, dataLines: e.dataLines, scope: scopeOf(findings), findings };
  });

  const resend = new Set<CcrsRetailerFileType>();
  for (const f of files) {
    if (!f.fileType) continue;
    if (f.findings.some((x) => x.entry && (x.entry.action === "fix-resend" || x.entry.action === "whole-file"))) resend.add(f.fileType);
  }
  const resendOrder = TYPE_ORDER.filter((t) => resend.has(t));

  const examinerReasons: string[] = [];
  for (const f of files) {
    for (const x of f.findings) {
      if (!x.entry) {
        examinerReasons.push(
          x.message.startsWith(UNREADABLE_PREFIX)
            ? `${f.filename}: ${x.rows} line(s) whose message cannot be read`
            : `${f.filename}: "${x.message}" has never been received before`,
        );
      }
    }
    if (f.typeProblem) examinerReasons.push(`${f.filename}: ${f.typeProblem}`);
  }

  let examinerDraft: ExaminerDraft | null = null;
  if (examinerReasons.length) {
    const excerpt = files
      .flatMap((f) => f.findings.filter((x) => !x.entry || f.typeProblem).map((x) => `${f.filename}: ${x.message} (${x.rows} row(s))`))
      .join("\n");
    examinerDraft = buildExaminerDraft({
      licenseNumber: ctx.licenseNumber,
      licenseeName: ctx.licenseeName,
      weekStart: ctx.weekStart || "[week start]",
      weekEnd: ctx.weekEnd || "[week end]",
      fileTypes: [...new Set(files.map((f) => f.fileType ?? f.filename))],
      errorExcerpt: excerpt || examinerReasons.join("\n"),
      contactEmail: ctx.contactEmail,
    });
  }

  const n = files.length;
  const whole = files.filter((f) => f.scope === "whole-file").length;
  const unknown = files.filter((f) => f.scope === "unknown").length;
  const rows = files.filter((f) => f.scope === "listed-rows").length;
  const parts: string[] = [];
  if (whole) parts.push(`${whole} file(s) refused whole: re-send them`);
  if (rows) parts.push(`${rows} file(s) with refused rows: fix them, then re-send only those rows`);
  if (unknown) parts.push(`${unknown} file(s) with a message never seen before: an examiner draft is ready`);
  const headline = n === 0 ? "No error file in this email." : parts.length ? `${parts.join("; ")}.` : "Nothing to fix: every message is harmless (Duplicate Strain).";

  const notes = [
    "Weekly reports cover Sunday to Saturday. After the transition period they are due by Sunday for the previous week [FAQ L0041]. The end of the transition period is asked of Brian (U-64).",
  ];
  if (resendOrder.length > 1) notes.push("Send the files in the order listed, and wait at least 10 minutes after a file that later files depend on [G L0529-L0530].");
  return { headline, files, resendOrder, examinerReasons, examinerDraft, notes };
}

/* ------------------------------------------------------------------ *
 * The owner alert (claimed once per email in compliance_reminder_log).
 * ------------------------------------------------------------------ */
export const MAIL_ALERT_STAGE = "ccrs_mail_error";
/** Older open mail is not alerted (a channel switched on later must not replay months of mail). */
export const MAIL_ALERT_LOOKBACK_DAYS = 7;
export const MAIL_ALERT_LINK = "/admin/compliance/ccrs#ccrs-mail";

export type MailAlertInput = {
  mailbox: string;
  gmail_id: string;
  kind: "success" | "error" | "unknown" | "not-ccrs";
  subject: string;
  auth: AuthVerdict;
  in_spam: boolean;
};

export type MailAlert = { dedupeKey: string; stage: string; subject: string; text: string; html: string; linkPath: string };

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function mailAlertKey(mailbox: string, gmailId: string): string {
  return `ccrs_mail:${mailbox.toLowerCase()}:${gmailId}`;
}

/** The alert for one stored email, or null (confirmations and non-CCRS mail never alert). */
export function planMailAlert(m: MailAlertInput, s: CcrsStrategy | null, linkOrigin: string): MailAlert | null {
  if (m.kind !== "error" && m.kind !== "unknown") return null;
  const lines: string[] = [];
  if (m.auth === "dmarc-fail") lines.push("WARNING: this email failed the lcb.wa.gov sender check (DMARC). Do not act on it until you have checked it in Gmail.");
  if (m.in_spam) lines.push("Gmail put it in Spam. Mark it \"Not spam\".");
  if (m.kind === "unknown" || !s) {
    lines.push("CCRS sent an email the system does not recognise. Read it in Gmail.");
  } else {
    lines.push(s.headline);
    for (const f of s.files) {
      const msgs = f.findings.map((x) => `${x.message} (${x.rows})`).join("; ");
      lines.push(`${f.filename}: ${msgs}`.slice(0, 400));
    }
    if (s.examinerDraft) lines.push("An examiner email draft is ready on the hub. It is not sent until you send it.");
  }
  const subject = (m.kind === "error" ? `CCRS error file: ${s?.files.length ?? 0} file(s) need attention` : "CCRS sent an email that needs reading").slice(0, 200);
  const url = `${linkOrigin}${MAIL_ALERT_LINK}`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;color:#111;max-width:560px">
  <h2 style="color:#b91c1c;margin-bottom:4px">${escHtml(subject)}</h2>
  ${lines.map((l) => `<p style="line-height:1.5;margin:6px 0">${escHtml(l)}</p>`).join("\n  ")}
  <p><a href="${escHtml(url)}" style="display:inline-block;background:#12351f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the strategy report</a></p>
  <p style="color:#555;font-size:13px">Email subject: ${escHtml(m.subject.slice(0, 200))}. Sent once per CCRS email by the mailbox monitor (S-18b).</p>
</div>`;
  return { dedupeKey: mailAlertKey(m.mailbox, m.gmail_id), stage: MAIL_ALERT_STAGE, subject, text: lines.join(" ").slice(0, 300), html, linkPath: MAIL_ALERT_LINK };
}

/* ------------------------------------------------------------------ *
 * Self-tests (tsx + vitest harnesses).
 * ------------------------------------------------------------------ */
export function __runCcrsStrategyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL ccrs-strategy-core: ${msg}`);
    }
  };
  const att = (filename: string, fileType: CcrsRetailerFileType | null, csv: string): ErrorAttachment => {
    const ls = lines(csv);
    return { filename, fileType, typeProblem: null, header: ccrsReaderSplit(ls[0]).map((h) => h.trim()), dataLines: ls.length - 1, messages: [], csv };
  };
  const ctx = { licenseNumber: "413541", licenseeName: "Greenway Marijuana" };

  // 1. the playbook covers exactly the known messages, with matching class
  const known = CCRS_KNOWN_MESSAGES.map((m) => m.text);
  ok(known.every((t) => STRATEGY_PLAYBOOK[t]), "every known message has a playbook entry");
  ok(Object.keys(STRATEGY_PLAYBOOK).every((t) => known.includes(t)), "no playbook entry without a known message");
  ok(CCRS_KNOWN_MESSAGES.every((m) => STRATEGY_PLAYBOOK[m.text].cls === m.cls), "playbook class equals the known class");
  ok(Object.values(STRATEGY_PLAYBOOK).every((e) => e.cite.length > 0 && e.fix.length > 0), "every entry cites and has steps");

  // 2. strain duplicate only -> nothing to do, nothing to resend, no draft
  const dup = att("Strain_1.csv", "Strain", "LicenseNumber,Strain,CreatedBy,CreatedDate,StrainType,ErrorMessage\r\n413541,Kush,x,09/17/2026,Hybrid,Duplicate Strain. The Strain must be unique for the LicenseNumber\r\n");
  const s1 = buildCcrsStrategy([dup], ctx);
  ok(s1.files[0].scope === "none" && s1.resendOrder.length === 0 && s1.examinerDraft === null, "duplicate strain is no action");
  ok(s1.files[0].findings[0].ids[0] === "Kush", "the strain is the row id");

  // 3. checksum -> whole file
  const cs = att("Inventory_1.csv", "Inventory", "LicenseNumber,ExternalIdentifier,ErrorMessage\r\n413541,I1,CheckSum and number of records don't match\r\n413541,I2,CheckSum and number of records don't match\r\n");
  const s2 = buildCcrsStrategy([cs], ctx);
  ok(s2.files[0].scope === "whole-file" && s2.files[0].findings[0].rows === 2, "checksum refuses the whole file");
  ok(s2.resendOrder[0] === "Inventory", "inventory is re-sent");

  // 4. unknown message -> draft to the examiner with placeholders for the week
  const unk = att("Sale_1.csv", "Sale", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S1,Something brand new\r\n");
  const s3 = buildCcrsStrategy([unk, cs], ctx);
  ok(s3.files[0].scope === "unknown" && !!s3.examinerDraft, "unknown message drafts to the examiner");
  ok(s3.examinerDraft!.to === "examiner@lcb.wa.gov" && s3.examinerDraft!.body.includes("Something brand new"), "draft carries the message");
  ok(s3.examinerDraft!.subject.includes("[week start]"), "unknown week stays a placeholder");
  ok(s3.resendOrder.join() === "Inventory", "unknown file is not put on the resend list");

  // 5. dependency order
  const op = att("Product_1.csv", "Product", "LicenseNumber,ExternalIdentifier,ErrorMessage\r\n413541,P1,Operation is invalid must be Insert, Update or Delete\r\n");
  const s4 = buildCcrsStrategy([cs, op], ctx);
  ok(s4.resendOrder.join() === "Product,Inventory", "Product goes before Inventory");
  ok(s4.notes.some((n) => n.includes("[G L0529-L0530]")), "the 10-minute wait is noted when more than one file");

  // 6. alerts
  const a = planMailAlert({ mailbox: "M@x.com", gmail_id: "g1", kind: "error", subject: "<b>x</b>", auth: "dmarc-fail", in_spam: true }, s4, "https://site");
  ok(!!a && a.dedupeKey === "ccrs_mail:m@x.com:g1", "alert key per mailbox + gmail id");
  ok(!!a && a.html.includes("&lt;b&gt;x&lt;/b&gt;") && !a.html.includes("<b>x</b>"), "email text is escaped");
  ok(!!a && a.html.includes("DMARC"), "dmarc failure is warned");
  ok(planMailAlert({ mailbox: "m", gmail_id: "g", kind: "success", subject: "", auth: "aligned-pass", in_spam: false }, null, "") === null, "confirmations never alert");
  return { passed, failed };
}
