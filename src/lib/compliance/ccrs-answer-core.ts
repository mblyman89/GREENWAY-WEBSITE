/**
 * src/lib/compliance/ccrs-answer-core.ts  (R74 S48, Round 29). PURE.
 *
 * WHAT HAPPENED (2026-10-25). Every answer button in the hub said "Mark the
 * file uploaded first": the files had been uploaded to CCRS and CCRS had
 * answered them, but nobody pressed "Mark uploaded" in the hub, so they sat in
 * state `emitted` and 0249 only takes an answer for an `uploaded` file. A new
 * export then re-sent the Sales Floor Area and 1,500 strains those unanswered
 * files already carried, and CCRS answered "Duplicate ..." to all of them.
 *
 * WHAT THIS MODULE DECIDES
 *   1. A CCRS email about a file still `emitted` is itself proof the file was
 *      uploaded. The hub marks it uploaded first (time: CCRS's "Date
 *      Submitted", else the email's arrival, never before the file was made,
 *      never in the future) with a logged reason, then records the answer.
 *   2. Which unanswered files to warn about before a new export.
 *   3. Strains and Areas carried by a file still waiting for an answer count as
 *      on file while planning the next export (as an earlier file of the same
 *      emission already does), so they are not sent twice. If that file is
 *      abandoned it stops counting and the next export sends them again.
 */
import type { LedgerEntry, LedgerView } from "./ccrs-ledger-core";
import { buildLedgerView } from "./ccrs-ledger-core";

/** States in which CCRS has not yet answered a file the hub handed out. */
export const UNANSWERED_STATES: readonly string[] = ["emitted", "uploaded"];

export function isUnansweredState(state: string): boolean {
  return UNANSWERED_STATES.includes(state);
}

/** Logged on the file when the hub marks it uploaded from a CCRS email (10+ characters, 0249). */
export const AUTO_UPLOAD_REASON =
  "Recorded from the CCRS email: CCRS received and answered this file, so it was uploaded (the hub had not been told).";

/**
 * The upload time recorded for a file the hub learns about from a CCRS email:
 * CCRS's own "Date Submitted" when it gave one, else the email's arrival;
 * clamped to [file made, now]. null when the file has no emission time.
 */
export function autoUploadTimeISO(emittedAt: string | null, evidenceAt: string | null, nowMs: number): string | null {
  const made = emittedAt ? Date.parse(emittedAt) : NaN;
  if (!Number.isFinite(made)) return null;
  const ev = evidenceAt ? Date.parse(evidenceAt) : NaN;
  const t = Number.isFinite(ev) ? ev : nowMs;
  return new Date(Math.min(nowMs, Math.max(made, t))).toISOString();
}

/** An email cannot answer a file made after it arrived (1 minute of clock slack). */
export function couldAnswer(emittedAt: string | null, emailAt: string | null): boolean {
  if (!emittedAt || !emailAt) return true;
  const made = Date.parse(emittedAt);
  const got = Date.parse(emailAt);
  if (!Number.isFinite(made) || !Number.isFinite(got)) return true;
  return made <= got + 60_000;
}

export type UnansweredFileLite = { fileName: string; fileType: string; state: string; stampAt: string | null };

/** Oldest first: the order they must be answered in. */
export function unansweredFiles<T extends UnansweredFileLite>(files: readonly T[]): T[] {
  return files
    .filter((f) => isUnansweredState(f.state))
    .sort((a, b) => ((a.stampAt ?? "") < (b.stampAt ?? "") ? -1 : (a.stampAt ?? "") > (b.stampAt ?? "") ? 1 : 0));
}

/** The plain-English warning (hub banner + zip README). Empty when nothing is waiting. */
export function unansweredWarningLines(files: readonly UnansweredFileLite[]): string[] {
  const open = unansweredFiles(files);
  if (open.length === 0) return [];
  return [
    `WARNING: ${open.length} earlier file(s) are still waiting for their CCRS answer:`,
    ...open.map((f) => `  ${f.fileName} (${f.state === "uploaded" ? "uploaded, waiting for the CCRS email" : "handed out, never marked uploaded"})`),
    "Answer them first: Compliance > CCRS > \"Answer every waiting CCRS email\". If one was never uploaded, Abandon it.",
    "Until then the new strains, Areas, products, lots, sale lines and adjustments those files carry are NOT sent again",
    "(no \"Duplicate\" errors; they show as \"already in a file waiting for its CCRS answer\" and are not owed), and",
    "a new upload stays out of order (CCRS answers files in the order they arrive).",
  ];
}

/* ------------------------------------------------------------------ *
 * In-flight Strain / Area (items 3 and 4).
 * ------------------------------------------------------------------ */
