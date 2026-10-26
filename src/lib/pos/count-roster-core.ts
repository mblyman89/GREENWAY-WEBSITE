/**
 * src/lib/pos/count-roster-core.ts — R74 S50: the Oct 30 count WORKBOOK ROSTER (pure).
 *
 * Owner request (Round 31): "generate all the spreadsheets myself, assign them to a person, count,
 * then email their spreadsheet workbooks to me for uploading … an indicator that keeps track of how
 * many spreadsheets are assigned and in use, their name, and whether I uploaded their sheet or not,
 * so I don't accidentally miss one … a way to test this process out on a small scale with real data".
 *
 * The professional shape is the auditors' COUNT-TAG CONTROL: every count document is pre-numbered,
 * issued to a named person for a named area, and the count is not closed until every issued
 * document is accounted for (returned, or voided with a reason). Here the "tag number" is the
 * workbook id the workbook already carries in its very hidden Meta sheet, so an emailed-back file is
 * matched to its roster line by that id, never by its file name (people rename attachments).
 *
 *   sheet lifecycle  unassigned → assigned → downloaded → sent → received   (or void, with a reason)
 *   rosterTally      the tracker numbers + who is still outstanding
 *   matchUploads     uploaded books → roster lines (unknown / void / other roster / already have it)
 *   pickPracticeSample / splitAcross / practiceFillPlan   the small-scale practice run on real lots
 *   readinessChecklist   the audit-day checklist (practice → before → count day → after)
 *
 * No imports, no env, no I/O. Self-tests: __runCountRosterTests (scripts/compliance/run-pure-selftests.ts).
 */

export type CountPlatform = "windows" | "mac";
export type RosterMode = "live" | "test";

export const ROSTER_LIMITS = {
  maxSheets: 30,
  maxPracticeSheets: 6,
  maxPracticeLots: 60,
  defaultPracticeLots: 20,
  maxNameLength: 60,
  maxZoneLength: 80,
  maxEvents: 300,
} as const;

export type RosterReceipt = {
  fileName: string;
  sha256: string;
  bytes: number;
  key: string;
  at: string;
  scans: number;
  handUnits: number;
  /** the counter name typed into the workbook (Meta) */
  counterInFile: string;
  blocking: number;
  warnings: number;
  /** how many earlier files this one replaced (a corrected re-send) */
  replaced: number;
};

/** What a pre-filled practice copy was filled with (so the dry run can prove every unit came back). */
export type PracticeExpectation = {
  filledAt: string;
  /** lower-cased barcode → units written into the workbook (scan rows + hand count) */
  expected: Record<string, number>;
  injected: { code: string; kind: "short" | "over" | "unknown" | "hand"; note: string }[];
};

export type RosterSheet = {
  workbookId: string;
  /** "Sheet 3" — the pre-numbered tag */
  number: number;
  assignee: string;
  zone: string;
  email: string;
  platform: CountPlatform;
  createdAt: string;
  assignedAt: string | null;
  downloads: { at: string; platform: CountPlatform; prefilled: boolean }[];
  sentAt: string | null;
  received: RosterReceipt | null;
  voidedAt: string | null;
  voidReason: string;
  /** practice rosters only: the lots this sheet's person counts (lower-cased barcodes) */
  practiceCodes?: string[];
  practice?: PracticeExpectation | null;
};

export type RosterSource =
  | { kind: "harvest"; runId: string }
  | { kind: "import"; importId: string; sampleCodes: string[] };

export type RosterEvent = { at: string; by: string; what: string };

export type CountRoster = {
  version: 1;
  rosterId: string;
  mode: RosterMode;
  title: string;
  countDate: string;
  source: RosterSource;
  createdAt: string;
  createdBy: string;
  archived: boolean;
  sheets: RosterSheet[];
  events: RosterEvent[];
  /** the combined upload built from every received sheet (live: an import batch) */
  combined: { importId: string; batchId: string; at: string; missing: string[]; canApply: boolean; refusals: number; blocking: number } | null;
  applied: { at: string; batchId: string; adjustments: number } | null;
  /** practice rosters: the stored dry-run result */
  practiceResult: { at: string; verified: boolean; checksPassed: number; checksTotal: number; accuracyPct: number | null } | null;
};

export type SheetStatus = "void" | "received" | "sent" | "downloaded" | "assigned" | "unassigned";

export function sheetStatus(s: RosterSheet): SheetStatus {
  if (s.voidedAt) return "void";
  if (s.received) return "received";
  if (s.sentAt) return "sent";
  if (s.downloads.length > 0) return "downloaded";
  if (s.assignee.trim()) return "assigned";
  return "unassigned";
}

export const SHEET_STATUS_COPY: Record<SheetStatus, string> = {
  unassigned: "Not assigned",
  assigned: "Assigned",
  downloaded: "Downloaded",
  sent: "Sent to counter",
  received: "Uploaded",
  void: "Void",
};

