import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  __runOfflineUnlockCoreTests,
  DEFAULT_OFFLINE_POLICY,
  judgeOfflineAuth,
  offlineFallbackAllowed,
  OFFLINE_PBKDF2_ITERATIONS,
  OFFLINE_WIPE_AFTER_FAILURES,
  parseVault,
  type OfflineArmBlock,
} from "../../src/lib/pos/offline-unlock-core";
import {
  __offlineCryptoForTests,
  armOfflineFromOnline,
  loadOfflineVault,
  verifyOfflinePin,
} from "../../src/lib/pos/offline-unlock";
import {
  __resetSecureStoreForTests,
  __secureStoreItemsForTests,
  loadOfflineVaultRaw,
  saveOfflineVaultRaw,
  clearOfflineVault,
  SECURE_ITEM_NAMES,
  keychainItemPolicy,
} from "../../src/lib/pos/pos-secure-store";
import { POS_EVENT_TYPES } from "../../src/lib/pos/sale-event-core";
import { IPAD_SETUP_CHECKLIST } from "../../src/lib/pos/ipad-setup-core";
import { can } from "../../src/lib/auth/roles";

/**
 * D161 — offline PIN unlock on the iPad registers.
 *
 * Owner, 2026-11-04: "please now build for me something that allows my
 * employees to unlock the ipad registers in offline mode. we cant ring a sale
 * if we cant get past the pin unlock page."
 */
const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const EMP_A = "11111111-1111-4111-8111-111111111111";
const EMP_B = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 7).toString("base64url");
const KEY2 = Buffer.alloc(32, 9).toString("base64url");

function arm(id: string, role: string, over: Partial<OfflineArmBlock> = {}): OfflineArmBlock {
  return {
    keyId: "e1",
    key: KEY,
    policy: { ...DEFAULT_OFFLINE_POLICY },
    serverNowMs: Date.now(),
    pinStamp: "a".repeat(32),
    canApprove: role === "manager" || role === "lead",
    employee: { id, fullName: id === EMP_A ? "Alex Sales" : "Morgan Manager", jobRole: role, sawUsername: null },
    ...over,
  };
}

describe("D161 pure core", () => {
  it("self-tests pass", () => {
    const r = __runOfflineUnlockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(90);
  });

  it("only a thrown request or a 5xx may fall back; a 4xx 'no' is final", () => {
    expect(offlineFallbackAllowed({ threw: true, status: null })).toBe(true);
    expect(offlineFallbackAllowed({ threw: false, status: 503 })).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 423, 429]) expect(offlineFallbackAllowed({ threw: false, status: s })).toBe(false);
    expect(offlineFallbackAllowed({ threw: false, status: 200 })).toBe(false);
  });

  it("sync re-judges offline approvals and flags pre-reset keys", () => {
    const base = { kind: "approval" as const, reason: "offline" as const, armedAt: new Date().toISOString(), rosterAt: null, keyId: "e1", purpose: "no_sale" as const };
    expect(judgeOfflineAuth({ payload: base, employee: { active: true, jobRole: "manager" }, currentKeyId: "e1" }).ok).toBe(true);
    expect(judgeOfflineAuth({ payload: base, employee: { active: true, jobRole: "sales" }, currentKeyId: "e1" }).ok).toBe(false);
    expect(judgeOfflineAuth({ payload: base, employee: { active: false, jobRole: "manager" }, currentKeyId: "e1" }).ok).toBe(false);
    expect(judgeOfflineAuth({ payload: base, employee: { active: true, jobRole: "manager" }, currentKeyId: "e2" }).ok).toBe(false);
  });
});

