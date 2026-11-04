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
import {
  __runMemberBookCoreTests,
  matchFromBook,
  offlineRewardGrant,
  searchMemberBook,
  type MemberBook,
} from "../../src/lib/pos/member-book-core";
import { findKeySpec, auditKeyRegistry, keysRequiringEncryption } from "../../src/lib/pos/pos-storage-core";
import {
  __runOfflineTillCoreTests,
  judgeTillPins,
  offlineTillNote,
  validateTillPayload,
} from "../../src/lib/pos/offline-till-core";
import { EMPTY_DENOMS } from "../../src/lib/registers/cash";
import { findFixLots, fixIndexFromResponse, fixLotFromRow, parseFixIndex } from "../../src/lib/pos/fix-index-core";
import { decideFixAndSell } from "../../src/lib/pos/register-fix-later-core";
import {
  applyQueueRead,
  markHandedOver,
  offlineQueue,
  packFromResponse,
  parsePickupBook,
  pickupBookAgeNote,
  withPack,
} from "../../src/lib/pos/pickup-offline-core";
import { OUTBOX_ENDPOINT as OUTBOX_ENDPOINTS_O9 } from "../../src/lib/pos/deferred-outbox-core";

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

describe("D170 O15 + O7 — loyalty members on the iPad (lookup, scan attach, history offline)", () => {
  const now = 1_800_000_000_000;
  const book: MemberBook = {
    v: 1,
    at: now - 3 * 3600_000,
    tiers: [{ name: "Silver", minPoints: 500 }],
    rows: [
      { i: "a", f: "Bill", l: "McClendon", p: "3608093778", e: "bill@x.co", b: "1980-04-02", x: "13", m: false, s: 0, o: 29120, v: null, lp: null, bp: 320, lt: 900 },
    ],
  };

  it("the pure core passes its self-tests", () => {
    const r = __runMemberBookCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(31);
  });

  it("offline lookup uses the server's search rules and says how old the copy is", () => {
    const r = searchMemberBook(book, "mcc bill", now);
    expect(r.members[0]).toMatchObject({ customerId: "a", label: "Bill M.", points: 320, tierName: "Silver" });
    expect(r.note).toMatch(/saved on this iPad 3 h ago\. Points may have changed since\./);
  });

  it("offline scan attach needs exact name + birthdate", () => {
    expect(matchFromBook(book, { firstName: "Bill", lastName: "McClendon", dateOfBirth: "1980-04-02" })?.customerId).toBe("a");
    expect(matchFromBook(book, { firstName: "Bill", lastName: "McClendon", dateOfBirth: "1980-04-01" })).toBeNull();
  });

  it("the member book is encrypted at rest (birthdates, medical flag)", () => {
    expect(findKeySpec("gw-pos-member-book")?.tier).toBe("encrypted-db");
    expect(keysRequiringEncryption()).toContain("gw-pos-member-book");
    expect(auditKeyRegistry()).toEqual([]);
  });

  it("the route pages by id, is device-authed and keeps notes out", () => {
    const route = read("src/app/api/pos/member-book/route.ts");
    expect(route).toMatch(/authenticateDevice\(/);
    expect(route).toMatch(/\.order\("id", \{ ascending: true \}\)/);
    expect(route).not.toMatch(/staff_note/);
    expect(route).toMatch(/status: 503/);
  });

  it("the shell falls back to the book for lookup, scan attach and history, and swaps a full copy only", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toMatch(/searchMemberBook\(book, q, Date\.now\(\)\)/);
    expect(shell).toMatch(/matchFromBook\(memberBookRef\.current, identity\)/);
    expect(shell).toMatch(/bookHistorySummary\(/);
    expect(shell).toMatch(/if \(!parsed\.next\) \{/);
    expect(shell).not.toMatch(/Offline — history needs a connection\./);
    expect(shell).not.toMatch(/Offline — ring the sale without the member, or reconnect first\./);
  });
});

describe("D170 O15b — loyalty rewards work offline (priced on the iPad, issued at sync)", () => {
  const lines = [
    { variantId: "v1", productId: "p1", category: "flower", quantity: 1, unitPriceMinor: 4000, regularPriceMinor: 4000, costMinorUnits: 1000 },
  ];
  const id = "11111111-1111-4111-8111-111111111111";

  it("prices a 10% reward exactly like the server and marks it offline", () => {
    const r = offlineRewardGrant({ balancePoints: 320, rewardPoints: 150, lines, neverDiscountKeys: [], redemptionId: id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grant).toMatchObject({ redemptionId: id, appliedMinor: 400, pointsSpent: 150, offline: true, source: "points" });
    expect(r.grant.code).toMatch(/^GW-/);
  });

  it("refuses when the saved balance does not cover the reward, and never touches never-discount items", () => {
    expect(offlineRewardGrant({ balancePoints: 100, rewardPoints: 150, lines, neverDiscountKeys: [], redemptionId: id }).ok).toBe(false);
    expect(offlineRewardGrant({ balancePoints: 320, rewardPoints: 150, lines, neverDiscountKeys: ["p1"], redemptionId: id }).ok).toBe(false);
  });

  it("the sale payload validator requires 150/300 and the member for an offline reward", () => {
    const src = read("src/lib/pos/sale-event-core.ts");
    expect(src).toMatch(/offlineIssued\?: \{ rewardPoints: number \}/);
    expect(src).toMatch(/An offline-minted loyalty reward needs the member/);
  });

  it("sync issues the offline reward only if the LIVE balance covers it, else an exception", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/sale\.loyaltyRedemption\.offlineIssued && loyaltyCustomerId/);
    expect(sync).toMatch(/issueOfflineRedemption\(/);
    expect(sync).toMatch(/could not be honored at sync/);
    const store = read("src/lib/loyalty/loyalty-store.ts");
    expect(store).toMatch(/export async function issueOfflineRedemption/);
    expect(store).toMatch(/account\.balance_points < reward\.points/);
    expect(store).toMatch(/id: opts\.redemptionId/);
  });

  it("the shell prices offline, deducts from the saved book, and gives points back locally on Remove", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toMatch(/Offline — loyalty redemption needs a connection/);
    expect(shell).toMatch(/offlineRewardGrant\(\{/);
    expect(shell).toMatch(/saveBookPoints\(req\.customerId, -made\.grant\.pointsSpent\)/);
    expect(shell).toMatch(/saveBookPoints\(held\.customerId, held\.points\)/);
    const flow = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(flow).toMatch(/offlineIssued: \{ rewardPoints: appliedLoyalty\.rewardPoints \}/);
  });
});

describe("D170 O1 \u2014 drawer work offline (count-in, drop, swap, close, pop)", () => {
  const A = { employeeId: "11111111-1111-4111-8111-111111111111", armedAt: "2026-11-04T10:00:00.000Z", keyId: "e1" };
  const B = { employeeId: "22222222-2222-4222-8222-222222222222", armedAt: "2026-11-04T10:00:00.000Z", keyId: "e1" };
  const ref = "33333333-3333-4333-8333-333333333333";

  it("the pure core self-tests pass", () => {
    const r = __runOfflineTillCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(25);
  });

  it("offline uses the SAME till validator: no self-witness, swap needs another approver", () => {
    expect(validateTillPayload({ action: "open", drawerRef: ref, reason: "offline", actor: A, denoms: { ...EMPTY_DENOMS, twenties: 5 } }, A.employeeId).ok).toBe(true);
    expect(validateTillPayload({ action: "drop", drawerRef: ref, reason: "offline", actor: A, witness: A, amountMinor: 10000, window: "night" }).ok).toBe(false);
    expect(validateTillPayload({ action: "swap", drawerRef: ref, reason: "offline", actor: A, amountMinor: 10000, inDenoms: EMPTY_DENOMS, outDenoms: EMPTY_DENOMS }).ok).toBe(false);
    expect(validateTillPayload({ action: "pop", drawerRef: ref, reason: "offline", actor: A, popNumber: 2 }).ok).toBe(false);
    expect(validateTillPayload({ action: "open", drawerRef: ref, reason: "offline", actor: A, denoms: EMPTY_DENOMS }, B.employeeId).ok).toBe(false);
  });

  it("sync re-judges every PIN by who the employee is NOW", () => {
    const payload = { action: "swap" as const, drawerRef: ref, reason: "offline" as const, actor: A, approver: B };
    expect(judgeTillPins({ payload, people: { [A.employeeId]: { active: true, jobRole: "budtender" }, [B.employeeId]: { active: true, jobRole: "manager" } }, currentKeyId: "e1" }).ok).toBe(true);
    expect(judgeTillPins({ payload, people: { [A.employeeId]: { active: true, jobRole: "budtender" }, [B.employeeId]: { active: true, jobRole: "budtender" } }, currentKeyId: "e1" }).ok).toBe(false);
    expect(judgeTillPins({ payload, people: { [A.employeeId]: { active: true, jobRole: "budtender" }, [B.employeeId]: { active: true, jobRole: "manager" } }, currentKeyId: "e2" }).ok).toBe(false);
    expect(offlineTillNote(ref, "x")).toBe(`x [offline ${ref}]`);
  });

  it("till_action is a sale event, handled at sync, with migration 0340 widening the CHECK", () => {
    expect(read("src/lib/pos/sale-event-core.ts")).toMatch(/"till_action"/);
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/case "till_action"/);
    expect(sync).toMatch(/applyOfflineTill\(/);
    const mig = read("supabase/migrations/0340_pos_offline_till.sql");
    expect(mig).toMatch(/'till_action'/);
    expect(mig).toMatch(/'offline_auth'/);
    const store = read("src/lib/pos/offline-till-store.ts");
    expect(store).toMatch(/register_offline/);
  });

  it("the drawer modal falls back offline instead of refusing", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toMatch(/drawer actions need a connection to verify your PIN/);
    expect(shell).not.toMatch(/the drawer can only be opened for the count online/);
    expect(shell).toMatch(/enqueue\("till_action"/);
    expect(shell).toMatch(/const offlineSubmit = async/);
    expect(shell).toMatch(/const offlinePop = async/);
    expect(shell).toMatch(/proveOffline\(approverPin, "approver", true\)/);
    expect(shell).toMatch(/res\.status >= 500/);
  });
});

describe("D170 O4 — employee purchases and special discounts offline (witness PIN on the iPad)", () => {
  const p = { kind: "witness" as const, reason: "offline" as const, armedAt: "2026-11-04T10:00:00.000Z", rosterAt: null, keyId: "e1" };

  it("a witness PIN use is a valid offline_auth audit with no role gate", () => {
    expect(validateOfflineAuthPayload(p).ok).toBe(true);
    const ok = judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "budtender" }, currentKeyId: "e1" });
    expect(ok.ok && ok.action).toBe("register.offline_witness");
    expect(judgeOfflineAuth({ payload: p, employee: { active: false, jobRole: "budtender" }, currentKeyId: "e1" }).ok).toBe(false);
    expect(judgeOfflineAuth({ payload: p, employee: { active: true, jobRole: "budtender" }, currentKeyId: "e2" }).ok).toBe(false);
  });

  it("the shell checks the PIN on the iPad offline, on a throw, or on a 5xx, and keeps the second-person rules", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toMatch(/Offline — employee PINs need a connection to verify/);
    expect(shell).toMatch(/const witnessOffline = async/);
    expect(shell).toMatch(/offlineAuthPayload\("witness"/);
    expect(shell).toMatch(/if \(res\.status >= 500\) return witnessOffline\("server_error"\)/);
    expect(shell).toMatch(/v\.record\.employeeId === opts\.secondPersonFor/);
    expect(shell).toMatch(/!v\.record\.clockedIn/);
    const flow = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(flow).not.toMatch(/employee PINs can only be verified with a connection/);
  });

  it("sync still re-judges the discounted sale (programs, both employees active, F&F cap)", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/checkSpecialDiscountAtRegister\(/);
    expect(sync).toMatch(/sd\.kind === "friends_family"/);
  });
});

