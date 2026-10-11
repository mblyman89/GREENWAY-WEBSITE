/**
 * tests/compliance/r39-ach-return-log-core.test.ts  (R39 S7)
 *
 * Returns / NOC log, pure layer. Expectations here are worked out
 * INDEPENDENTLY of the core's own self-test: the NOC deadline is counted
 * by hand against the FedACH closure list, the routing check digit is
 * computed here with the ABA 3-7-1 weights, and every code in ACH_CODES is
 * walked so a new code can't slip through without a label.
 */
import { describe, expect, it } from "vitest";

import { ACH_CODES, fedAchClosures } from "@/lib/payments/ach-authorization-core";
import {
  MIN_RESOLUTION_NOTE_CHARS,
  NOTICE_MAX_AGE_DAYS,
  __runAchReturnLogCoreTests,
  checkCorrectedData,
  checkResolutionNote,
  maskTail,
  noticeHoldReason,
  noticeOwnerEmail,
  noticeUrgency,
  parseDollarsToCents,
  parseReturnNotice,
} from "@/lib/payments/ach-return-log-core";

const V = "0f8fad5b-d9cb-469f-a165-70867728950e";
const g = (o: Record<string, string>) => (k: string) => o[k];

/** Independent ABA check: 3,7,1 weights, sum divisible by 10. */
function abaOk(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  return r.split("").reduce((s, d, i) => s + Number(d) * w[i], 0) % 10 === 0;
}

/** Independent banking-day counter (weekends + FedACH closures skipped). */
function plusBankingDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const s = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (fedAchClosures(d.getUTCFullYear()).includes(s)) continue;
    left--;
  }
  return d.toISOString().slice(0, 10);
}

describe("R39 S7 return log core: pure self-test", () => {
  it("runs at least 37 checks with zero failures", () => {
    const r = __runAchReturnLogCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(37);
  });
});

describe("guard the guard: helpers in this file", () => {
  it("ABA helper accepts known-good and rejects a one-digit change", () => {
    expect(abaOk("011000015")).toBe(true); // Federal Reserve Bank of Boston
    expect(abaOk("011000016")).toBe(false);
  });
  it("banking-day helper skips Columbus Day 2026 and weekends", () => {
    expect(fedAchClosures(2026)).toContain("2026-10-12");
    expect(plusBankingDays("2026-10-09", 1)).toBe("2026-10-13"); // Fri -> (Sat,Sun,Mon holiday) -> Tue
  });
});

