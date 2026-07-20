/**
 * Active-sale resume core (POS session-resume) — pure, zero-I/O helpers that
 * let an in-progress sale SURVIVE the idle auto-lock so the same customer can
 * be rung up without rescanning their ID or re-adding their products.
 *
 * WHY THIS EXISTS (owner request):
 *   The register auto-locks after ~2 minutes of inactivity (good — the next
 *   sale must be PIN-attributed to whoever actually rings it). But if a sale
 *   was already PAST the age gate (ID scanned/verified, cart being built) and
 *   the screen locks, the old behavior dropped everything: re-unlock landed on
 *   "Start sale" and the budtender had to rescan the customer's ID and re-add
 *   every product. This core persists a MINIMAL, self-re-validating snapshot so
 *   re-unlock resumes exactly where the sale left off.
 *
 * WHAT IS AND IS NOT STORED (compliance-conscious, mirrors the B17 hold rules):
 *   - Cart is stored as variant ids + counts ONLY. Prices are NEVER stored;
 *     the shell rebuilds the cart against the CURRENT bundle on resume
 *     (rebuildHeldCart), so a stale price or a vanished/86'd product can never
 *     ship. This matches HeldSale discipline exactly.
 *   - The ID verdict (age/DOB/expiry) IS stored so the gate can be skipped —
 *     BUT it is RE-VALIDATED on resume against today's date (age >= minimum,
 *     not expired). A snapshot also carries a TTL: a phone left on the counter
 *     overnight, or an ID that expired since the scan, drops the snapshot and
 *     falls back to the full ID gate. The safe default is ALWAYS "rescan".
 *   - The medical card capture (if any) is stored so a medical sale stays
 *     medical on resume (it drives pricing + the 3x limits). Its own
 *     effective/expiry dates are re-checked on resume too.
 *
 * Everything here is deterministic and covered by __runActiveSaleResumeCoreTests
 * (registered in scripts/compliance/run-pure-selftests.ts) plus the vitest
 * mirror in tests/compliance/pos-active-sale-resume-core.test.ts.
 */

import { ageOn, isExpired, isYmd, MINIMUM_AGE_YEARS, type IdGateVerdict } from "./id-scan-core";
import type { PosCardCapture } from "./medical-pos-core";

// ---------------------------------------------------------------------------
// localStorage key (single source of truth — the shell imports this)
// ---------------------------------------------------------------------------

export const ACTIVE_SALE_KEY = "gw-pos-active-sale";

/**
 * How long a parked active sale stays resumable. The register locks after 2
 * minutes idle; a returning customer typically comes right back. Beyond this
 * window the snapshot is treated as abandoned and the ID gate re-runs — an ID
 * verified long ago must not silently authorize a much-later sale.
 */
export const ACTIVE_SALE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// A resumable verdict is always the ALLOWED variant (a refused sale never
// reaches the cart, so there is nothing to resume).
export type ResumableVerdict = Extract<IdGateVerdict, { allowed: true }>;

/** A parked cart line: variant id + count only. Prices are NEVER stored. */
export type ActiveSaleLine = { variantId: string; quantity: number };

/** The loyalty member attached to the sale, if any (privacy-lean fields only). */
export type ActiveSaleMember = {
  customerId: string;
  label: string;
  points: number;
  tierName: string | null;
};

export type ActiveSaleSnapshot = {
  /** When the sale was parked by the lock (device clock, ISO). */
  savedAtIso: string;
  /** Display name of the employee whose session was locked. */
  savedByName: string;
  /** The passing ID gate verdict — re-validated on resume, never trusted blind. */
  verdict: ResumableVerdict;
  /** Cart lines: variant ids + counts only (re-priced on resume). */
  lines: ActiveSaleLine[];
  /** Medical recognition card capture, if this is a medical sale. */
  medicalCard: PosCardCapture | null;
  /** Attached loyalty member, if any. */
  member: ActiveSaleMember | null;
  /**
   * Present when this sale was started from a website pickup order loaded into
   * the register: the source order's UUID. Carried through a lock/resume so a
   * loaded sale that is parked and later resumed still supersedes its source
   * website order ON COMPLETION (never on load). Null for walk-in sales.
   */
  sourceOrderId: string | null;
};

type StoredActiveSale = { v: 1; snapshot: ActiveSaleSnapshot };

