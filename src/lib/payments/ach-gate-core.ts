/**
 * src/lib/payments/ach-gate-core.ts  (R41 S0, PURE)
 *
 * The decisions behind src/lib/payments/ach-gate.ts, kept pure so they can be
 * tested exhaustively:
 *
 *   - KIND_SPECS: for every ACH action kind, which form field names the record
 *     it changes, which row is that record, and which columns make up its
 *     "version". D-7 (owner, round 6: "yes"): a request never expires, but it
 *     is refused if the record changed after it was sent. The version is the
 *     SHA-256 of those columns, so it never stores a bank number, even an
 *     encrypted one.
 *   - redirectOutcome: every ACH server action ends in redirect(url) with
 *     ?error=... on failure and ?msg= / ?ok= / ?note= on success. When the
 *     owner approves a request, the action is replayed and its redirect is
 *     caught (Next 16 redirect() throws an error whose digest is
 *     "NEXT_REDIRECT;<type>;<url>;<status>;", see
 *     node_modules/next/dist/client/components/redirect.js getRedirectError);
 *     this reads the result in words from that URL.
 *   - summaryArray: the masked summary in the shape the 0271 table wants
 *     (a JSON array).
 *
 * The column names below were read from the real schema (all 271 migrations
 * applied to Postgres 15, information_schema.columns) and a vitest pins each
 * one against the migration text.
 */
import { createHash } from "node:crypto";
import type { AchActionKind } from "@/lib/auth/ach-authority-core";
import { ACH_ACTION_KINDS } from "@/lib/auth/ach-authority-core";