describe("parseReturnNotice", () => {
  const today = "2026-10-20";
  it("a return: kind, label from ACH_CODES, no apply-by", () => {
    const r = parseReturnNotice(g({ payee: `vendor:${V}`, code: " r03 ", received_on: "2026-10-05", amount: "$1,000.10", trace: "123456789012345" }), today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notice).toMatchObject({ kind: "return", code: "R03", payeeType: "vendor", payeeId: V, amountCents: 100010, traceNumber: "123456789012345", applyBy: null, correctedData: null });
    expect(r.notice.codeLabel).toBe(ACH_CODES.R03.label);
  });

  it("NOC apply-by equals 6 banking days counted independently", () => {
    for (const rec of ["2026-10-05", "2026-11-20", "2026-12-21", "2026-06-15"]) {
      const r = parseReturnNotice(g({ payee: `employee:${V}`, code: "C01", received_on: rec, corrected: "12345678" }), "2026-12-31");
      expect(r.ok, rec).toBe(true);
      if (r.ok) expect(r.notice.applyBy, rec).toBe(plusBankingDays(rec, 6));
    }
  });

  it("every known code gets its label; kind follows the letter", () => {
    for (const code of Object.keys(ACH_CODES)) {
      const corrected = code === "C02" ? "011000015" : code === "C05" ? "22" : code.startsWith("C") ? "12345678 011000015 22" : "";
      const r = parseReturnNotice(g({ payee: `vendor:${V}`, code, received_on: "2026-10-05", corrected }), today);
      if (!r.ok) {
        // Combined C-codes may reject a simple value; they must say why in `corrected`, nothing else.
        expect(Object.keys(r.errors), code).toEqual(["corrected"]);
        continue;
      }
      expect(r.notice.kind).toBe(code.startsWith("C") ? "noc" : "return");
      expect(r.notice.known).toBe(true);
      expect(r.notice.codeLabel).toBe(ACH_CODES[code].label);
    }
  });

  it("unknown code is accepted but flagged unknown (never guessed)", () => {
    const r = parseReturnNotice(g({ payee: `vendor:${V}`, code: "R99", received_on: "2026-10-05" }), today);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notice.known).toBe(false);
      expect(r.notice.codeLabel).toBeNull();
    }
  });

  it.each([
    [{ payee: "vendor:not-a-uuid" }, "payee"],
    [{ payee: `bank:${V}` }, "payee"],
    [{ code: "X01" }, "code"],
    [{ code: "R3" }, "code"],
    [{ received_on: "2026-02-30" }, "received_on"],
    [{ received_on: "2026-10-21" }, "received_on"],
    [{ settlement_date: "2026-10-06" }, "settlement_date"],
    [{ amount: "12.345" }, "amount"],
    [{ amount: "-5" }, "amount"],
    [{ trace: "12345" }, "trace"],
    [{ corrected: "123" }, "corrected"],
  ])("rejects %j in %s", (over, field) => {
    const base = { payee: `vendor:${V}`, code: "R01", received_on: "2026-10-05" };
    const r = parseReturnNotice(g({ ...base, ...over }), today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty(field);
  });

  it("max age boundary is exact", () => {
    const d = (n: number) => new Date(Date.parse("2026-10-20T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
    const at = parseReturnNotice(g({ payee: `vendor:${V}`, code: "R01", received_on: d(NOTICE_MAX_AGE_DAYS) }), today);
    const over = parseReturnNotice(g({ payee: `vendor:${V}`, code: "R01", received_on: d(NOTICE_MAX_AGE_DAYS + 1) }), today);
    expect(at.ok).toBe(true);
    expect(over.ok).toBe(false);
  });

  it("settlement on the same day as the notice is allowed", () => {
    expect(parseReturnNotice(g({ payee: `vendor:${V}`, code: "R01", received_on: "2026-10-05", settlement_date: "2026-10-05" }), today).ok).toBe(true);
  });
});

describe("checkCorrectedData", () => {
  it("C02 agrees with an independent ABA check across many numbers", () => {
    let agreed = 0;
    for (let i = 0; i < 2000; i++) {
      const r = String(11000000 + i * 7919).padStart(8, "0").slice(0, 8) + String(i % 10);
      expect(checkCorrectedData("C02", r).ok, r).toBe(abaOk(r));
      agreed++;
    }
    expect(agreed).toBe(2000);
  });
  it("C01 length bounds 4..17", () => {
    expect(checkCorrectedData("C01", "123").ok).toBe(false);
    expect(checkCorrectedData("C01", "1234").ok).toBe(true);
    expect(checkCorrectedData("C01", "1".repeat(17)).ok).toBe(true);
    expect(checkCorrectedData("C01", "1".repeat(18)).ok).toBe(false);
  });
  it("C05 only checking/savings credit or prenote codes", () => {
    for (const c of ["22", "23", "32", "33"]) expect(checkCorrectedData("C05", c).ok).toBe(true);
    for (const c of ["27", "37", "2", "222"]) expect(checkCorrectedData("C05", c).ok).toBe(false);
  });
  it("letters refused", () => {
    expect(checkCorrectedData("C01", "12345abc").ok).toBe(false);
  });
});

describe("owner email and hold reason", () => {
  const parsed = parseReturnNotice(g({ payee: `vendor:${V}`, code: "C01", received_on: "2026-10-05", corrected: "9876543210123" }), "2026-10-20");
  if (!parsed.ok) throw new Error("fixture");
  const n = parsed.notice;

  it("email never contains the full corrected number, only its last 4", () => {
    const em = noticeOwnerEmail({ notice: n, payeeName: "Acme <b>Farms</b>", held: true, holdDetail: "On hold", loggedBy: "Michael", bankingUrl: "https://x/banking" });
    for (const s of [em.subject, em.html, em.text]) expect(s).not.toContain("9876543210123");
    expect(em.text).toContain("0123");
    expect(em.html).not.toContain("<b>Farms");
    expect(em.html).toContain("&lt;b&gt;");
    expect(em.text).toContain(`apply the correction by ${plusBankingDays("2026-10-05", 6)}`);
    expect(em.subject).toMatch(/- on hold$/);
  });
  it("not held -> subject says ACTION NEEDED; CRLF in names cannot split the subject", () => {
    const em = noticeOwnerEmail({ notice: n, payeeName: "A\r\nBcc: x@y", held: false, holdDetail: "x", loggedBy: "S", bankingUrl: "u" });
    expect(em.subject).not.toMatch(/[\r\n]/);
    expect(em.subject).toMatch(/ACTION NEEDED$/);
  });
  it("hold reason is non-empty, <= 500 chars, names code and date", () => {
    const h = noticeHoldReason(n);
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThanOrEqual(500);
    expect(h).toContain("C01");
    expect(h).toContain("2026-10-05");
  });
  it("maskTail", () => {
    expect(maskTail(null)).toBeNull();
    expect(maskTail("12-34 5678")).toBe("\u2022\u2022\u2022\u20225678");
  });
});

describe("urgency and resolution note", () => {
  const row = (apply_by: string | null, kind: "noc" | "return" = "noc") => ({ id: "x", notice_kind: kind, code: "C01", received_on: "2026-10-05", apply_by });
  it("boundaries: yesterday overdue, today/+2 due soon, +3 open; returns always open", () => {
    expect(noticeUrgency(row("2026-10-19"), "2026-10-20")).toBe("overdue");
    expect(noticeUrgency(row("2026-10-20"), "2026-10-20")).toBe("due_soon");
    expect(noticeUrgency(row("2026-10-22"), "2026-10-20")).toBe("due_soon");
    expect(noticeUrgency(row("2026-10-23"), "2026-10-20")).toBe("open");
    expect(noticeUrgency(row("2026-01-01", "return"), "2026-10-20")).toBe("open");
  });
  it("note length and no account numbers; a phone number is fine", () => {
    expect(checkResolutionNote("x".repeat(MIN_RESOLUTION_NOTE_CHARS - 1)).ok).toBe(false);
    expect(checkResolutionNote("x".repeat(MIN_RESOLUTION_NOTE_CHARS)).ok).toBe(true);
    expect(checkResolutionNote("Called Bob at 360-555-0199 on file, fixed").ok).toBe(true);
    expect(checkResolutionNote("New account is 123456789 per Bob").ok).toBe(false);
  });
  it("dollars", () => {
    expect(parseDollarsToCents("0.01")).toBe(1);
    expect(parseDollarsToCents("999,999,999.99")).toBe(99999999999);
    expect(Number.isNaN(parseDollarsToCents("1.2.3"))).toBe(true);
  });
});
