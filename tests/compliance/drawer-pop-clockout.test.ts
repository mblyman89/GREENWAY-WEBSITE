/**
 * Owner D129 / D130 / D131 / D132 (2026-11-02):
 *   "For close drawer step, drawer should pop if given the employee assigned
 *    that tills pin. Should be logged in the audit log and give me warning if
 *    being used more than once per shift. Is there a smart way to keep this
 *    button, close drawer, safe from abuse? I need the drawer to pop for the
 *    first blind count."
 *   "Clock out allowed after first blind count, not after second count
 *    closing the till."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runDrawerPopCoreTests,
  checkPop,
  custodianOf,
  buildPopWarnings,
  POP_CLOSE_GRACE_MIN,
} from "@/lib/registers/drawer-pop-core";
import { validateTillRequest } from "@/lib/pos/till-core";
import { clockOutBlocked, clockOutBlockedMessage } from "@/lib/registers/shift-end-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("drawer-pop-core self-tests", () => {
  it("all pass", () => {
    const r = __runDrawerPopCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });
});

describe("D129: the till is assigned to the cashier working it", () => {
  it("2026-11-01 SR1: a manager counted in, the cashier rang every sale; the drawer is the cashier's", () => {
    const sales = Array.from({ length: 38 }, (_, i) => ({ employeeId: "daylin", atIso: `2026-11-02T0${i % 7}:00:00Z` }));
    expect(custodianOf({ openedBy: "michael", sales })).toBe("daylin");
  });
  it("before any sale, the person who counted in", () => {
    expect(custodianOf({ openedBy: "michael", sales: [] })).toBe("michael");
  });
});

describe("D130: only the assigned cashier's PIN opens the drawer for the count", () => {
  it("the till request carries a pop action with an optional reason", () => {
    const r = validateTillRequest({ action: "pop", pin: "1234" });
    expect(r.ok && r.req.action === "pop").toBe(true);
  });
  it("another employee is refused and pointed to No sale", () => {
    const r = checkPop({ employeeId: "m", custodianId: "d", custodianName: "Daylin Cole", priorPops: 0, reason: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("not_assigned");
      expect(r.error).toContain("No sale");
    }
  });
  it("the route checks the PIN against the cashier and audits BEFORE answering ok; never an expected figure", () => {
    const route = read("src/app/api/pos/till/route.ts");
    const i = route.indexOf('if (till.action === "pop")');
    expect(i).toBeGreaterThan(-1);
    const block = route.slice(i, route.indexOf("// \u2500\u2500 drop:", i));
    const order = ["drawerCustodian(", "popsForSession(", "checkPop(", "POP_AUDIT_ACTION", "ok: true"];
    let last = -1;
    for (const k of order) {
      const at = block.indexOf(k);
      expect(at, k).toBeGreaterThan(last);
      last = at;
    }
    expect(block).toContain("drawer.pop_refused");
    expect(block).toContain("drawer.pop_repeat_warning");
    expect(block).not.toMatch(/expected_close|over_short/);
    // A failed history read must not hand out a free open.
    expect(block).toContain("prior === null");
  });
  it("the iPad kicks the drawer only after the server said ok", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    const i = shell.indexOf("const popForCount = async");
    const body = shell.slice(i, shell.indexOf("const cancel = () =>", i));
    expect(body.indexOf('action: "pop"')).toBeGreaterThan(-1);
    expect(body.indexOf("!res.ok || !resBody?.ok")).toBeLessThan(body.indexOf("openCashDrawer("));
    expect(shell).toContain("Open drawer to count");
  });
});

describe("D131: once per shift, then a reason and an owner warning", () => {
  it("a second open needs a reason", () => {
    expect(checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 1, reason: "" }).ok).toBe(false);
    const r = checkPop({ employeeId: "d", custodianId: "d", custodianName: "D", priorPops: 1, reason: "it shut on me" });
    expect(r.ok && r.repeat).toBe(true);
  });
  it("repeat, not closed in time, and closed by someone else are warnings", () => {
    const sessions = new Map([
      ["s", { id: "s", registerName: "SR1", businessDay: "2026-11-02", status: "closed", closedAtIso: "2026-11-02T07:00:00Z", closedBy: "z" }],
    ]);
    const w = buildPopWarnings(
      [
        { sessionId: "s", atIso: "2026-11-02T06:00:00Z", employeeId: "d", popNumber: 1, reason: null },
        { sessionId: "s", atIso: "2026-11-02T06:10:00Z", employeeId: "d", popNumber: 2, reason: "shut" },
      ],
      sessions,
      "2026-11-02T09:00:00Z",
    );
    expect(w.map((x) => x.kind).sort()).toEqual(["closed_by_other", "not_closed", "repeat"]);
    expect(POP_CLOSE_GRACE_MIN).toBe(15);
  });
  it("the owner sees them on Over / short warnings (owner and admin only)", () => {
    const page = read("src/app/admin/registers/over-short/page.tsx");
    expect(page).toContain("loadPopWarnings(");
    expect(page).toContain("Drawer opened for the count");
    expect(page).toContain('requirePermission("registers.warnings")');
  });
});

describe("D132: clock-out after the blind count", () => {
  it("only a drawer still OPEN blocks; the guard looks at the cashier working it", () => {
    const store = read("src/lib/registers/drawer-pop-store.ts");
    const i = store.indexOf("export async function openDrawersWorkedBy");
    const body = store.slice(i, store.indexOf("export async function popsForSession"));
    expect(body).toContain('.eq("status", "open")');
    expect(body).toContain("drawerCustodian(");
    expect(read("src/lib/staffing/store.ts")).toContain("return openDrawersWorkedBy(employeeId)");
  });
  it("a closed drawer awaiting its second count does not block", () => {
    expect(clockOutBlocked({ isClockOut: true, source: "register", owned: [] }).blocked).toBe(false);
  });
  it("the refusal says the second count is not waited for", () => {
    expect(clockOutBlockedMessage([{ sessionId: "s", registerName: "Sales Register 1" }])).toContain("do not wait for the office second count");
  });
  it("the close success line says you can clock out now", () => {
    expect(read("src/app/(site)/pos/RegisterShell.tsx")).toContain("you can clock out now on the lock screen");
  });
});