/** The 0271 ach_change_requests.target_type CHECK list. */
export const TARGET_TYPES = [
  "vendor",
  "employee",
  "authorization",
  "account",
  "verification",
  "notice",
  "document",
  "contact",
  "invite",
  "payroll_run",
  "company",
  "vendor_payment",
  // R41 S3 / 0273: a released ACH file (void requests).
  "ach_file",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export type VersionSpec = {
  table: string;
  /** Column matched against the target id. */
  key: string;
  /** Columns whose values make up the version. */
  cols: readonly string[];
  /** true: every matching row (a vendor's contacts); false: one row. */
  many?: boolean;
};

export type KindSpec = {
  targetType: TargetType;
  /** Form field that holds the target id; null = no single record (or the id is passed in). */
  idField: string | null;
  /** null = nothing to compare: the replay re-checks everything live (documented per kind). */
  version: VersionSpec | null;
};

const VAULT: VersionSpec = { table: "vendor_bank_details", key: "vendor_id", cols: ["status", "updated_at", "released_at", "verified_at", "archived_at"] };
const AUTH: VersionSpec = { table: "ach_authorizations", key: "id", cols: ["state", "legal_hold", "annual_review_due_on", "updated_at"] };

export const KIND_SPECS: Readonly<Record<AchActionKind, KindSpec>> = {
  "vendor_bank.save": { targetType: "vendor", idField: "vendor_id", version: VAULT },
  "vendor_bank.hold": { targetType: "vendor", idField: "vendor_id", version: VAULT },
  "vendor_bank.release": { targetType: "vendor", idField: "vendor_id", version: VAULT },
  "vendor_bank.verify": { targetType: "vendor", idField: "vendor_id", version: VAULT },
  "vendor_bank.archive": { targetType: "vendor", idField: "vendor_id", version: VAULT },
  // A callback contact added or retired after the request changes the list the release relies on.
  "vendor_contact.add": { targetType: "vendor", idField: "vendor_id", version: { table: "payee_contacts", key: "vendor_id", cols: ["id", "value", "retired_at"], many: true } },
  "vendor_contact.retire": { targetType: "contact", idField: "contact_id", version: { table: "payee_contacts", key: "id", cols: ["retired_at"] } },
  "employee_bank.save": { targetType: "employee", idField: "employee_id", version: { table: "employees", key: "id", cols: ["bank_routing", "bank_account_number", "bank_account_type", "bank_changed_at"] } },
  "employee_bank.clear": { targetType: "employee", idField: "employee_id", version: { table: "employees", key: "id", cols: ["bank_routing", "bank_account_number", "bank_account_type", "bank_changed_at"] } },
  // A stop action runs at once for Stephen (option B): never a request, so no version.
  "ach_notice.log": { targetType: "notice", idField: null, version: null },
  "ach_notice.resolve": { targetType: "notice", idField: "notice_id", version: { table: "ach_return_notices", key: "id", cols: ["resolved_at"] } },
  "employee_hold.release": { targetType: "authorization", idField: "auth_id", version: AUTH },
  "ach_check.start": { targetType: "account", idField: "account_id", version: { table: "ach_authorization_accounts", key: "id", cols: ["verification_status", "updated_at"] } },
  // R41 S3: releasing a check file carries the list fingerprint (fp); the store refuses it if the list changed.
  "ach_check.release_file": { targetType: "verification", idField: null, version: null },
  // Marking a check file sent carries the page's file fingerprint (fp); the store refuses it if the planned file changed.
  "ach_check.mark_sent": { targetType: "verification", idField: null, version: null },
  "ach_check.finish": { targetType: "verification", idField: "verification_id", version: { table: "ach_verifications", key: "id", cols: ["status", "updated_at"] } },
  "legal_hold.set": { targetType: "authorization", idField: "auth_id", version: AUTH },
  "annual_review.done": { targetType: "authorization", idField: "auth_id", version: AUTH },
  "ach_document.reject": { targetType: "document", idField: "document_id", version: { table: "ach_authorization_documents", key: "id", cols: ["intake_status", "archived_at"] } },
  "banking_settings.save": { targetType: "company", idField: null, version: { table: "ach_company_settings", key: "id", cols: ["updated_at"] } },
  // R41 S2: a confirmation covers the values on screen; any later save (updated_at) makes the request stale.
  "timberland_setup.confirm": { targetType: "company", idField: null, version: { table: "ach_company_settings", key: "id", cols: ["updated_at"] } },
  // The run id is bound to the action (generateRunAction(runId, formData)), not a form field.
  "payroll.generate": { targetType: "payroll_run", idField: null, version: { table: "payroll_runs", key: "id", cols: ["status", "updated_at"] } },
  "vendor_esign.countersign": { targetType: "invite", idField: "invite_id", version: { table: "vendor_esign_invites", key: "id", cols: ["state", "countersigned_at", "rejected_at"] } },
  "vendor_esign.reject": { targetType: "invite", idField: "invite_id", version: { table: "vendor_esign_invites", key: "id", cols: ["state", "countersigned_at", "rejected_at"] } },
  "vendor_ach_flag.change": { targetType: "vendor", idField: "vendor_id", version: { table: "vendors", key: "id", cols: ["ach_needs_bank_info", "ach_opted_out", "ach_opted_out_reason"] } },
  // Building a vendor file re-reads the vault, the payables and the amounts owed at replay time.
  "vendor_ach.build": { targetType: "vendor_payment", idField: null, version: null },
  // R41 S3: a void request is stale once the file moved (uploaded, approved, voided).
  "ach_file.void": { targetType: "ach_file", idField: "file_id", version: { table: "ach_files", key: "id", cols: ["status"] } },
};

/** The fixed id of the single ach_company_settings row (id boolean primary key = true). */
export const COMPANY_TARGET_ID = "true";

/** Target id from the form, or null. Ids are trimmed and length-capped; the store validates them. */
export function targetIdFrom(kind: AchActionKind, get: (k: string) => unknown, explicitId?: string | null): string | null {
  if (explicitId !== undefined && explicitId !== null) return String(explicitId).trim().slice(0, 100) || null;
  const spec = KIND_SPECS[kind];
  if (spec.targetType === "company") return COMPANY_TARGET_ID;
  if (!spec.idField) return null;
  const v = get(spec.idField);
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 100) : null;
}