describe("D170 O9 — Fix & sell offline from the saved lot index", () => {
  const base = { k: "GF1", x: "WA1", n: "Blue Dream 3.5g", s: "active", q: 3, g: "Flower", t: "Usable Marijuana", u: 900, w: 3.5, wu: "g", hl: true, lp: true, sm: false, r: false, d: false, e: false };

  it("the offline decision is the route's own decideFixAndSell over the index rows", () => {
    const idx = fixIndexFromResponse({ rows: [{ i: "L1", c: "LOT-A", ...base }] }, Date.now());
    const lots = findFixLots(idx, "lot-a").map(fixLotFromRow);
    expect(lots).toHaveLength(1);
    expect(decideFixAndSell(lots, "lot-a").ok).toBe(true);
  });

  it("the real stops still refuse offline (recall, failed lab, destruction, expired edible)", () => {
    for (const bad of [{ r: true }, { lp: false }, { d: true }]) {
      const idx = fixIndexFromResponse({ rows: [{ i: "L1", c: "LOT-A", ...base, ...bad }] }, Date.now());
      expect(decideFixAndSell(findFixLots(idx, "LOT-A").map(fixLotFromRow), "LOT-A").ok).toBe(false);
    }
    expect(decideFixAndSell([], "NOPE").ok).toBe(false);
  });

  it("a corrupt saved index degrades to none (no guessing)", () => {
    expect(parseFixIndex("{oops")).toBeNull();
    expect(parseFixIndex(JSON.stringify({ v: 99, at: 1, rows: [] }))).toBeNull();
  });

  it("the index is an encrypted register key and the fix rides the outbox to the route", () => {
    expect(findKeySpec("gw-pos-fix-index")?.tier).toBe("encrypted-db");
    expect(OUTBOX_ENDPOINTS_O9.fix_and_sell).toBe("/api/pos/fix-and-sell");
  });

  it("the index route reads the same facts as fix-and-sell, fail-closed", () => {
    const route = read("src/app/api/pos/fix-index/route.ts");
    expect(route).toMatch(/authenticateDevice\(/);
    expect(route).toMatch(/recalledProductKeys\(\{ failClosed: true \}\)/);
    expect(route).toMatch(/OPEN_DESTRUCTION_STATUSES/);
    expect(route).toMatch(/expiryKindFor\(/);
    expect(route).toMatch(/sellableQty\(/);
    expect(route).toMatch(/status: 503/);
  });

  it("the shell falls back to the index offline, on a throw, or on a 5xx, and queues the audit", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toMatch(/Fix & sell needs a connection \(it reads the lot/);
    expect(shell).toMatch(/if \(!navigator\.onLine\) return fixOffline\(\)/);
    expect(shell).toMatch(/if \(res\.status >= 500\) return fixOffline\(\)/);
    expect(shell).toMatch(/queueForLater\(\s*"fix_and_sell"/);
    expect(shell).toMatch(/"\/api\/pos\/fix-index"/);
  });
});

describe("D170 O14 — pickup orders already waiting can be handed over offline", () => {
  const queue = [{ orderId: "o1", orderNumber: "GWY-1", displayName: "Happy Otter", customerLabel: "Sam K." }];
  const pack = {
    pack: {
      detail: { orderId: "o1", orderNumber: "GWY-1", totalMinor: 2500 },
      loaded: { orderId: "o1", orderNumber: "GWY-1", customerLabel: "Sam K.", customerNote: null, lines: [{ productId: "p", variantId: "v", productName: "A", quantity: 1 }], member: null },
    },
  };

  it("the book keeps the queue and each order's pack, and survives a restart", () => {
    const book = withPack(applyQueueRead(null, queue, 1000)!, packFromResponse(pack, 1000)!);
    const round = parsePickupBook(JSON.stringify(book))!;
    expect(round.queue).toHaveLength(1);
    expect(round.packs.o1.loaded.lines).toHaveLength(1);
  });

  it("an order handed over here is not offered twice, until the server stops listing it", () => {
    const book = markHandedOver(withPack(applyQueueRead(null, queue, 1000)!, packFromResponse(pack, 1000)!), "o1");
    expect(offlineQueue(book)).toHaveLength(0);
    expect(applyQueueRead(book, [], 2000)!.handedOver).toHaveLength(0);
  });

  it("the age note tells the cashier new orders cannot arrive offline", () => {
    expect(pickupBookAgeNote(applyQueueRead(null, queue, 1000)!, 10 * 60_000)).toMatch(/cannot reach this iPad/);
  });

  it("the book is an encrypted register key (customer names and notes)", () => {
    expect(findKeySpec("gw-pos-pickup-book")?.tier).toBe("encrypted-db");
    expect(keysRequiringEncryption()).toContain("gw-pos-pickup-book");
  });

  it("the route serves a read-only pack (no timeline note, no claim)", () => {
    const route = read("src/app/api/pos/pickup/route.ts");
    expect(route).toMatch(/body\.pack === true/);
    const store = read("src/lib/pos/pickup-store.ts");
    expect(store).toMatch(/export async function getRegisterPickupPack/);
    expect(store).toMatch(/audit: false/);
    expect(store).toMatch(/if \(input\.audit !== false\) await recordAudit/);
  });

  it("the modal falls back to the book offline, on a throw, or on a 5xx; cancel/confirm/change stay online", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toMatch(/if \(!navigator\.onLine\) return fromBook\(\)/);
    expect(shell).toMatch(/if \(res\.status >= 500\) return fromBook\(\)/);
    expect(shell).toMatch(/const loadFromBook = \(\): boolean =>/);
    expect(shell).toMatch(/disabled=\{busy \|\| offlineMode\}/);
    expect(shell).toMatch(/markHandedOver\(pickupBookRef\.current, loadedOrderIdRef\.current\)/);
    expect(shell).toMatch(/pickupCount=\{online \? pickupCount : offlinePickupCount\}/);
  });

  it("sync closes the order only if still active, and tells the manager otherwise", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/"order\.pickup_closed_before_sync"/);
  });
});