export function cleanName(v: unknown, max: number = ROSTER_LIMITS.maxNameLength): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanEmail(v: unknown): string {
  const e = String(v ?? "").trim().slice(0, 120);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : "";
}

export function platformOf(v: unknown): CountPlatform {
  return String(v ?? "").toLowerCase().startsWith("mac") ? "mac" : "windows";
}

/**
 * "Ana | Back room shelves 1-4 | ana@x.com | mac" one per line → roster seeds. Every part after the
 * name is optional and may come in any order (an @ = email, mac/windows/pc = platform, else area).
 */
export function parseRosterLines(text: string): { assignee: string; zone: string; email: string; platform: CountPlatform }[] {
  const out: { assignee: string; zone: string; email: string; platform: CountPlatform }[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const parts = raw.split(/[|\t;]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const [name, ...rest] = parts;
    let zone = "";
    let email = "";
    let platform: CountPlatform = "windows";
    for (const p of rest) {
      if (p.includes("@")) email = cleanEmail(p);
      else if (/^(mac|macos|apple|imac|macbook)$/i.test(p)) platform = "mac";
      else if (/^(win|windows|pc|microsoft)$/i.test(p)) platform = "windows";
      else zone = zone ? `${zone}, ${p}` : p;
    }
    out.push({ assignee: cleanName(name), zone: cleanName(zone, ROSTER_LIMITS.maxZoneLength), email, platform });
    if (out.length >= ROSTER_LIMITS.maxSheets) break;
  }
  return out.filter((r) => r.assignee);
}

export function newSheet(workbookId: string, number: number, at: string, seed?: Partial<Pick<RosterSheet, "assignee" | "zone" | "email" | "platform">>): RosterSheet {
  const assignee = cleanName(seed?.assignee ?? "");
  return {
    workbookId,
    number,
    assignee,
    zone: cleanName(seed?.zone ?? "", ROSTER_LIMITS.maxZoneLength),
    email: cleanEmail(seed?.email ?? ""),
    platform: seed?.platform ?? "windows",
    createdAt: at,
    assignedAt: assignee ? at : null,
    downloads: [],
    sentAt: null,
    received: null,
    voidedAt: null,
    voidReason: "",
  };
}

export function pushEvent(r: CountRoster, at: string, by: string, what: string): void {
  r.events.push({ at, by, what: what.slice(0, 300) });
  if (r.events.length > ROSTER_LIMITS.maxEvents) r.events.splice(0, r.events.length - ROSTER_LIMITS.maxEvents);
}

/* ---------------- the tracker ---------------- */

export type RosterTally = {
  total: number;
  active: number;
  void: number;
  unassigned: number;
  assigned: number;
  downloaded: number;
  sent: number;
  received: number;
  /** active sheets not uploaded yet */
  outstanding: { number: number; assignee: string; zone: string; status: SheetStatus }[];
  /** received sheets whose file still has a blocking problem (re-send needed) */
  needsFix: { number: number; assignee: string; blocking: number }[];
  receivedPct: number;
  assignedPct: number;
  allAssigned: boolean;
  allOut: boolean;
  allIn: boolean;
  scans: number;
  handUnits: number;
};

export function rosterTally(r: Pick<CountRoster, "sheets">): RosterTally {
  const t: RosterTally = {
    total: r.sheets.length, active: 0, void: 0, unassigned: 0, assigned: 0, downloaded: 0, sent: 0, received: 0,
    outstanding: [], needsFix: [], receivedPct: 0, assignedPct: 0, allAssigned: false, allOut: false, allIn: false, scans: 0, handUnits: 0,
  };
  for (const s of r.sheets) {
    const st = sheetStatus(s);
    if (st === "void") { t.void++; continue; }
    t.active++;
    if (st === "unassigned") t.unassigned++;
    else t.assigned++;
    if (s.downloads.length > 0 || s.sentAt || s.received) t.downloaded++;
    if (s.sentAt || s.received) t.sent++;
    if (s.received) {
      t.received++;
      t.scans += s.received.scans;
      t.handUnits += s.received.handUnits;
      if (s.received.blocking > 0) t.needsFix.push({ number: s.number, assignee: s.assignee, blocking: s.received.blocking });
    } else t.outstanding.push({ number: s.number, assignee: s.assignee, zone: s.zone, status: st });
  }
  const pct = (a: number) => (t.active === 0 ? 0 : Math.round((a / t.active) * 100));
  t.receivedPct = pct(t.received);
  t.assignedPct = pct(t.assigned);
  t.allAssigned = t.active > 0 && t.unassigned === 0;
  t.allOut = t.active > 0 && t.downloaded === t.active;
  t.allIn = t.active > 0 && t.received === t.active && t.needsFix.length === 0;
  return t;
}

/* ---------------- matching emailed-back workbooks ---------------- */

export type UploadedBook = {
  fileName: string;
  sha256: string;
  workbookId: string | null;
  rosterId: string | null;
  mode: RosterMode | null;
  counter: string;
  countDate: string;
  scans: number;
  handUnits: number;
  blocking: number;
  warnings: number;
};

export type UploadMatch =
  | { kind: "new"; book: UploadedBook; sheetNumber: number }
  | { kind: "replace"; book: UploadedBook; sheetNumber: number }
  | { kind: "same"; book: UploadedBook; sheetNumber: number }
  | { kind: "refused"; book: UploadedBook; reason: string };

/**
 * Each uploaded book → its roster line, by the workbook id in Meta. Refused (never stored): not a
 * count workbook, a workbook from another roster / a practice book on a live roster (or the reverse),
 * a voided sheet, the wrong count date, or the same workbook twice in one upload.
 */
export function matchUploads(r: CountRoster, books: UploadedBook[]): UploadMatch[] {
  const byId = new Map(r.sheets.map((s) => [s.workbookId.toLowerCase(), s]));
  const seen = new Set<string>();
  const out: UploadMatch[] = [];
  for (const b of books) {
    const id = (b.workbookId ?? "").toLowerCase();
    const s = id ? byId.get(id) : undefined;
    if (!id) { out.push({ kind: "refused", book: b, reason: "it is not a Greenway count workbook (or it was saved by an app that dropped its hidden id sheet, like Numbers or Google Sheets)" }); continue; }
    if (!s) {
      const why = b.rosterId && b.rosterId !== r.rosterId ? "it belongs to a different roster" : "its workbook id is not on this roster";
      out.push({ kind: "refused", book: b, reason: why });
      continue;
    }
    if (b.mode && b.mode !== r.mode) { out.push({ kind: "refused", book: b, reason: b.mode === "test" ? "it is a PRACTICE workbook" : "it is a live workbook, not a practice one" }); continue; }
    if (s.voidedAt) { out.push({ kind: "refused", book: b, reason: `sheet ${s.number} was voided (${s.voidReason || "no reason"})` }); continue; }
    if (b.countDate && b.countDate !== r.countDate) { out.push({ kind: "refused", book: b, reason: `it is for the count on ${b.countDate}, this roster is ${r.countDate}` }); continue; }
    if (seen.has(id)) { out.push({ kind: "refused", book: b, reason: `sheet ${s.number} is in this upload twice (keep the newest file only)` }); continue; }
    seen.add(id);
    if (s.received && s.received.sha256 === b.sha256) out.push({ kind: "same", book: b, sheetNumber: s.number });
    else if (s.received) out.push({ kind: "replace", book: b, sheetNumber: s.number });
    else out.push({ kind: "new", book: b, sheetNumber: s.number });
  }
  return out;
}

export function uploadSentence(m: UploadMatch[]): string {
  const n = (k: UploadMatch["kind"]) => m.filter((x) => x.kind === k).length;
  const parts: string[] = [];
  if (n("new")) parts.push(`${n("new")} new sheet(s) uploaded`);
  if (n("replace")) parts.push(`${n("replace")} replaced with a newer file`);
  if (n("same")) parts.push(`${n("same")} already uploaded (identical file, nothing changed)`);
  const refused = m.filter((x): x is Extract<UploadMatch, { kind: "refused" }> => x.kind === "refused");
  if (refused.length) parts.push(`${refused.length} refused: ${refused.map((x) => `${x.book.fileName} (${x.reason})`).join("; ")}`);
  return parts.length ? `${parts.join(". ")}.` : "Nothing was uploaded.";
}

/* ---------------- file names + email ---------------- */

export function workbookFileName(r: Pick<CountRoster, "mode" | "countDate">, s: Pick<RosterSheet, "number" | "assignee" | "zone" | "workbookId">, platform: CountPlatform): string {
  const slug = (v: string, n: number) => v.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, n);
  const who = slug(s.assignee, 30) || "unassigned";
  const zone = slug(s.zone, 24);
  const tag = platform === "mac" ? "MAC" : "WINDOWS";
  return `${r.mode === "test" ? "PRACTICE-" : ""}greenway-count-${r.countDate}-sheet${String(s.number).padStart(2, "0")}-${who}${zone ? `-${zone}` : ""}-${tag}-${s.workbookId.slice(0, 8)}.xlsx`;
}