function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/**
 * The version of a record: SHA-256 (first 32 hex) of the spec's columns, in
 * spec order. "absent" when there is no row: a request made against nothing
 * (new banking) becomes stale if a row appears. For `many`, rows are sorted
 * so the order the database returns them in never matters.
 */
export function versionString(spec: VersionSpec, rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "absent";
  const lines = rows.map((r) => spec.cols.map((c) => `${c}=${canon(r[c])}`).join("|"));
  if (spec.many) lines.sort();
  else if (lines.length > 1) throw new Error(`version: ${spec.table}.${spec.key} matched ${lines.length} rows`);
  return createHash("sha256").update(`${spec.table}\n${lines.join("\n")}`, "utf8").digest("hex").slice(0, 32);
}

export type RedirectOutcome = { ok: boolean; message: string };

/**
 * Read the result of a replayed action from its redirect URL. Any `error=`
 * means failure. Otherwise the first of msg / ok / note is the message, and a
 * redirect with none of them (for example, opening the new run) is success.
 */
export function redirectOutcome(url: string): RedirectOutcome {
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const q = beforeHash.indexOf("?");
  const query = q === -1 ? "" : beforeHash.slice(q + 1);
  const p = new URLSearchParams(query);
  const err = p.get("error");
  if (err !== null) return { ok: false, message: err.trim() || "The action was refused." };
  for (const k of ["msg", "ok", "note"]) {
    const v = p.get(k);
    if (v !== null && v.trim()) return { ok: true, message: v.trim() };
  }
  return { ok: true, message: "Done." };
}

/**
 * Add words to the success message of a redirect URL (Stephen's stop action:
 * "... Michael has been alerted and it is on his review list."). The first
 * of msg / ok / note that is present gets the suffix; if none is, msg is
 * added. An error URL is returned unchanged. The hash is kept.
 */
export function withOutcomeSuffix(url: string, suffix: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const q = beforeHash.indexOf("?");
  const path = q === -1 ? beforeHash : beforeHash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : beforeHash.slice(q + 1));
  if (p.get("error") !== null) return url;
  const key = (["msg", "ok", "note"] as const).find((k) => p.get(k) !== null) ?? "msg";
  const cur = (p.get(key) ?? "").trim();
  p.set(key, (cur ? `${cur} ${suffix}` : suffix).slice(0, 900));
  return `${path}?${p.toString()}${hash}`;
}

/**
 * During an approval replay the action re-runs as the owner. It may only run
 * the exact kind and record the request was about, so a request for vendor A
 * can never be replayed against vendor B.
 */
export function replayMatches(
  req: { kind: string; targetId: string | null },
  run: { kind: string; targetId: string | null },
): boolean {
  return req.kind === run.kind && req.targetId === run.targetId;
}

/**
 * When Michael changes a record himself, which of Stephen's pending requests
 * about that record are superseded? Only the ones the change really replaces:
 * the same kind of change, or a request whose record no longer matches the
 * version it was made against (it would be refused as stale anyway). Adding
 * a callback contact does not cancel a pending bank change.
 */
export function shouldSupersede(ownerKind: string, req: { kind: string; baseVersion: string | null }, currentVersion: string | null): boolean {
  if (req.kind === ownerKind) return true;
  if (req.baseVersion === null) return false;
  return currentVersion !== req.baseVersion;
}

/** The Next.js redirect digest: "NEXT_REDIRECT;<replace|push>;<url>;<status>;". Returns the URL or null. */
export function redirectUrlFromDigest(digest: unknown): string | null {
  if (typeof digest !== "string") return null;
  const parts = digest.split(";");
  if (parts[0] !== "NEXT_REDIRECT" || (parts[1] !== "replace" && parts[1] !== "push")) return null;
  const status = Number(parts.at(-2));
  if (!Number.isInteger(status) || status < 300 || status > 399) return null;
  return parts.slice(2, -2).join(";");
}

