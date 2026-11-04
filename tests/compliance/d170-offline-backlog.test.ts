import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isOfflineApprovalPurpose,
  judgeOfflineAuth,
  OFFLINE_APPROVAL_PURPOSES,
  validateOfflineAuthPayload,
} from "../../src/lib/pos/offline-unlock-core";

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