describe("D161 iPad crypto round trip (real WebCrypto, memory secure store)", () => {
  beforeEach(() => {
    __resetSecureStoreForTests();
  });

  it("PBKDF2 work factor is the OWASP 2023 figure", () => {
    expect(OFFLINE_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("arm then verify: right PIN unlocks, wrong PIN refused, PIN never stored", async () => {
    expect(await armOfflineFromOnline("4821", arm(EMP_A, "sales"), true)).toBe(true);
    const raw = loadOfflineVaultRaw()!;
    expect(raw).toBeTruthy();
    expect(raw.includes("4821")).toBe(false);
    const v = loadOfflineVault()!;
    expect(v.records).toHaveLength(1);
    expect(v.records[0]!.clockedIn).toBe(true);

    const ok = await verifyOfflinePin("4821");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.record.employeeId).toBe(EMP_A);

    const bad = await verifyOfflinePin("4822");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.counted).toBe(true);
  }, 60_000);

  it("approval prompt refuses a correct sales PIN without counting it as a guess", async () => {
    await armOfflineFromOnline("4821", arm(EMP_A, "sales"), false);
    await armOfflineFromOnline("9090", arm(EMP_B, "manager"), false);
    const sales = await verifyOfflinePin("4821", { requireApprover: true });
    expect(sales.ok).toBe(false);
    if (!sales.ok) {
      expect(sales.counted).toBe(false);
      expect(sales.message).toMatch(/cannot approve/);
    }
    const mgr = await verifyOfflinePin("9090", { requireApprover: true });
    expect(mgr.ok).toBe(true);
  }, 60_000);

  it("a key change (owner reset) erases every verifier", async () => {
    await armOfflineFromOnline("4821", arm(EMP_A, "sales"), false);
    await armOfflineFromOnline("9090", arm(EMP_B, "manager", { keyId: "e2", key: KEY2 }), false);
    const v = loadOfflineVault()!;
    expect(v.keyId).toBe("e2");
    expect(v.records.map((r) => r.employeeId)).toEqual([EMP_B]);
    expect((await verifyOfflinePin("4821")).ok).toBe(false);
  }, 60_000);

  it("policy OFF from the server arms nobody and clears the list", async () => {
    await armOfflineFromOnline("4821", arm(EMP_A, "sales"), false);
    await armOfflineFromOnline("9090", arm(EMP_B, "manager", { policy: { ...DEFAULT_OFFLINE_POLICY, enabled: false } }), false);
    expect(loadOfflineVault()!.records).toHaveLength(0);
  }, 60_000);

  it(`${OFFLINE_WIPE_AFTER_FAILURES} wrong PINs in a row erase the offline list`, async () => {
    await armOfflineFromOnline("4821", arm(EMP_A, "sales"), false);
    // Make the PBKDF2 cheap for this loop only (the vault records its own iteration count).
    const v = loadOfflineVault()!;
    const cheap = { ...v, iterations: 100_000, records: [] as typeof v.records };
    const d = await __offlineCryptoForTests.stretchPin("4821", v.salt, 100_000);
    const verifier = await __offlineCryptoForTests.verifierFor(v.key, d, EMP_A);
    cheap.records = [{ ...v.records[0]!, verifier }];
    saveOfflineVaultRaw(JSON.stringify(cheap));
    let wiped = false;
    let t = Date.now();
    for (let i = 0; i < OFFLINE_WIPE_AFTER_FAILURES && !wiped; i++) {
      // Jump past any pause so every guess is actually evaluated.
      t += 60 * 60_000;
      const r = await verifyOfflinePin(String(1000 + i), { nowMs: t });
      if (!r.ok && r.wiped) wiped = true;
    }
    expect(wiped).toBe(true);
    const after = loadOfflineVault()!;
    expect(after.records).toHaveLength(0);
    expect(after.wipes).toBe(1);
  }, 120_000);

  it("a malformed arm block (old server) arms nothing and never throws", async () => {
    expect(await armOfflineFromOnline("4821", null, null)).toBe(false);
    expect(await armOfflineFromOnline("4821", { keyId: "e1" }, null)).toBe(false);
    expect(loadOfflineVaultRaw()).toBeNull();
  });

  it("the vault is a secure-store item, this-device-only, erased on unpair", () => {
    expect(SECURE_ITEM_NAMES).toContain("offline-unlock");
    const pol = keychainItemPolicy("offline-unlock");
    expect(pol.sync).toBe(false);
    expect(String(pol.access)).toMatch(/ThisDeviceOnly/);
    saveOfflineVaultRaw("{}");
    expect(__secureStoreItemsForTests()).toContain("offline-unlock");
    clearOfflineVault();
    expect(__secureStoreItemsForTests()).not.toContain("offline-unlock");
    expect(parseVault("{}")).toBeNull();
  });
});

describe("D161 wiring (source checks)", () => {
  const shell = read("src/app/(site)/pos/RegisterShell.tsx");

  it("the old 'unlock requires a connection' dead end is gone", () => {
    expect(shell).not.toMatch(/unlock requires a connection in this build/);
    expect(shell).toMatch(/verifyOfflinePin\(typed\)/);
    expect(shell).toMatch(/onUnlockedOffline/);
  });

  it("the price-override modal no longer refuses before the offline fallback runs", () => {
    const sale = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(sale).not.toMatch(/manager approval needs a connection to verify the PIN/);
    expect(shell).toMatch(/approveOffline\(pin, purpose \?\? "price_override"/);
    expect(shell).toMatch(/approveOffline\(pin, "no_sale"/);
    expect(shell).toMatch(/noSaleBlockReason\(!!drawer, online \|\| offlineApprovalOk\)/);
  });

  it("every PIN endpoint arms offline on success", () => {
    expect(shell.match(/armOfflineFromOnline\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    for (const r of ["unlock", "approve", "clock"]) {
      expect(read(`src/app/api/pos/${r}/route.ts`)).toMatch(/offlineArmFor\(/);
    }
  });

  it("online PIN requests have a hard timeout so a hung network falls back", () => {
    expect(shell).toMatch(/AbortController/);
    expect(shell).toMatch(/ONLINE_UNLOCK_TIMEOUT_MS/);
  });

  it("every offline PIN use is queued as an audited offline_auth event", () => {
    expect(POS_EVENT_TYPES).toContain("offline_auth");
    expect(shell).toMatch(/enqueue\(\s*"offline_auth"/);
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/case "offline_auth"/);
    expect(sync).toMatch(/judgeOfflineAuth\(/);
    expect(read("supabase/migrations/0339_pos_offline_auth.sql")).toMatch(/'offline_auth'/);
  });

  it("the roster never sends a PIN, hash or verifier", () => {
    const store = read("src/lib/pos/offline-unlock-store.ts");
    const pushBlock = store.slice(store.indexOf("employees.push({"), store.indexOf("});", store.indexOf("employees.push({")));
    expect(pushBlock).not.toMatch(/clock_pin|verifier/);
    expect(read("src/app/api/pos/offline-roster/route.ts")).toMatch(/authenticateDevice/);
  });

  it("the roster refresh erases the vault only on a definitive pairing refusal", () => {
    expect(shell).toMatch(/r\.kind === "refused" && classifyDeviceAuthFailure/);
    const client = read("src/lib/pos/offline-unlock.ts");
    expect(client).toMatch(/never purge on a hiccup/);
  });

  it("owner-only policy + reset, audited, kept out of the D142 actions file", () => {
    expect(can("owner", "registers.lockdown")).toBe(true);
    const acts = read("src/app/admin/registers/ipad-setup/offline-actions.ts");
    expect(acts.match(/requirePermission\("registers\.lockdown"\)/g)?.length).toBe(2);
    expect(acts).toMatch(/pos\.offline_unlock_policy_saved/);
    expect(acts).toMatch(/pos\.offline_unlock_reset/);
    expect(acts).toMatch(/getOfflinePolicyStrict/);
    const page = read("src/app/admin/registers/ipad-setup/page.tsx");
    expect(page).not.toMatch(/still needs the internet in this build/);
    expect(page).toMatch(/OfflineUnlockPolicyEditor/);
  });

  it("the setup checklist has a device-verified offline unlock drill", () => {
    const item = IPAD_SETUP_CHECKLIST.find((i) => i.id === "drill-offline-unlock");
    expect(item?.verify).toBe("offlineArmed");
  });
});
