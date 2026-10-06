/**
 * CCRS file lifecycle — Bible v2 Part 05 §A, slice S-12a. PURE (no I/O, no clock).
 *
 *   draft ──assemble+hash──► emitted ──operator uploads──► uploaded
 *                              │ abandon                     │ success email ► succeeded ► closed
 *                              ▼                             │ error email   ► errored ─► closed | reconciling
 *                          abandoned                         │ no email (SLA)► reconciling ► closed
 *
 * The same transition set is enforced in the database by
 * public.ccrs_files_guard() (migration 0247); a vitest parses both and
 * requires them to be identical, so the two can never drift.
 *
 * Grounding: Brian A29 "The exact same file name will not be accepted twice,
 * nor would the data." → name/bytes fixed once emitted, never regenerated
 * (Transactional Outbox, [SRC S6]). Brian A24 / U-17 CLOSED FALSE (PREprod
 * P20261006A): CCRS accepts row-by-row, so a success email does not prove
 * every row landed and an error email does not reject every row — rows go
 * `uncertain` until reconciled (Part 05 §A table).
 */

export const CCRS_FILE_STATES = [
  "draft",
  "emitted",
  "uploaded",
  "succeeded",
  "errored",
  "reconciling",
  "closed",
  "abandoned",
] as const;
export type CcrsFileState = (typeof CCRS_FILE_STATES)[number];

/** Every legal `from>to` edge (Part 05 §A arrows and table "Exit" column). */
export const CCRS_FILE_TRANSITIONS: readonly `${CcrsFileState}>${CcrsFileState}`[] = [
  "draft>emitted",
  "emitted>uploaded",
  "emitted>abandoned",
  "uploaded>succeeded",
  "uploaded>errored",
  "uploaded>reconciling",
  "succeeded>closed",
  "errored>closed",
  "errored>reconciling",
  "reconciling>closed",
];

export const CCRS_FILE_TERMINAL: ReadonlySet<CcrsFileState> = new Set(["closed", "abandoned"]);

export class CcrsFileStateError extends Error {
  constructor(public readonly code: "BAD_TRANSITION" | "IMMUTABLE" | "UNKNOWN_STATE" | "IN_FLIGHT", message: string) {
    super(message);
    this.name = "CcrsFileStateError";
  }
}

export function isLegalFileTransition(from: CcrsFileState, to: CcrsFileState): boolean {
  return (CCRS_FILE_TRANSITIONS as readonly string[]).includes(`${from}>${to}`);
}

/** Throws unless `from → to` is a legal edge. Same-state is not a transition. */
export function assertFileTransition(from: string, to: string): void {
  for (const s of [from, to]) {
    if (!(CCRS_FILE_STATES as readonly string[]).includes(s)) {
      throw new CcrsFileStateError("UNKNOWN_STATE", `unknown CCRS file state "${s}"`);
    }
  }
  if (!isLegalFileTransition(from as CcrsFileState, to as CcrsFileState)) {
    throw new CcrsFileStateError("BAD_TRANSITION", `${from} -> ${to} is not a legal CCRS file transition`);
  }
}

/** The fields that are fixed once a file leaves `draft` (mirrors ccrs_files_guard). */
export const CCRS_FILE_IMMUTABLE_FIELDS = ["sha256", "fileName", "numberRecords", "env", "fileType", "storagePath"] as const;
export type CcrsFileFacts = Record<(typeof CCRS_FILE_IMMUTABLE_FIELDS)[number], string | number | null>;

/** Throws if any immutable field differs while the file is past `draft`. */
export function assertFileImmutable(state: CcrsFileState, before: CcrsFileFacts, after: CcrsFileFacts): void {
  if (state === "draft") return;
  const changed = CCRS_FILE_IMMUTABLE_FIELDS.filter((k) => before[k] !== after[k]);
  if (changed.length) {
    throw new CcrsFileStateError("IMMUTABLE", `file left draft; cannot change ${changed.join(", ")}`);
  }
}

/**
 * Part 05 §A: "a row may be in exactly one non-abandoned file per
 * (env, file_type, external_id, operation) while that file is not closed".
 * Returns the conflicting keys (empty = safe to plan `candidate`).
 */
export type InFlightRow = { env: string; fileType: string; externalId: string; operation: string | null; fileState: CcrsFileState; fileName: string };
export function inFlightConflicts(
  existing: readonly InFlightRow[],
  candidate: readonly Omit<InFlightRow, "fileState" | "fileName">[],
): { key: string; fileName: string }[] {
  const open = new Map<string, string>();
  const k = (r: { env: string; fileType: string; externalId: string; operation: string | null }) =>
    `${r.env}\u0000${r.fileType}\u0000${r.externalId}\u0000${r.operation ?? ""}`;
  for (const r of existing) {
    if (r.fileState === "closed" || r.fileState === "abandoned") continue;
    open.set(k(r), r.fileName);
  }
  const out: { key: string; fileName: string }[] = [];
  for (const c of candidate) {
    const f = open.get(k(c));
    if (f) out.push({ key: `${c.fileType}/${c.externalId}/${c.operation ?? "-"}`, fileName: f });
  }
  return out;
}

export function __runCcrsFileStateCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-file-state-core: " + m); };
  const throwsCode = (f: () => void, code: string) => { try { f(); return false; } catch (e) { return e instanceof CcrsFileStateError && e.code === code; } };
  for (const t of CCRS_FILE_TRANSITIONS) { const [a, b] = t.split(">"); assertFileTransition(a, b); }
  let illegal = 0;
  for (const a of CCRS_FILE_STATES) for (const b of CCRS_FILE_STATES) {
    if (!isLegalFileTransition(a, b)) { illegal += 1; assert(throwsCode(() => assertFileTransition(a, b), "BAD_TRANSITION"), `${a}>${b} must throw`); }
  }
  assert(illegal === 64 - CCRS_FILE_TRANSITIONS.length, "every non-edge is illegal");
  for (const s of CCRS_FILE_TERMINAL) assert(!CCRS_FILE_TRANSITIONS.some((t) => t.startsWith(s + ">")), `${s} is terminal`);
  assert(throwsCode(() => assertFileTransition("draft", "sent"), "UNKNOWN_STATE"), "unknown state");
  const f: CcrsFileFacts = { sha256: "a".repeat(64), fileName: "Inventory_413541_20261007120000.csv", numberRecords: 3, env: "prod", fileType: "Inventory", storagePath: "p" };
  assertFileImmutable("draft", f, { ...f, sha256: "b".repeat(64) });
  assert(throwsCode(() => assertFileImmutable("emitted", f, { ...f, numberRecords: 4 }), "IMMUTABLE"), "count fixed after emit");
  assertFileImmutable("closed", f, { ...f });
  const ex: InFlightRow[] = [
    { env: "prod", fileType: "Inventory", externalId: "L1", operation: "Update", fileState: "uploaded", fileName: "A" },
    { env: "prod", fileType: "Inventory", externalId: "L2", operation: "Update", fileState: "closed", fileName: "B" },
  ];
  const c = inFlightConflicts(ex, [
    { env: "prod", fileType: "Inventory", externalId: "L1", operation: "Update" },
    { env: "prod", fileType: "Inventory", externalId: "L2", operation: "Update" },
    { env: "preprod", fileType: "Inventory", externalId: "L1", operation: "Update" },
  ]);
  assert(c.length === 1 && c[0].fileName === "A", "only the open file conflicts; env separates");
  console.log("ccrs-file-state-core: all tests passed");
}