/** The masked summary as the 0271 table stores it: a JSON array of {field, value}. */
export function summaryArray(summary: Record<string, string>): { field: string; value: string }[] {
  return Object.entries(summary).map(([field, value]) => ({ field: field.slice(0, 80), value: value.slice(0, 300) }));
}

export function summaryObject(arr: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const it of arr) {
    if (it && typeof it === "object" && typeof (it as { field?: unknown }).field === "string") {
      out[(it as { field: string }).field] = String((it as { value?: unknown }).value ?? "");
    }
  }
  return out;
}

/** Pacific wall-clock time for emails. */
export function pacificWhen(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
/** Cents to "$1,234.56" (integer math; no floats). */
export function centsWords(cents: number): string {
  if (!Number.isInteger(cents)) return "an unreadable amount";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** The vendor-file build result in words (data action: no redirect to read). */
export function vendorBuildOutcome(v: {
  problems?: { message: string }[];
  file?: string;
  entryCount?: number;
  totalCents?: number;
  warnings?: unknown[];
} | null | undefined): RedirectOutcome {
  if (v && typeof v.file === "string" && v.file.length > 0 && (v.problems?.length ?? 0) === 0) {
    const n = typeof v.entryCount === "number" ? v.entryCount : 0;
    const total = typeof v.totalCents === "number" ? ` totalling ${centsWords(v.totalCents)}` : "";
    const partial = v.warnings && v.warnings.length > 0 ? ` (${v.warnings.length} partial)` : "";
    return { ok: true, message: `Vendor ACH file built: ${n} payment(s)${total}${partial}.` };
  }
  return { ok: false, message: v?.problems?.[0]?.message || "The vendor ACH file was not built." };
}

/**
 * Read a decrypted request payload back. It must be exactly what
 * formToEntries produced: an object of field -> array of strings. Anything
 * else is refused (a damaged or tampered payload never reaches an action).
 */
export function parseStoredEntries(raw: string): { ok: true; entries: Record<string, string[]> } | { ok: false; refusal: string } {
  const bad = { ok: false as const, refusal: "The stored request could not be read (it may be damaged, or the encryption key changed). Nothing was changed: reject it and ask for a fresh one." };
  if (typeof raw !== "string" || raw.length === 0) return bad;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return bad;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return bad;
  const out: Record<string, string[]> = Object.create(null);
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (k.length === 0 || k.length > 100 || k === "__proto__" || k.startsWith("$ACTION")) return bad;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 500 || !arr.every((x) => typeof x === "string")) return bad;
    out[k] = [...(arr as string[])];
  }
  return { ok: true, entries: out };
}

/** Field/value pairs in order, ready for FormData.append. */
export function entriesToPairs(entries: Record<string, string[]>): [string, string][] {
  const out: [string, string][] = [];
  for (const k of Object.keys(entries)) for (const v of entries[k]) out.push([k, v]);
  return out;
}

/** What Michael sees after approving, in plain words. */
export function approvalResultText(kind: string, outcome: RedirectOutcome): string {
  const head = outcome.ok ? "Approved and done." : "Approved, but it did not go through:";
  const tail =
    outcome.ok && kind === "payroll.generate"
      ? " Download the file from the payroll run page."
      : outcome.ok && kind === "vendor_ach.build"
        ? " The file is downloading now; the payments are recorded."
        : "";
  return `${head} ${outcome.message}${tail}`.slice(0, 900);
}