/** A mailto: link with the subject and instructions filled in (the owner attaches the file). */
export function mailtoFor(r: Pick<CountRoster, "mode" | "countDate">, s: Pick<RosterSheet, "number" | "assignee" | "zone" | "email" | "platform">, replyTo: string): string {
  const practice = r.mode === "test" ? "PRACTICE " : "";
  const subject = `${practice}Greenway count workbook — sheet ${s.number}${s.zone ? ` (${s.zone})` : ""}`;
  const app = s.platform === "mac" ? "Microsoft Excel for Mac (not Numbers)" : "the Microsoft Excel app (click Enable Editing if a yellow bar appears)";
  const body = [
    `Hi ${s.assignee || "there"},`,
    "",
    `Attached is your ${practice.toLowerCase()}count workbook for ${r.countDate}${s.zone ? `, area: ${s.zone}` : ""}. It is made for you only; please do not forward or copy it.`,
    "",
    `1. Save the attachment, then open it in ${app}.`,
    "2. Read the Start Here tab, turn off AutoComplete once, and test one scan.",
    "3. Scan every unit on the Scan tab. Items you cannot scan go on the Hand Count tab with a quantity.",
    `4. Save (keep it .xlsx) and email the file back as an attachment${replyTo ? ` to ${replyTo}` : ""}. Please do not rename it or send a link instead of the file.`,
    "",
    "Thank you!",
  ].join("\n");
  return `mailto:${encodeURIComponent(s.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------------- practice run on real lots ---------------- */

/** Small deterministic PRNG (mulberry32) seeded from a string — same input, same practice set. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PracticeLot = { code: string; productName: string; onHand: number; category?: string | null };

/**
 * A spread of real lots for a practice count: lots with stock, a mix of small and large quantities,
 * spread across categories (stratified, not the first N). Barcodes that are the start of another
 * barcode are skipped (they must be hand counted, which the live count already covers).
 */
export function pickPracticeSample(lots: PracticeLot[], n: number, seed: string): PracticeLot[] {
  const want = Math.max(1, Math.min(ROSTER_LIMITS.maxPracticeLots, Math.floor(n) || ROSTER_LIMITS.defaultPracticeLots));
  const codes = lots.map((l) => l.code.toLowerCase());
  const isPrefix = (c: string) => codes.some((o) => o !== c && o.startsWith(c));
  const pool = lots.filter((l) => l.code.trim() && l.onHand > 0 && l.onHand <= 2000 && !isPrefix(l.code.toLowerCase()));
  const byCat = new Map<string, PracticeLot[]>();
  for (const l of pool) {
    const k = (l.category ?? "").trim() || "Uncategorized";
    byCat.set(k, [...(byCat.get(k) ?? []), l]);
  }
  const rand = rng(seed);
  const groups = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => {
    const sorted = [...g].sort((a, b) => a.onHand - b.onHand || a.code.localeCompare(b.code));
    // shuffle within quantity terciles so both small and large counts show up
    const out: PracticeLot[] = [];
    const third = Math.max(1, Math.ceil(sorted.length / 3));
    const parts = [sorted.slice(0, third), sorted.slice(third, third * 2), sorted.slice(third * 2)].map((p) => p.sort(() => rand() - 0.5));
    while (parts.some((p) => p.length)) for (const p of parts) { const x = p.shift(); if (x) out.push(x); }
    return out;
  });
  const picked: PracticeLot[] = [];
  while (picked.length < want && groups.some((g) => g.length)) {
    for (const g of groups) {
      const x = g.shift();
      if (x) picked.push(x);
      if (picked.length >= want) break;
    }
  }
  return picked.sort((a, b) => a.productName.localeCompare(b.productName) || a.code.localeCompare(b.code));
}

/** Deal items across sheets like cards, so each practice counter gets a fair share. */
export function splitAcross<T>(items: T[], sheets: number): T[][] {
  const n = Math.max(1, Math.floor(sheets));
  const out: T[][] = Array.from({ length: n }, () => []);
  items.forEach((x, i) => out[i % n].push(x));
  return out;
}

export const PRACTICE_UNKNOWN_BARCODE = "PRACTICE-NOT-A-REAL-LOT";

/**
 * What a pre-filled practice copy contains: every lot on the sheet "counted" at today's system
 * on-hand, except a few deliberate discrepancies the dry run must catch — one short, one over, a
 * barcode that is not in Cultivera, and one item entered on the Hand Count sheet. Small quantities
 * are written as one scan row per unit (like a scanner would); big ones go on Hand Count.
 */
export function practiceFillPlan(lots: PracticeLot[], seed: string, opts: { scanRowLimit: number; handRowLimit: number; perLotScanMax?: number }): {
  scans: string[];
  hand: { barcode: string; qty: number; note: string }[];
  expectation: Omit<PracticeExpectation, "filledAt">;
} {
  const perLotScanMax = opts.perLotScanMax ?? 24;
  const rand = rng(`fill:${seed}`);
  const order = [...lots].sort((a, b) => a.code.localeCompare(b.code));
  const idx = order.map((_, i) => i).sort(() => rand() - 0.5);
  const shortI = order.length >= 2 ? idx[0] : -1;
  const overI = order.length >= 3 ? idx[1] : -1;
  const handI = order.length >= 4 ? idx[2] : -1;
  const scans: string[] = [];
  const hand: { barcode: string; qty: number; note: string }[] = [];
  const expected: Record<string, number> = {};
  const injected: PracticeExpectation["injected"] = [];
  order.forEach((l, i) => {
    let qty = Math.max(0, Math.floor(l.onHand));
    if (i === shortI && qty > 0) { qty -= 1; injected.push({ code: l.code, kind: "short", note: `1 unit short of the system's ${l.onHand}` }); }
    if (i === overI) { qty += 2; injected.push({ code: l.code, kind: "over", note: `2 units over the system's ${l.onHand}` }); }
    const toHand = i === handI || qty > perLotScanMax || scans.length + qty > opts.scanRowLimit;
    if (toHand) {
      if (hand.length >= opts.handRowLimit) return;
      hand.push({ barcode: l.code, qty, note: i === handI ? "practice: entered by hand" : "practice: large quantity" });
      if (i === handI) injected.push({ code: l.code, kind: "hand", note: `entered on the Hand Count sheet (${qty})` });
    } else for (let k = 0; k < qty; k++) scans.push(l.code);
    expected[l.code.toLowerCase()] = (expected[l.code.toLowerCase()] ?? 0) + qty;
  });
  if (scans.length < opts.scanRowLimit) {
    scans.push(PRACTICE_UNKNOWN_BARCODE);
    expected[PRACTICE_UNKNOWN_BARCODE.toLowerCase()] = 1;
    injected.push({ code: PRACTICE_UNKNOWN_BARCODE, kind: "unknown", note: "a barcode that is not in Cultivera (must show as unknown)" });
  }
  return { scans, hand, expectation: { expected, injected } };
}