// ---------------------------------------------------------------------------
// small validators (kept local so the core has no external test deps)
// ---------------------------------------------------------------------------

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x);
}
function isNonEmptyStr(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** A verdict is only resumable if it is the fully-formed ALLOWED shape. */
export function isResumableVerdict(v: unknown): v is ResumableVerdict {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.allowed !== true) return false;
  if (o.method !== "scan" && o.method !== "manual") return false;
  if (!isInt(o.age) || (o.age as number) < 0) return false;
  if (!isYmd(o.dateOfBirth)) return false;
  // expirationDate is string|null; when present it must be YYYY-MM-DD.
  if (o.expirationDate !== null && !isYmd(o.expirationDate)) return false;
  // idType is AcceptableIdType|null — we only require the field to exist as
  // one of those two runtime shapes (string or null).
  if (o.idType !== null && typeof o.idType !== "string") return false;
  return true;
}

function isMedicalCardShape(c: unknown): c is PosCardCapture {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (!isNonEmptyStr(o.upid)) return false;
  if (!isYmd(o.effectiveOn) || !isYmd(o.expiresOn)) return false;
  if (o.holderType !== "patient" && o.holderType !== "designated_provider") return false;
  if (typeof o.mcrVerified !== "boolean") return false;
  return true;
}

function isMemberShape(m: unknown): m is ActiveSaleMember {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (!isNonEmptyStr(o.customerId) || !isNonEmptyStr(o.label)) return false;
  if (!isInt(o.points)) return false;
  if (o.tierName !== null && typeof o.tierName !== "string") return false;
  return true;
}

// ---------------------------------------------------------------------------
// build / serialize / parse
// ---------------------------------------------------------------------------

/**
 * Build a snapshot from the live sale state. Returns null ONLY when there is
 * nothing worth parking — i.e. no passing ID gate verdict (a pre-gate sale
 * simply restarts at the ID gate, which is the same as today).
 *
 * An EMPTY cart IS worth parking as long as a valid verdict exists: the real
 * workflow is to check a customer in at the door (ID scanned/verified) and
 * then browse the menu before anything is added to the cart. If the screen
 * locks (or iOS backgrounds the tab) during that window, we must NOT force the
 * budtender to rescan the customer. So a verified-customer-with-empty-cart is
 * a legitimate, resumable state; the cart just resumes empty.
 */
export function snapshotFromSale(args: {
  verdict: ResumableVerdict | null;
  lines: ActiveSaleLine[];
  medicalCard: PosCardCapture | null;
  member: ActiveSaleMember | null;
  savedByName: string;
  nowIso: string;
  /** Source website order id when this sale was loaded from one (else null). */
  sourceOrderId?: string | null;
}): ActiveSaleSnapshot | null {
  const { verdict, lines, medicalCard, member, savedByName, nowIso, sourceOrderId } = args;
  if (!verdict || !isResumableVerdict(verdict)) return null;
  const cleanLines = lines
    .filter((l) => isNonEmptyStr(l.variantId) && isInt(l.quantity) && l.quantity > 0)
    .map((l) => ({ variantId: l.variantId, quantity: Math.floor(l.quantity) }));
  return {
    savedAtIso: nowIso,
    savedByName,
    verdict,
    lines: cleanLines,
    medicalCard: medicalCard && isMedicalCardShape(medicalCard) ? medicalCard : null,
    member: member && isMemberShape(member) ? member : null,
    sourceOrderId: isNonEmptyStr(sourceOrderId) ? sourceOrderId : null,
  };
}

export function serializeActiveSale(snapshot: ActiveSaleSnapshot): string {
  const stored: StoredActiveSale = { v: 1, snapshot };
  return JSON.stringify(stored);
}

