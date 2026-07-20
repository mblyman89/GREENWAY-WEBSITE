/**
 * POS session-resume — vitest mirror for the active-sale resume core.
 *
 * Runs the full self-test suite, then pins the behaviors the register depends
 * on when an idle auto-lock parks an in-progress sale: the ID verdict + cart
 * survive the lock, but a stored verdict is ALWAYS re-validated on resume
 * (age, expiry, TTL, medical-card dates) and falls back to the full ID gate on
 * any doubt. Prices are never stored — the cart re-prices against the current
 * bundle on resume (verified by the shell's rebuildHeldCart path).
 */
import { describe, expect, it } from "vitest";

import {
  __runActiveSaleResumeCoreTests,
  ACTIVE_SALE_TTL_MS,
  evaluateResume,
  isResumableVerdict,
  parseActiveSale,
  serializeActiveSale,
  snapshotFromSale,
  type ActiveSaleLine,
  type ResumableVerdict,
} from "@/lib/pos/active-sale-resume-core";
import type { PosCardCapture } from "@/lib/pos/medical-pos-core";

const verdict: ResumableVerdict = {
  allowed: true,
  method: "scan",
  age: 34,
  dateOfBirth: "1992-01-15",
  expirationDate: "2030-01-15",
  idType: "drivers_license",
};
const lines: ActiveSaleLine[] = [{ variantId: "v1", quantity: 2 }];
const today = "2026-07-19";
const nowMs = Date.parse("2026-07-19T18:00:00Z");
const iso = "2026-07-19T17:59:00Z";

describe("active-sale-resume-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runActiveSaleResumeCoreTests()).not.toThrow();
  });
});

describe("snapshot build + round-trip", () => {
  it("builds a snapshot from a passing verdict + non-empty cart", () => {
    const snap = snapshotFromSale({ verdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso });
    expect(snap).not.toBeNull();
    expect(snap!.lines).toEqual([{ variantId: "v1", quantity: 2 }]);
    expect(snap!.verdict.dateOfBirth).toBe("1992-01-15");
  });

  it("refuses to snapshot a PRE-GATE sale (no verdict)", () => {
    expect(snapshotFromSale({ verdict: null, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso })).toBeNull();
  });

  it("DOES snapshot a verified customer with an EMPTY cart (check-in-at-door)", () => {
    // A valid ID gate verdict is enough to park — a customer checked in at the
    // door while still browsing must NOT have to rescan after a lock/background.
    const snap = snapshotFromSale({ verdict, lines: [], medicalCard: null, member: null, savedByName: "Sam", nowIso: iso });
    expect(snap).not.toBeNull();
    expect(snap!.lines).toEqual([]);
    expect(snap!.verdict.dateOfBirth).toBe("1992-01-15");
    // The empty-cart snapshot round-trips too.
    const back = parseActiveSale(serializeActiveSale(snap!));
    expect(back).not.toBeNull();
    expect(back!.lines).toEqual([]);
  });

  it("never stores a price — only variant ids + counts", () => {
    const snap = snapshotFromSale({ verdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso })!;
    const raw = serializeActiveSale(snap);
    expect(raw).not.toMatch(/price|Minor|unitPrice/i);
    const keys = Object.keys(snap.lines[0]);
    expect(keys.sort()).toEqual(["quantity", "variantId"]);
  });

  it("round-trips through serialize/parse and rejects corruption", () => {
    const snap = snapshotFromSale({ verdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso })!;
    expect(parseActiveSale(serializeActiveSale(snap))).not.toBeNull();
    expect(parseActiveSale(null)).toBeNull();
    expect(parseActiveSale("{bad")).toBeNull();
    expect(parseActiveSale(JSON.stringify({ v: 2, snapshot: snap }))).toBeNull();
  });
});

describe("isResumableVerdict", () => {
  it("accepts a well-formed allowed verdict, rejects a refusal", () => {
    expect(isResumableVerdict(verdict)).toBe(true);
    expect(isResumableVerdict({ allowed: false, method: "scan", reason: "x" })).toBe(false);
  });
});

describe("evaluateResume re-validation", () => {
  const snap = snapshotFromSale({ verdict, lines, medicalCard: null, member: null, savedByName: "Sam", nowIso: iso })!;

  it("resumes a fresh, in-age, unexpired snapshot", () => {
    const d = evaluateResume(snap, today, nowMs);
    expect(d.resume).toBe(true);
  });

  it("refuses a snapshot older than the TTL", () => {
    const old = { ...snap, savedAtIso: new Date(nowMs - ACTIVE_SALE_TTL_MS - 1000).toISOString() };
    const d = evaluateResume(old, today, nowMs);
    expect(d.resume).toBe(false);
  });

  it("refuses an ID that expired since the scan", () => {
    const expired = { ...snap, verdict: { ...verdict, expirationDate: "2026-07-18" } };
    const d = evaluateResume(expired, today, nowMs);
    expect(d.resume).toBe(false);
  });

  it("refuses when the parked customer no longer verifies minimum age", () => {
    const under = { ...snap, verdict: { ...verdict, dateOfBirth: "2010-01-01", age: 16 } };
    const d = evaluateResume(under, today, nowMs);
    expect(d.resume).toBe(false);
  });

  it("keeps a medical sale medical — but re-checks the card dates", () => {
    const card: PosCardCapture = { upid: "UP1", effectiveOn: "2025-01-01", expiresOn: "2030-01-01", holderType: "patient", mcrVerified: true };
    const medSnap = snapshotFromSale({ verdict, lines, medicalCard: card, member: null, savedByName: "Sam", nowIso: iso })!;
    expect(evaluateResume(medSnap, today, nowMs).resume).toBe(true);
    const expiredCard = { ...medSnap, medicalCard: { ...card, expiresOn: "2026-07-18" } };
    expect(evaluateResume(expiredCard, today, nowMs).resume).toBe(false);
  });
});