export function __runAchGateCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ach-gate-core:", msg);
    }
  };

  // every kind has a spec, and every spec names a real target type
  for (const k of ACH_ACTION_KINDS) {
    ok(Boolean(KIND_SPECS[k]), `spec for ${k}`);
    ok((TARGET_TYPES as readonly string[]).includes(KIND_SPECS[k].targetType), `target type for ${k}`);
  }
  ok(Object.keys(KIND_SPECS).length === ACH_ACTION_KINDS.length, "no extra specs");

  // target ids
  const get = (m: Record<string, string>) => (k: string) => m[k];
  ok(targetIdFrom("vendor_bank.save", get({ vendor_id: "  v1 " })) === "v1", "vendor id trimmed");
  ok(targetIdFrom("vendor_bank.save", get({})) === null, "missing id -> null");
  ok(targetIdFrom("banking_settings.save", get({})) === COMPANY_TARGET_ID, "company target fixed");
  ok(targetIdFrom("payroll.generate", get({ vendor_id: "x" }), "run-1") === "run-1", "explicit id wins");
  ok(targetIdFrom("payroll.generate", get({})) === null, "payroll without explicit id -> null");
  ok(targetIdFrom("vendor_ach.build", get({ vendor_id: "x" })) === null, "build has no single target");
  ok(targetIdFrom("vendor_bank.save", get({ vendor_id: "a".repeat(500) }))?.length === 100, "id capped at 100");

  // versions
  const spec: VersionSpec = { table: "t", key: "id", cols: ["a", "b"] };
  const v1 = versionString(spec, [{ a: "x", b: 1 }]);
  ok(/^[0-9a-f]{32}$/.test(v1), "version is 32 hex");
  ok(versionString(spec, [{ a: "x", b: 1 }]) === v1, "version is stable");
  ok(versionString(spec, [{ a: "x", b: 2 }]) !== v1, "a column change changes the version");
  ok(versionString(spec, [{ a: "x", b: 1, c: "other" }]) === v1, "a column outside the spec does not");
  ok(versionString(spec, [{ a: null, b: 1 }]) !== versionString(spec, [{ a: "null", b: 1 }]), "null differs from the text 'null'");
  ok(versionString(spec, []) === "absent", "no row -> absent");
  ok(versionString({ ...spec, table: "u" }, [{ a: "x", b: 1 }]) !== v1, "table is part of the version");
  let threw = false;
  try {
    versionString(spec, [{ a: 1 }, { a: 2 }]);
  } catch {
    threw = true;
  }
  ok(threw, "two rows for a single-row spec throws");
  const many: VersionSpec = { ...spec, many: true };
  ok(versionString(many, [{ a: 1 }, { a: 2 }]) === versionString(many, [{ a: 2 }, { a: 1 }]), "many: order-free");
  ok(versionString(many, [{ a: 1 }]) !== versionString(many, [{ a: 1 }, { a: 2 }]), "many: an added row changes it");
  ok(!versionString({ table: "employees", key: "id", cols: ["bank_account_number"] }, [{ bank_account_number: "123456789" }]).includes("6789"), "version never holds the number");

  // redirect outcome
  ok(redirectOutcome("/admin/settings/banking?tab=vendors&msg=Saved").ok, "msg = ok");
  ok(redirectOutcome("/admin/settings/banking?tab=vendors&msg=Saved").message === "Saved", "msg text");
  ok(!redirectOutcome("/x?tab=vendors&error=Nope").ok, "error = fail");
  ok(redirectOutcome("/x?error=Nope&msg=Saved").ok === false, "error wins over msg");
  ok(redirectOutcome("/x?ok=Fine").message === "Fine", "ok param");
  ok(redirectOutcome("/x?saved=1&note=Countersigned#vendor-esign").message === "Countersigned", "note param, hash ignored");
  ok(redirectOutcome("/admin/payroll/abc").ok && redirectOutcome("/admin/payroll/abc").message === "Done.", "plain redirect = ok");
  ok(!redirectOutcome("/x?error=").ok, "empty error still fails");
  ok(redirectOutcome("/x#a?error=1").ok, "error after the hash is not a query");
  ok(redirectOutcome(`/x?msg=${encodeURIComponent("A & B")}`).message === "A & B", "decoded");

  // digest
  ok(redirectUrlFromDigest("NEXT_REDIRECT;push;/a?b=1;303;") === "/a?b=1", "push digest");
  ok(redirectUrlFromDigest("NEXT_REDIRECT;replace;/a;b?c=1;307;") === "/a;b?c=1", "url with ;");
  ok(redirectUrlFromDigest("NEXT_NOT_FOUND;push;/a;303;") === null, "not a redirect");
  ok(redirectUrlFromDigest("NEXT_REDIRECT;other;/a;303;") === null, "bad type");
  ok(redirectUrlFromDigest("NEXT_REDIRECT;push;/a;abc;") === null, "bad status");
  ok(redirectUrlFromDigest(undefined) === null, "no digest");

  // suffix
  const S = "Michael has been alerted.";
  ok(redirectOutcome(withOutcomeSuffix("/a?tab=vendors&msg=Held.", S)).message === "Held. Michael has been alerted.", "suffix on msg");
  ok(withOutcomeSuffix("/a?tab=vendors&msg=Held.", S).includes("tab=vendors"), "other params kept");
  ok(withOutcomeSuffix("/a?msg=Held.#notices", S).endsWith("#notices"), "hash kept");
  ok(withOutcomeSuffix("/a?error=No", S) === "/a?error=No", "error url unchanged");
  ok(redirectOutcome(withOutcomeSuffix("/a", S)).message === S, "no message -> msg added");
  ok(redirectOutcome(withOutcomeSuffix("/x?saved=1&note=Done", S)).message === "Done " + S, "note param used");
  ok(new URLSearchParams(withOutcomeSuffix("/x?ok=Yes", S).split("?")[1]).get("msg") === null, "ok param used, no extra msg");
  ok(withOutcomeSuffix(`/a?msg=${"x".repeat(950)}`, S).length < 1000, "capped");

  // replay
  ok(replayMatches({ kind: "vendor_bank.save", targetId: "v1" }, { kind: "vendor_bank.save", targetId: "v1" }), "replay same");
  ok(!replayMatches({ kind: "vendor_bank.save", targetId: "v1" }, { kind: "vendor_bank.save", targetId: "v2" }), "replay other record refused");
  ok(!replayMatches({ kind: "vendor_bank.save", targetId: "v1" }, { kind: "vendor_bank.archive", targetId: "v1" }), "replay other kind refused");
  ok(!replayMatches({ kind: "vendor_ach.build", targetId: null }, { kind: "vendor_ach.build", targetId: "x" }), "null vs id refused");

  // supersede
  ok(shouldSupersede("vendor_bank.save", { kind: "vendor_bank.save", baseVersion: "v1" }, "v1"), "same kind supersedes");
  ok(!shouldSupersede("vendor_contact.add", { kind: "vendor_bank.save", baseVersion: "v1" }, "v1"), "other kind, unchanged record: kept");
  ok(shouldSupersede("vendor_bank.release", { kind: "vendor_bank.save", baseVersion: "v1" }, "v2"), "other kind, record changed: superseded");
  ok(!shouldSupersede("vendor_bank.release", { kind: "vendor_ach.build", baseVersion: null }, "v2"), "no version, other kind: kept");
  ok(shouldSupersede("vendor_bank.save", { kind: "vendor_bank.save", baseVersion: null }, null), "no version, same kind: superseded");

  // summary
  const arr = summaryArray({ routing: "\u2022\u2022\u2022\u20220001", note: "hi" });
  ok(Array.isArray(arr) && arr.length === 2 && arr[0].field === "routing", "summary array");
  ok(summaryObject(arr).note === "hi", "summary round trip");
  ok(Object.keys(summaryObject("x")).length === 0 && Object.keys(summaryObject([{ nope: 1 }])).length === 0, "bad summary ignored");
  ok(summaryArray({ big: "x".repeat(400) })[0].value.length === 300, "values capped");

  ok(pacificWhen(new Date("2026-07-01T19:00:00Z")).includes("12:00"), "Pacific time (PDT noon)");

  if (failed > 0) throw new Error(`ach-gate-core: ${failed} test(s) failed`);
  console.log(`ach-gate-core: ${passed} passed, 0 failed`);

  // vendor build outcome + cents words
  ok(centsWords(0) === "$0.00", "0 cents");
  ok(centsWords(5) === "$0.05", "5 cents padded");
  ok(centsWords(123456789) === "$1,234,567.89", "thousands grouped");
  ok(centsWords(-250) === "-$2.50", "negative");
  ok(centsWords(1.5) === "an unreadable amount", "float refused");
  ok(vendorBuildOutcome({ problems: [], file: "101...", entryCount: 2, totalCents: 150000 }).message === "Vendor ACH file built: 2 payment(s) totalling $1,500.00.", "built message");
  ok(vendorBuildOutcome({ problems: [], file: "x", entryCount: 1, totalCents: 1, warnings: [{}] }).message.endsWith("(1 partial)."), "partial noted");
  ok(vendorBuildOutcome({ problems: [], file: "x" }).ok, "file and no problems = ok");
  ok(!vendorBuildOutcome({ problems: [{ message: "Overpay blocked" }], file: "x" }).ok, "a problem means not ok even with a file");
  ok(vendorBuildOutcome({ problems: [{ message: "Overpay blocked" }] }).message === "Overpay blocked", "first problem is the message");
  ok(!vendorBuildOutcome({ problems: [], file: "" }).ok, "empty file is not built");
  ok(!vendorBuildOutcome(null).ok && vendorBuildOutcome(undefined).message === "The vendor ACH file was not built.", "null safe");

  // stored payload round trip
  const pe = parseStoredEntries(JSON.stringify({ vendor_id: ["v1"], tags: ["a", "b"] }));
  ok(pe.ok && pe.entries.vendor_id[0] === "v1" && pe.entries.tags.length === 2, "payload round trip");
  ok(pe.ok && JSON.stringify(entriesToPairs(pe.entries)) === JSON.stringify([["vendor_id", "v1"], ["tags", "a"], ["tags", "b"]]), "pairs keep order and repeats");
  ok(!parseStoredEntries("").ok, "empty refused (decrypt failed)");
  ok(!parseStoredEntries("not json").ok, "garbage refused");
  ok(!parseStoredEntries("[]").ok, "array refused");
  ok(!parseStoredEntries("null").ok, "null refused");
  ok(!parseStoredEntries(JSON.stringify({ a: "x" })).ok, "non-array value refused");
  ok(!parseStoredEntries(JSON.stringify({ a: [1] })).ok, "non-string item refused");
  ok(!parseStoredEntries(JSON.stringify({ a: [] })).ok, "empty array refused");
  ok(!parseStoredEntries(JSON.stringify({ $ACTION_ID_x: ["1"] })).ok, "framework field refused");
  ok(!parseStoredEntries('{"__proto__":["x"]}').ok, "__proto__ refused");
  ok(!parseStoredEntries(JSON.stringify({ ["k".repeat(101)]: ["x"] })).ok, "long key refused");
  ok(parseStoredEntries("{}").ok, "an empty form is allowed (the action validates)");
  // approval words
  ok(approvalResultText("vendor_bank.save", { ok: true, message: "Saved." }) === "Approved and done. Saved.", "approved words");
  ok(approvalResultText("payroll.generate", { ok: true, message: "ACH file ready to download." }).endsWith("payroll run page."), "payroll points to the run page");
  ok(approvalResultText("vendor_ach.build", { ok: true, message: "built" }).includes("downloading"), "vendor build says downloading");
  ok(approvalResultText("vendor_bank.save", { ok: false, message: "Routing bad" }) === "Approved, but it did not go through: Routing bad", "failure words");
  ok(approvalResultText("x.y", { ok: true, message: "m".repeat(2000) }).length === 900, "capped at 900");
  return { passed, failed };
}