/** Parse a persisted snapshot; null on ANY corruption (never a garbage resume). */
export function parseActiveSale(raw: string | null | undefined): ActiveSaleSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredActiveSale>;
    if (parsed?.v !== 1) return null;
    const s = parsed.snapshot as Partial<ActiveSaleSnapshot> | undefined;
    if (!s) return null;
    if (!isNonEmptyStr(s.savedAtIso) || Number.isNaN(Date.parse(s.savedAtIso))) return null;
    if (typeof s.savedByName !== "string") return null;
    if (!isResumableVerdict(s.verdict)) return null;
    // An empty cart is a valid parked state (verified customer, still browsing)
    // — require lines to be an ARRAY, but allow it to be empty.
    if (!Array.isArray(s.lines)) return null;
    const lines: ActiveSaleLine[] = [];
    for (const l of s.lines) {
      const line = l as Partial<ActiveSaleLine> | null;
      if (!line || !isNonEmptyStr(line.variantId) || !isInt(line.quantity) || line.quantity <= 0) return null;
      lines.push({ variantId: line.variantId, quantity: line.quantity });
    }
    const medicalCard = s.medicalCard == null ? null : isMedicalCardShape(s.medicalCard) ? s.medicalCard : null;
    // A medical card that fails shape validation invalidates the whole snapshot:
    // resuming a medical sale WITHOUT its card would silently drop the medical
    // pricing + limits, so we refuse rather than resume a corrupted medical sale.
    if (s.medicalCard != null && medicalCard === null) return null;
    const member = s.member == null ? null : isMemberShape(s.member) ? s.member : null;
    const sourceOrderId = isNonEmptyStr(s.sourceOrderId) ? s.sourceOrderId : null;
    return {
      savedAtIso: s.savedAtIso,
      savedByName: s.savedByName,
      verdict: s.verdict,
      lines,
      medicalCard,
      member,
      sourceOrderId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// resume decision — re-validate before honoring a stored verdict
// ---------------------------------------------------------------------------

export type ResumeDecision =
  | { resume: true; snapshot: ActiveSaleSnapshot }
  | { resume: false; reason: string };

/**
 * Decide whether a parked snapshot may be resumed PAST the age gate. Even a
 * perfectly-stored verdict is re-checked against today: the customer must
 * still be old enough (they always will be, but the check is cheap and honest)
 * and the ID must not have EXPIRED since the scan. A snapshot older than the
 * TTL is treated as abandoned. Any failure returns resume:false with a reason
 * — the caller then falls back to the full ID gate (the safe default).
 *
 * `todayYmd` = today on the store's Pacific wall clock (same clock the gate
 * uses). `nowMs`/`savedMs` are epoch millis for the TTL check.
 */
export function evaluateResume(
  snapshot: ActiveSaleSnapshot | null,
  todayYmd: string,
  nowMs: number,
  minimumAgeYears: number = MINIMUM_AGE_YEARS,
): ResumeDecision {
  if (!snapshot) return { resume: false, reason: "No parked sale to resume." };
  if (!isYmd(todayYmd)) return { resume: false, reason: "Internal error: invalid store date." };

  const savedMs = Date.parse(snapshot.savedAtIso);
  if (Number.isNaN(savedMs)) return { resume: false, reason: "Parked sale has an unreadable timestamp." };
  if (nowMs - savedMs > ACTIVE_SALE_TTL_MS) {
    return { resume: false, reason: "Parked sale is too old to resume — rescan the ID." };
  }
  // A clock that jumped backwards past the save is also suspect.
  if (savedMs - nowMs > ACTIVE_SALE_TTL_MS) {
    return { resume: false, reason: "Parked sale timestamp is in the future — rescan the ID." };
  }

  const v = snapshot.verdict;
  const age = ageOn(v.dateOfBirth, todayYmd);
  if (age === null || age < minimumAgeYears) {
    return { resume: false, reason: `Parked ID no longer verifies age >= ${minimumAgeYears} — rescan the ID.` };
  }
  if (v.expirationDate) {
    const expired = isExpired(v.expirationDate, todayYmd);
    if (expired) {
      return { resume: false, reason: "Parked ID has since expired — rescan the ID." };
    }
  }

  // A medical sale must still have a card valid TODAY (its dates are re-checked
  // the same way the gate's card capture is validated).
  if (snapshot.medicalCard) {
    const card = snapshot.medicalCard;
    if (isExpired(card.expiresOn, todayYmd)) {
      return { resume: false, reason: "Parked medical card has expired — restart the sale." };
    }
    // effectiveOn must be on or before today (card not yet active is invalid).
    if (card.effectiveOn > todayYmd) {
      return { resume: false, reason: "Parked medical card is not yet effective — restart the sale." };
    }
  }

  return { resume: true, snapshot };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runActiveSaleResumeCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  const goodVerdict: ResumableVerdict = {
    allowed: true,
    method: "scan",
    age: 34,
    dateOfBirth: "1992-01-15",
    expirationDate: "2030-01-15",
    idType: "drivers_license",
  };
  const today = "2026-07-19";
  const nowMs = Date.parse("2026-07-19T18:00:00Z");
  const iso = "2026-07-19T17:59:00Z"; // 1 min ago
  const lines: ActiveSaleLine[] = [{ variantId: "v1", quantity: 2 }];

  // --- isResumableVerdict ---
  ok(isResumableVerdict(goodVerdict), "good allowed verdict is resumable");
  ok(!isResumableVerdict({ allowed: false, method: "scan", reason: "x" }), "refused verdict is not resumable");
  ok(!isResumableVerdict({ ...goodVerdict, dateOfBirth: "bad" }), "bad DOB verdict rejected");
  ok(!isResumableVerdict({ ...goodVerdict, age: -1 }), "negative age rejected");
  ok(isResumableVerdict({ ...goodVerdict, expirationDate: null }), "null expiry still resumable shape");
  ok(!isResumableVerdict({ ...goodVerdict, expirationDate: "20300115" }), "malformed expiry rejected");

  // --- snapshotFromSale ---
  const snap = snapshotFromSale({
    verdict: goodVerdict,
    lines,
    medicalCard: null,
    member: null,
    savedByName: "Sam",
    nowIso: iso,
  });
  ok(snap !== null && snap.lines.length === 1 && snap.verdict.age === 34, "snapshotFromSale builds a snapshot");
  ok(snapshotFromSale({ verdict: null, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso }) === null, "no verdict -> no snapshot");
  // Verified-customer-with-EMPTY-cart IS resumable (check-in-at-door workflow):
  // a valid verdict is enough to park; the cart simply resumes empty.
  {
    const emptySnap = snapshotFromSale({ verdict: goodVerdict, lines: [], medicalCard: null, member: null, savedByName: "Sam", nowIso: iso });
    ok(emptySnap !== null && emptySnap.lines.length === 0 && emptySnap.verdict.age === 34, "empty cart with valid verdict -> snapshot (empty cart)");
  }
  // Lines that are all invalid collapse to an empty cart, but the valid verdict
  // still yields a resumable snapshot (invalid lines are simply dropped).
  {
    const invalidLinesSnap = snapshotFromSale({ verdict: goodVerdict, lines: [{ variantId: "v1", quantity: 0 }, { variantId: "", quantity: 3 }], medicalCard: null, member: null, savedByName: "Sam", nowIso: iso });
    ok(invalidLinesSnap !== null && invalidLinesSnap.lines.length === 0, "cart with only invalid lines -> snapshot with empty cart");
  }

  // --- serialize / parse round-trip ---
  const raw = serializeActiveSale(snap!);
  const back = parseActiveSale(raw);
  ok(back !== null && back.verdict.dateOfBirth === "1992-01-15" && back.lines[0].variantId === "v1", "serialize/parse round-trips");
  ok(parseActiveSale(null) === null, "null raw -> null");
  ok(parseActiveSale("{not json") === null, "garbage json -> null");
  ok(parseActiveSale(JSON.stringify({ v: 2, snapshot: snap })) === null, "wrong version -> null");
  ok(parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...snap, verdict: { allowed: false } } })) === null, "refused verdict in blob -> null");
  {
    // Empty lines in a stored blob is now a VALID parked state (verified
    // customer, empty cart) — it parses back with an empty cart, not null.
    const emptyLinesBack = parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...snap, lines: [] } }));
    ok(emptyLinesBack !== null && emptyLinesBack.lines.length === 0, "empty lines in blob -> snapshot with empty cart");
    // Non-array lines is still corruption -> null.
    ok(parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...snap, lines: "nope" } })) === null, "non-array lines in blob -> null");
  }
  ok(parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...snap, savedAtIso: "nope" } })) === null, "bad timestamp in blob -> null");

  // member + medical card round-trip
  const medCard: PosCardCapture = { upid: "UP123", effectiveOn: "2025-01-01", expiresOn: "2030-01-01", holderType: "patient", mcrVerified: true };
  const member: ActiveSaleMember = { customerId: "c1", label: "Jane D.", points: 120, tierName: "Gold" };
  const medSnap = snapshotFromSale({ verdict: goodVerdict, lines, medicalCard: medCard, member, savedByName: "Sam", nowIso: iso });
  const medBack = parseActiveSale(serializeActiveSale(medSnap!));
  ok(medBack !== null && medBack.medicalCard?.upid === "UP123" && medBack.member?.customerId === "c1", "medical card + member round-trip");
  // corrupt medical card invalidates the whole snapshot (never drop medical silently)
  ok(parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...medSnap, medicalCard: { upid: "x" } } })) === null, "corrupt medical card -> null (no silent drop)");
  // bad member is dropped to null but snapshot survives
  const okMemberDrop = parseActiveSale(JSON.stringify({ v: 1, snapshot: { ...snap, member: { customerId: "" } } }));
  ok(okMemberDrop !== null && okMemberDrop.member === null, "bad member is dropped, snapshot survives");

  // sourceOrderId (loaded-from-website-order) round-trips; absent -> null
  ok(snap!.sourceOrderId === null, "walk-in snapshot has null sourceOrderId");
  const loadedSnap = snapshotFromSale({ verdict: goodVerdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso, sourceOrderId: "ord-uuid-123" });
  ok(loadedSnap !== null && loadedSnap.sourceOrderId === "ord-uuid-123", "loaded snapshot keeps sourceOrderId");
  const loadedBack = parseActiveSale(serializeActiveSale(loadedSnap!));
  ok(loadedBack !== null && loadedBack.sourceOrderId === "ord-uuid-123", "sourceOrderId round-trips");
  const emptySource = snapshotFromSale({ verdict: goodVerdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso, sourceOrderId: "" });
  ok(emptySource !== null && emptySource.sourceOrderId === null, "empty sourceOrderId normalizes to null");

  // --- evaluateResume ---
  let d = evaluateResume(snap, today, nowMs);
  ok(d.resume === true, "fresh in-age unexpired snapshot resumes");
  d = evaluateResume(null, today, nowMs);
  ok(d.resume === false, "null snapshot does not resume");
  // too old
  const oldIso = "2026-07-19T17:00:00Z"; // 60 min ago > 30 min TTL
  const oldSnap = { ...snap!, savedAtIso: oldIso };
  d = evaluateResume(oldSnap, today, nowMs);
  ok(d.resume === false && /too old/.test(d.reason), "snapshot past TTL does not resume");
  // future timestamp
  const futureIso = "2026-07-19T20:00:00Z"; // 2h ahead
  d = evaluateResume({ ...snap!, savedAtIso: futureIso }, today, nowMs);
  ok(d.resume === false && /future/.test(d.reason), "future-timestamped snapshot does not resume");
  // expired ID since scan
  const expiredVerdict: ResumableVerdict = { ...goodVerdict, expirationDate: "2026-07-18" };
  const expiredSnap = { ...snap!, verdict: expiredVerdict };
  d = evaluateResume(expiredSnap, today, nowMs);
  ok(d.resume === false && /expired/.test(d.reason), "ID expired since scan -> no resume");
  // under age (constructed DOB that is 20 today)
  const underVerdict: ResumableVerdict = { ...goodVerdict, dateOfBirth: "2006-07-20", age: 20 };
  d = evaluateResume({ ...snap!, verdict: underVerdict }, today, nowMs);
  ok(d.resume === false && /age/.test(d.reason), "under-minimum on resume -> no resume");
  // null expiry is honored (some IDs have none)
  d = evaluateResume({ ...snap!, verdict: { ...goodVerdict, expirationDate: null } }, today, nowMs);
  ok(d.resume === true, "verdict with null expiry resumes");
  // expired medical card
  d = evaluateResume({ ...medSnap!, medicalCard: { ...medCard, expiresOn: "2026-07-18" } }, today, nowMs);
  ok(d.resume === false && /medical card has expired/.test(d.reason), "expired medical card -> no resume");
  // not-yet-effective medical card
  d = evaluateResume({ ...medSnap!, medicalCard: { ...medCard, effectiveOn: "2026-08-01" } }, today, nowMs);
  ok(d.resume === false && /not yet effective/.test(d.reason), "not-yet-effective medical card -> no resume");
  // valid medical card resumes
  d = evaluateResume(medSnap, today, nowMs);
  ok(d.resume === true, "valid medical snapshot resumes");
  // bad today
  d = evaluateResume(snap, "bad", nowMs);
  ok(d.resume === false, "invalid store date -> no resume");

  if (failed > 0) {
    throw new Error(`active-sale-resume-core self-tests: ${failed} failed (${passed} passed): ${failures.join("; ")}`);
  }
  console.log(`active-sale-resume-core self-tests: ${passed} passed`);
}
