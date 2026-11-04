import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isOfflineApprovalPurpose,
  judgeOfflineAuth,
  OFFLINE_APPROVAL_PURPOSES,
  validateOfflineAuthPayload,
} from "../../src/lib/pos/offline-unlock-core";
import {
  __runLotDetailsCacheCoreTests,
  cachedLotDetails,
  lotDetailsKey,
  parseLotDetailsCache,
  putLotDetails,
  serializeLotDetailsCache,
} from "../../src/lib/pos/lot-details-cache-core";
import {
  __runDeferredOutboxCoreTests,
  addToOutbox,
  classifyOutboxAttempt,
  emptyOutbox,
  settleOutboxEntry,
} from "../../src/lib/pos/deferred-outbox-core";
import { findKeySpec, auditKeyRegistry } from "../../src/lib/pos/pos-storage-core";

/**
 * D170: the register works fully offline (owner message 2026-11-04).
 *
 * Owner: "Please add all of these things to the todo list so we can be fully
 * operational while internet is down. ... Everything else should work though."
 * and "Please add customer loyalty to the iPad. Our data is safe. I want all
 * features unlocked."
 *
 * One describe block per slice (todo.md OFFLINE BACKLOG O1-O14).
 */
const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("O10 scan unlock offline", () => {
  const base = {
    kind: "approval" as const,
    reason: "offline" as const,
    armedAt: new Date().toISOString(),
    rosterAt: null,
    keyId: "e1",
  };

  it("scan_unlock is an offline approval purpose, re-judged like the others", () => {
    expect(OFFLINE_APPROVAL_PURPOSES).toContain("scan_unlock");
    expect(isOfflineApprovalPurpose("scan_unlock")).toBe(true);
    expect(validateOfflineAuthPayload({ ...base, purpose: "scan_unlock" }).ok).toBe(true);
    expect(validateOfflineAuthPayload({ ...base, purpose: "nope" as never }).ok).toBe(false);
    const p = { ...base, purpose: "scan_unlock" as const };
    expect(judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "lead" }, currentKeyId: "e1" }).ok).toBe(true);
    expect(judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "sales" }, currentKeyId: "e1" }).ok).toBe(false);
  });

  it("the scan-unlock modal asks for the scan_unlock purpose and the shell passes it to the offline approval", () => {
    const sale = read("src/app/(site)/pos/SaleFlow.tsx");
    const modal = sale.slice(sale.indexOf("function ScanUnlockModal("));
    expect(modal.slice(0, 2500)).toContain('onApprove(pin, "scan_unlock")');
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toMatch(/onApprove=\{async \(pin, purpose\) =>/);
    expect(shell).toMatch(/approveOffline\(pin, purpose \?\? "price_override", reason\)/);
    expect(shell).toMatch(/purpose: OfflineApprovalPurpose,/);
  });
});

describe("O11 lot details offline", () => {
  const lot = { lotId: "L9", headline: "Lot 9", summary: "", sellable: true, sections: [], terpenes: [], coaUrl: "https://lab.example/coa.pdf" };

  it("self-tests pass", () => {
    const r = __runLotDetailsCacheCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(18);
  });

  it("a saved answer comes back offline with an honest age note", () => {
    const now = Date.UTC(2026, 10, 4, 18);
    const c = putLotDetails(parseLotDetailsCache(null), lotDetailsKey("p", "v"), { lots: [lot], lotCount: 1, warnings: [] }, now);
    const back = cachedLotDetails(parseLotDetailsCache(serializeLotDetailsCache(c)), lotDetailsKey("p", "v"), now + 2 * 3600_000);
    expect(back?.lots[0].coaUrl).toBe("https://lab.example/coa.pdf");
    expect(back?.warnings[0]).toMatch(/^Offline: these lot details were saved on this iPad 2 h ago/);
  });

  it("the storage key is registered encrypted and passes the registry audit", () => {
    const spec = findKeySpec("gw-pos-lot-details");
    expect(spec?.tier).toBe("encrypted-db");
    expect(auditKeyRegistry()).toEqual([]);
  });

  it("the shell saves every answer, falls back to the saved copy and warms while idle (never mid-sale)", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toMatch(/putLotDetails\(/);
    expect(shell).toMatch(/return cachedLotDetails\(/);
    expect(shell).toMatch(/nextLotDetailsToWarm\(/);
    expect(shell).toMatch(/screen !== "home" && screen !== "locked"/);
    const sale = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(sale).not.toMatch(/Lot details need a connection to the back office/);
  });
});

describe("D170 O7/O8 — flag stock and emailed receipts work offline (send-later outbox)", () => {
  it("the pure core passes its self-tests", () => {
    const r = __runDeferredOutboxCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(22);
  });

  it("a network failure retries; a server refusal is kept visible, never retried", () => {
    const a = addToOutbox(emptyOutbox(), { id: "x", kind: "stock_flag", body: { productId: "p" }, label: "Out of stock: P" }, 1000);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const retried = settleOutboxEntry(a.box, "x", classifyOutboxAttempt({ threw: true, status: null }), 2000);
    expect(retried.pending).toHaveLength(1);
    const refused = settleOutboxEntry(a.box, "x", classifyOutboxAttempt({ threw: false, status: 404, error: "Item not found" }), 2000);
    expect(refused.pending).toHaveLength(0);
    expect(refused.failed[0]?.reason).toBe("Item not found");
  });

  it("the outbox key is registered encrypted", () => {
    expect(findKeySpec("gw-pos-outbox")?.tier).toBe("encrypted-db");
    expect(auditKeyRegistry()).toEqual([]);
  });

  it("the shell queues offline instead of refusing, flushes when online and shows the status", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toMatch(/flagging stock needs a connection/);
    expect(shell).not.toMatch(/Offline — print the paper receipt instead\./);
    expect(shell).toMatch(/queueForLater\("stock_flag"/);
    expect(shell).toMatch(/queueForLater\("email_receipt"/);
    expect(shell).toMatch(/OUTBOX_ENDPOINT\[entry\.kind\]/);
    expect(shell).toMatch(/SEND LATER:/);
    const sale = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(sale).toMatch(/will be emailed as soon as this iPad is back online/);
  });
});