export type PracticeCheck = { label: string; ok: boolean; detail: string };

/**
 * The dry run's proof. For a pre-filled sheet, every unit written must come back exactly and every
 * injected discrepancy must be flagged. For a sheet counted by hand there is nothing to compare
 * against, so only "uploaded and readable" is checked.
 */
export function practiceChecks(input: {
  sheets: { number: number; assignee: string; received: boolean; blocking: number; practice: Omit<PracticeExpectation, "filledAt"> | null }[];
  /** lower-cased barcode → units counted across all accepted books */
  counted: Record<string, number>;
  /** lower-cased barcode → plan outcome */
  lines: Record<string, { delta: number; exception: string | null; onHand: number | null; counted: number }>;
}): PracticeCheck[] {
  const checks: PracticeCheck[] = [];
  const active = input.sheets;
  const got = active.filter((s) => s.received);
  checks.push({ label: "Every practice sheet was uploaded", ok: active.length > 0 && got.length === active.length, detail: `${got.length} of ${active.length} uploaded` });
  const clean = got.filter((s) => s.blocking === 0);
  checks.push({ label: "Every uploaded sheet is readable (no blocking problem)", ok: got.length > 0 && clean.length === got.length, detail: `${clean.length} of ${got.length} clean` });
  const filled = got.filter((s) => s.practice);
  if (filled.length === 0) {
    checks.push({ label: "Counts were compared with the system", ok: Object.keys(input.lines).length > 0, detail: "Counted by hand (no pre-filled copy), so the variances below are real findings, not a self-check." });
    return checks;
  }
  let units = 0;
  const wrong: string[] = [];
  const expectAll: Record<string, number> = {};
  for (const s of filled) for (const [k, v] of Object.entries(s.practice!.expected)) expectAll[k] = (expectAll[k] ?? 0) + v;
  for (const [k, v] of Object.entries(expectAll)) {
    units += v;
    if ((input.counted[k] ?? 0) < v) wrong.push(`${k}: wrote ${v}, read ${input.counted[k] ?? 0}`);
  }
  checks.push({ label: "Every unit written into the workbooks was read back exactly", ok: wrong.length === 0, detail: wrong.length ? wrong.slice(0, 5).join("; ") : `${units.toLocaleString("en-US")} units across ${Object.keys(expectAll).length} barcodes` });
  const inj = filled.flatMap((s) => s.practice!.injected);
  for (const j of inj) {
    const l = input.lines[j.code.toLowerCase()];
    let ok = false;
    if (j.kind === "unknown") ok = l?.exception === "unknown_barcode";
    else if (j.kind === "short") ok = !!l && (l.delta < 0 || l.exception != null);
    else if (j.kind === "over") ok = !!l && (l.delta > 0 || l.exception != null);
    else if (j.kind === "hand") ok = !!l && l.counted === (expectAll[j.code.toLowerCase()] ?? -1);
    const what = { short: "A short count was caught", over: "An over count was caught", unknown: "A barcode not in Cultivera was flagged", hand: "A Hand Count entry was read" }[j.kind];
    checks.push({ label: what, ok, detail: `${j.code} — ${j.note}${l ? ` → counted ${l.counted}, system ${l.onHand ?? "none"}${l.exception ? `, flagged ${l.exception}` : `, change ${l.delta > 0 ? "+" : ""}${l.delta}`}` : " → not found"}` });
  }
  return checks;
}