export type InflightRow = { fileType: string; fileName: string; operation: string | null; payload: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Ledger entries for the Strain / Area rows of files still waiting for an
 * answer, which the ledger does not hold in any state (a strain in any
 * casing). Treated as `filed` for PLANNING ONLY; nothing is written.
 */
export function inflightEntries(view: LedgerView, rows: readonly InflightRow[]): { entries: LedgerEntry[]; files: string[]; strains: number; areas: string[] } {
  const entries: LedgerEntry[] = [];
  const files = new Set<string>();
  const seen = new Set<string>();
  let strains = 0;
  const areas: string[] = [];
  for (const r of rows) {
    if (r.fileType === "Strain") {
      const s = str(r.payload.Strain);
      if (!s) continue;
      const fold = s.toLowerCase();
      if (view.strainsByFold.has(fold) || seen.has(`S${fold}`)) continue;
      seen.add(`S${fold}`);
      entries.push({ fileType: "Strain", externalId: s, filedName: s, state: "filed" });
      files.add(r.fileName);
      strains += 1;
    } else if (r.fileType === "Area" && r.operation === "Insert") {
      const id = str(r.payload.ExternalIdentifier);
      const name = str(r.payload.Area);
      if (!id || !name || view.entries.has(`Area\u0000${id}`) || seen.has(`A${id}`)) continue;
      seen.add(`A${id}`);
      entries.push({ fileType: "Area", externalId: id, filedName: name, state: "filed" });
      files.add(r.fileName);
      areas.push(name);
    }
  }
  return { entries, files: [...files].sort(), strains, areas };
}

/** The view with the in-flight entries added (planning only). */
export function withInflight(view: LedgerView, rows: readonly InflightRow[]): { view: LedgerView; strains: number; areas: string[]; files: string[] } {
  const add = inflightEntries(view, rows);
  if (add.entries.length === 0) return { view, strains: 0, areas: [], files: [] };
  const merged = buildLedgerView(view.env, [...view.entries.values(), ...add.entries], view.productIdByKey);
  if (merged.duplicates.length > 0) throw new Error(`in-flight entries collide with the ledger: ${merged.duplicates.join(", ")}`);
  return { view: merged.view, strains: add.strains, areas: add.areas, files: add.files };
}

export function inflightNote(x: { strains: number; areas: string[]; files: string[] }): string | null {
  if (x.strains === 0 && x.areas.length === 0) return null;
  const what = [x.strains ? `${x.strains} strain(s)` : "", x.areas.length ? `the ${x.areas.join(", ")} Area` : ""].filter(Boolean).join(" and ");
  return `${what} left out of this export: an earlier file still waiting for its CCRS answer already carries them (${x.files.join(", ")}). Sending them again only brings back "Duplicate" errors. Answer that file first; if it was never uploaded, Abandon it and export again so they go out.`;
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsAnswerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-answer-core: ${m}`);
    }
  };
  const now = Date.parse("2026-10-25T23:00:00Z");
  ok(autoUploadTimeISO("2026-10-25T19:21:00Z", "2026-10-25T19:30:00Z", now) === "2026-10-25T19:30:00.000Z", "evidence time used");
  ok(autoUploadTimeISO("2026-10-25T19:21:00Z", "2026-10-25T19:00:00Z", now) === "2026-10-25T19:21:00.000Z", "never before the file was made");
  ok(autoUploadTimeISO("2026-10-25T19:21:00Z", "2026-10-26T19:00:00Z", now) === "2026-10-25T23:00:00.000Z", "never in the future");
  ok(autoUploadTimeISO("2026-10-25T19:21:00Z", null, now) === "2026-10-25T23:00:00.000Z", "no evidence -> now");
  ok(autoUploadTimeISO(null, "2026-10-25T19:30:00Z", now) === null, "no emission time");
  ok(couldAnswer("2026-10-25T22:40:00Z", "2026-10-25T21:20:00Z") === false, "a later file cannot be answered by an earlier email");
  ok(couldAnswer("2026-10-25T19:21:00Z", "2026-10-25T21:20:00Z") && couldAnswer(null, null), "earlier file fits");
  ok(isUnansweredState("emitted") && isUnansweredState("uploaded") && !isUnansweredState("closed"), "states");
  ok(AUTO_UPLOAD_REASON.length >= 10, "reason long enough for 0249");
  const files = [
    { fileName: "Sale_1.csv", fileType: "Sale", state: "emitted", stampAt: "2026-10-25T19:21:19Z" },
    { fileName: "Area_1.csv", fileType: "Area", state: "uploaded", stampAt: "2026-10-25T19:21:16Z" },
    { fileName: "Strain_0.csv", fileType: "Strain", state: "closed", stampAt: "2026-10-20T19:21:16Z" },
  ];
  ok(unansweredFiles(files).map((f) => f.fileName).join() === "Area_1.csv,Sale_1.csv", "oldest first, answered left out");
  const w = unansweredWarningLines(files);
  ok(w[0].includes("2 earlier file(s)") && w.join(" ").includes("Abandon"), "warning text");
  ok(unansweredWarningLines([files[2]]).length === 0, "nothing waiting, no warning");
  const view = buildLedgerView("preprod", [
    { fileType: "Strain", externalId: "Blue Dream", filedName: "Blue Dream", state: "filed" },
    { fileType: "Area", externalId: "GWA-OLD", filedName: "Old", state: "filed" },
  ]).view;
  const rows: InflightRow[] = [
    { fileType: "Strain", fileName: "Strain_1.csv", operation: null, payload: { Strain: "blue dream" } },
    { fileType: "Strain", fileName: "Strain_1.csv", operation: null, payload: { Strain: "Jetset" } },
    { fileType: "Strain", fileName: "Strain_2.csv", operation: null, payload: { Strain: "JETSET" } },
    { fileType: "Area", fileName: "Area_1.csv", operation: "Insert", payload: { Area: "Sales Floor", ExternalIdentifier: "GWA-SALES-FLOOR" } },
    { fileType: "Area", fileName: "Area_1.csv", operation: "Update", payload: { Area: "Old", ExternalIdentifier: "GWA-OLD" } },
  ];
  const m = withInflight(view, rows);
  ok(m.strains === 1 && m.areas.join() === "Sales Floor", "one new strain (any casing), one area insert");
  ok(m.view.strainsByFold.has("jetset") && m.view.entries.has("Area\u0000GWA-SALES-FLOOR"), "merged into the planning view");
  ok(withInflight(view, []).view === view, "nothing in flight -> same view");
  ok((inflightNote(m) ?? "").includes("Abandon") && inflightNote({ strains: 0, areas: [], files: [] }) === null, "note");
  return { passed, failed };
}