/* ---------------- the audit-day checklist ---------------- */

export const MANUAL_STEPS = [
  { key: "zones", phase: "Before count day", label: "Every shelf, drawer, vault and back-room area is on a sheet's area (no gaps, no overlaps)" },
  { key: "scanners", phase: "Before count day", label: "Every scanner passed the test box (step 0) on the computer it will be used with" },
  { key: "autocomplete", phase: "Before count day", label: "Excel AutoComplete is OFF on every Windows PC and Mac that will count" },
  { key: "briefing", phase: "Before count day", label: "Counters briefed: one scan = one unit, never copy a workbook, Hand Count for unscannable items" },
  { key: "freeze", phase: "Count day", label: "No receiving, transfers or returns into stock while the back room is counted" },
  { key: "fetch", phase: "After the count", label: "After closing on the sales day, Fetch with the count date set and stage that harvest" },
] as const;
export type ManualKey = (typeof MANUAL_STEPS)[number]["key"];

export type ChecklistItem = { key: string; phase: string; label: string; detail: string; state: "done" | "todo" | "warn" };

export function readinessChecklist(input: {
  practice: CountRoster | null;
  live: CountRoster | null;
  manual: Partial<Record<ManualKey, string | null>>;
}): { items: ChecklistItem[]; done: number; total: number; pct: number; next: ChecklistItem | null } {
  const items: ChecklistItem[] = [];
  const add = (key: string, phase: string, label: string, ok: boolean, detail: string, warn = false) => items.push({ key, phase, label, detail, state: ok ? "done" : warn ? "warn" : "todo" });
  const p = input.practice;
  const pt = p ? rosterTally(p) : null;
  add("practice_made", "Practice run", "Make a practice roster from the imported menu", !!p, p ? `${p.title} · ${pt!.active} sheet(s) · ${p.source.kind === "import" ? p.source.sampleCodes.length : 0} real lots` : "Not yet");
  add("practice_out", "Practice run", "Download the practice workbooks (Windows and Mac)", !!pt && pt.allOut, pt ? `${pt.downloaded} of ${pt.active} downloaded` : "—");
  add("practice_in", "Practice run", "Upload every practice workbook back", !!pt && pt.allIn, pt ? `${pt.received} of ${pt.active} uploaded${pt.needsFix.length ? `, ${pt.needsFix.length} need a fix` : ""}` : "—", !!pt && pt.needsFix.length > 0);
  const pr = p?.practiceResult ?? null;
  add("practice_pass", "Practice run", "Run the practice reconciliation: every check green", !!pr && pr.verified, pr ? `${pr.checksPassed} of ${pr.checksTotal} checks passed${pr.accuracyPct != null ? ` · accuracy ${pr.accuracyPct}%` : ""}` : "Not run yet", !!pr && !pr.verified);
  for (const m of MANUAL_STEPS.filter((x) => x.phase === "Before count day")) {
    const at = input.manual[m.key];
    add(`manual_${m.key}`, m.phase, m.label, !!at, at ? `Ticked ${at.slice(0, 16).replace("T", " ")} UTC` : "Tick it when it is true");
  }
  const l = input.live;
  const lt = l ? rosterTally(l) : null;
  add("live_made", "Before count day", "Make the live roster for the count date", !!l, l ? `${l.title} · count ${l.countDate} · ${lt!.active} sheet(s)` : "Not yet");
  add("live_assigned", "Before count day", "Assign every sheet to a person", !!lt && lt.allAssigned, lt ? `${lt.assigned} of ${lt.active} assigned` : "—");
  add("live_out", "Before count day", "Download / email every sheet to its counter", !!lt && lt.allOut, lt ? `${lt.downloaded} of ${lt.active} out · ${lt.sent} marked sent` : "—");
  for (const m of MANUAL_STEPS.filter((x) => x.phase === "Count day")) {
    const at = input.manual[m.key];
    add(`manual_${m.key}`, m.phase, m.label, !!at, at ? `Ticked ${at.slice(0, 16).replace("T", " ")} UTC` : "Tick it when it is true");
  }
  add("live_in", "Count day", "Every sheet emailed back and uploaded", !!lt && lt.allIn, lt ? (lt.outstanding.length ? `Missing: ${lt.outstanding.map((o) => `#${o.number} ${o.assignee || "(unassigned)"}`).join(", ")}` : `${lt.received} of ${lt.active} uploaded`) : "—", !!lt && lt.needsFix.length > 0);
  for (const m of MANUAL_STEPS.filter((x) => x.phase === "After the count")) {
    const at = input.manual[m.key];
    add(`manual_${m.key}`, m.phase, m.label, !!at, at ? `Ticked ${at.slice(0, 16).replace("T", " ")} UTC` : "Tick it when it is true");
  }
  const c = l?.combined ?? null;
  add("live_preview", "After the count", "Combine every uploaded sheet into one preview with no refusals", !!c && c.canApply, c ? `Built ${c.at.slice(0, 16).replace("T", " ")} UTC · ${c.refusals} refusal(s), ${c.blocking} blocking problem(s)${c.missing.length ? ` · built WITHOUT ${c.missing.length} sheet(s)` : ""}` : "Not built yet", !!c && !c.canApply);
  add("live_applied", "After the count", "Apply the count (CCRS reconciliation adjustments)", !!l?.applied, l?.applied ? `Applied ${l.applied.at.slice(0, 16).replace("T", " ")} UTC · ${l.applied.adjustments} lot(s) adjusted` : "Not applied");
  const done = items.filter((i) => i.state === "done").length;
  return { items, done, total: items.length, pct: Math.round((done / items.length) * 100), next: items.find((i) => i.state !== "done") ?? null };
}

/* ---------------- self-tests ---------------- */

export function __runCountRosterTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL count-roster-core: " + msg);
    passed += 1;
  };
  const at = "2026-10-20T10:00:00.000Z";
  const roster: CountRoster = {
    version: 1, rosterId: "r1", mode: "live", title: "Oct 30", countDate: "2026-10-30", source: { kind: "harvest", runId: "run" },
    createdAt: at, createdBy: "m", archived: false, events: [], combined: null, applied: null, practiceResult: null,
    sheets: [newSheet("aaaaaaaa-1", 1, at, { assignee: "Ana", zone: "Back room" }), newSheet("bbbbbbbb-2", 2, at), newSheet("cccccccc-3", 3, at, { assignee: "Joe" })],
  };
  // 1-2 parse lines
  const seeds = parseRosterLines("Ana | Back room | ana@x.com | mac\n\n  Joe\tFloor\tpc\nBad | not-an-email@ ");
  ok(seeds.length === 3 && seeds[0].platform === "mac" && seeds[0].email === "ana@x.com" && seeds[0].zone === "Back room", "roster line parsed (any order, mac, email)");
  ok(seeds[1].zone === "Floor" && seeds[1].platform === "windows" && seeds[2].email === "", "tab separated + bad email dropped");
  // 3-5 status + tally
  ok(sheetStatus(roster.sheets[0]) === "assigned" && sheetStatus(roster.sheets[1]) === "unassigned", "status from fields");
  roster.sheets[0].downloads.push({ at, platform: "mac", prefilled: false });
  roster.sheets[2].voidedAt = at;
  let t = rosterTally(roster);
  ok(t.active === 2 && t.void === 1 && t.assigned === 1 && t.downloaded === 1 && t.outstanding.length === 2 && !t.allAssigned, "tally counts void out");
  // 6-10 matching
  const book = (id: string | null, sha: string, extra: Partial<UploadedBook> = {}): UploadedBook => ({ fileName: `${sha}.xlsx`, sha256: sha, workbookId: id, rosterId: "r1", mode: "live", counter: "Ana", countDate: "2026-10-30", scans: 5, handUnits: 1, blocking: 0, warnings: 0, ...extra });
  const m = matchUploads(roster, [book("AAAAAAAA-1", "s1"), book("aaaaaaaa-1", "s1b"), book("cccccccc-3", "s3"), book("zzz", "sz", { rosterId: "other" }), book(null, "sn"), book("bbbbbbbb-2", "s2", { mode: "test" })]);
  ok(m[0].kind === "new" && m[0].sheetNumber === 1, "matched by workbook id, case-insensitive");
  ok(m[1].kind === "refused" && /twice/.test((m[1] as { reason: string }).reason), "same sheet twice in one upload refused");
  ok(m[2].kind === "refused" && /voided/.test((m[2] as { reason: string }).reason), "voided sheet refused");
  ok(m[3].kind === "refused" && /different roster/.test((m[3] as { reason: string }).reason) && m[4].kind === "refused", "other roster / no id refused");
  ok(m[5].kind === "refused" && /PRACTICE/.test((m[5] as { reason: string }).reason), "practice book refused on a live roster");
  roster.sheets[0].received = { fileName: "a", sha256: "s1", bytes: 1, key: "k", at, scans: 5, handUnits: 1, counterInFile: "Ana", blocking: 0, warnings: 0, replaced: 0 };
  const m2 = matchUploads(roster, [book("aaaaaaaa-1", "s1"), book("bbbbbbbb-2", "x", { countDate: "2026-10-31" })]);
  ok(m2[0].kind === "same" && m2[1].kind === "refused" && matchUploads(roster, [book("aaaaaaaa-1", "new")])[0].kind === "replace", "same file / wrong date / replace");
  ok(/1 already uploaded/.test(uploadSentence(m2)) && /1 refused/.test(uploadSentence(m2)), "upload sentence");
  t = rosterTally(roster);
  ok(t.received === 1 && t.receivedPct === 50 && t.outstanding.length === 1 && t.outstanding[0].number === 2, "tracker: received 1 of 2, sheet 2 outstanding");
  // file name + mailto
  const fn = workbookFileName(roster, roster.sheets[0], "mac");
  ok(fn === "greenway-count-2026-10-30-sheet01-Ana-Back-room-MAC-aaaaaaaa.xlsx", `file name ${fn}`);
  ok(workbookFileName({ ...roster, mode: "test" }, roster.sheets[1], "windows").startsWith("PRACTICE-") && /unassigned-WINDOWS/.test(workbookFileName(roster, roster.sheets[1], "windows")), "practice + unassigned names");
  const mt = mailtoFor(roster, { ...roster.sheets[0], email: "ana@x.com", platform: "mac" }, "boss@x.com");
  ok(mt.startsWith("mailto:ana%40x.com?subject=") && decodeURIComponent(mt).includes("not Numbers") && decodeURIComponent(mt).includes("boss@x.com"), "mailto has Mac advice + reply-to");
  // sample
  const lots: PracticeLot[] = Array.from({ length: 50 }, (_, i) => ({ code: `L${String(i).padStart(3, "0")}`, productName: `P${i}`, onHand: i % 7, category: i % 2 ? "Flower" : "Edible" }));
  lots.push({ code: "L00", productName: "prefix", onHand: 5, category: "Flower" });
  const s1 = pickPracticeSample(lots, 10, "seed");
  ok(s1.length === 10 && s1.every((l) => l.onHand > 0) && !s1.some((l) => l.code === "L00"), "sample: 10 lots with stock, prefix barcode skipped");
  ok(JSON.stringify(s1) === JSON.stringify(pickPracticeSample(lots, 10, "seed")) && new Set(s1.map((l) => l.category)).size === 2, "sample deterministic + spread across categories");
  const parts = splitAcross(s1, 3);
  ok(parts.length === 3 && parts[0].length === 4 && parts[2].length === 3, "split like cards");
  // fill plan
  const fill = practiceFillPlan([{ code: "A1", productName: "a", onHand: 3 }, { code: "B2", productName: "b", onHand: 2 }, { code: "C3", productName: "c", onHand: 40 }, { code: "D4", productName: "d", onHand: 1 }], "w1", { scanRowLimit: 5000, handRowLimit: 300 });
  const kinds = fill.expectation.injected.map((j) => j.kind).sort().join(",");
  ok(kinds === "hand,over,short,unknown", `fill injects short/over/hand/unknown (${kinds})`);
  const written = fill.scans.length + fill.hand.reduce((a, h) => a + h.qty, 0);
  ok(written === Object.values(fill.expectation.expected).reduce((a, v) => a + v, 0), "expectation equals what is written");
  ok(fill.hand.some((h) => h.barcode === "C3" && h.qty >= 39) && fill.scans.includes(PRACTICE_UNKNOWN_BARCODE), "big qty on Hand Count, unknown barcode scanned");
  // checks
  const counted: Record<string, number> = { ...fill.expectation.expected };
  const lines: Record<string, { delta: number; exception: string | null; onHand: number | null; counted: number }> = {};
  for (const j of fill.expectation.injected) {
    const k = j.code.toLowerCase();
    lines[k] = j.kind === "unknown" ? { delta: 0, exception: "unknown_barcode", onHand: null, counted: 1 } : { delta: j.kind === "short" ? -1 : j.kind === "over" ? 2 : 0, exception: null, onHand: 1, counted: counted[k] };
  }
  const ch = practiceChecks({ sheets: [{ number: 1, assignee: "A", received: true, blocking: 0, practice: fill.expectation }], counted, lines });
  ok(ch.length === 7 && ch.every((c) => c.ok), "all practice checks pass on a faithful round trip");
  const bad = practiceChecks({ sheets: [{ number: 1, assignee: "A", received: true, blocking: 0, practice: fill.expectation }, { number: 2, assignee: "B", received: false, blocking: 0, practice: null }], counted: { ...counted, c3: 0 }, lines });
  ok(!bad[0].ok && bad.some((c) => /read back/.test(c.label) && !c.ok), "missing sheet + lost units fail");
  // checklist
  const cl0 = readinessChecklist({ practice: null, live: null, manual: {} });
  ok(cl0.done === 0 && cl0.total === 16 && cl0.next?.key === "practice_made", "empty checklist: 16 steps, next = practice");
  const cl1 = readinessChecklist({ practice: null, live: roster, manual: { zones: at } });
  ok(cl1.items.find((i) => i.key === "live_made")!.state === "done" && cl1.items.find((i) => i.key === "manual_zones")!.state === "done" && /Missing: #2/.test(cl1.items.find((i) => i.key === "live_in")!.detail), "checklist reads roster + manual ticks + names the missing");
  return { passed, failed: 0 };
}
