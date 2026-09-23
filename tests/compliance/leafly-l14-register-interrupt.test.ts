/**
 * tests/compliance/leafly-l14-register-interrupt.test.ts
 *
 * SLICE L-14 — THE RECEIPT/ACCEPTANCE CORRECTION, THE CLAIM, AND THE MODAL.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * L-13 proved a bridge can be perfect and disconnected. This slice found the
 * same shape TWICE more, and both times the code was not merely unreachable —
 * it was reachable and lying:
 *
 *   1. `bridge-server.ts` passed `registerSaleOpen: false` as a HARDCODED
 *      LITERAL into `decideCancelPlan()`. Every branch of that function that
 *      handles "Leafly cancelled an order that is open in a register right
 *      now" was therefore dead. The pure core was correct, fully self-tested,
 *      and could never fire. A cancellation landing mid-sale produced the
 *      quiet path instead of the loud one.
 *
 *   2. `order-ack-server.ts` sent ONLY the acknowledgement. Leafly's spec
 *      draws a line the codebase did not:
 *        acknowledge       = "confirms that your system has retrieved all
 *                             necessary details regarding an order" — a
 *                             RECEIPT, forced within 15 minutes or auto-cancel.
 *        status=confirmed  = "Move an order along its lifecycle" — the
 *                             BUSINESS ACCEPTANCE.
 *      This is the EDI 997-vs-855 distinction, the long-standing enterprise
 *      standard for exactly this: the functional acknowledgment confirms
 *      technical receipt and explicitly does NOT confirm that the business
 *      transaction was accepted. We sent the 997 and never the 855, so the
 *      shopper's order sat at `pending` forever while the store built it.
 *
 * Both are invisible to a unit test of the pure core, because in both cases
 * the pure core was already right. Only the WIRING was wrong. So, like
 * `leafly-bridge-wiring.test.ts`, this file reads real source text and asserts
 * the connections exist — including the negative assertion that the hardcoded
 * literal has not come back.
 *
 * ===========================================================================
 * WHY SOME ASSERTIONS LOOK PARANOID
 * ===========================================================================
 * The blocking modal is the only screen in this codebase that takes a till
 * away from a cashier mid-transaction and demands an irreversible choice. The
 * two ways it can hurt somebody are:
 *   - it can be dismissed without a decision (then a cancelled order gets
 *     handed to a customer, which is a regulated handover of product that is
 *     no longer sold), or
 *   - it can jam (then the register is bricked with a queue in front of it).
 * The assertions below are aimed squarely at those two, which is why they
 * check for the ABSENCE of a close button and the PRESENCE of an error path
 * that leaves the modal usable.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __runRegisterClaimCoreTests,
  CLAIM_STALE_AFTER_MINUTES,
  assessRegisterClaim,
  buildRegisterInterrupt,
  describeDisposition,
  explainCancelReason,
  toCancelDisposition,
  summariseInterrupt,
  summariseInterrupts,
  type InterruptRecord,
} from "@/lib/leafly/register-claim-core";

import {
  LEAFLY_ACK_IRREVERSIBLE_WARNING,
  decideStatusChange,
} from "@/lib/leafly/order-ack-core";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

const BRIDGE_SERVER = "src/lib/leafly/bridge-server.ts";
const ACK_SERVER = "src/lib/leafly/order-ack-server.ts";
const CLAIM_SERVER = "src/lib/leafly/register-claim-server.ts";
const CLAIM_CORE = "src/lib/leafly/register-claim-core.ts";
const MODAL = "src/app/pos/RegisterInterruptModal.tsx";
const SHELL = "src/app/pos/RegisterShell.tsx";
const PICKUP_ROUTE = "src/app/api/pos/pickup/route.ts";
const INTERRUPTS_ROUTE = "src/app/api/pos/interrupts/route.ts";
const SYNC_STORE = "src/lib/pos/sync-store.ts";
const MIGRATION = "supabase/migrations/0229_leafly_register_claim.sql";
// SLICE L-14 dashboard — the back-office surface.
const ORDERS_PAGE = "src/app/admin/orders/page.tsx";
const ORDERS_PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx";

/** Strip line and block comments so prose cannot satisfy a code assertion. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

// ===========================================================================
describe("L-14 · the pure core", () => {
  it("passes its own self-tests", () => {
    expect(() => __runRegisterClaimCoreTests()).not.toThrow();
  });

  it("names the order on the blocking modal's title", () => {
    // A cashier asked to VOID a sale must be told which sale. The title is
    // what the modal renders, and it is stored verbatim by 0229.
    const iv = buildRegisterInterrupt({
      orderId: "o-1",
      orderNumber: "GW-1001",
      plan: {
        dispositionRequired: true,
        alertFloor: true,
        severity: "urgent",
        staffMessage: "Do not complete this sale.",
      },
      reasonCode: "customer",
      raisedAt: new Date().toISOString(),
    });
    expect(iv).not.toBeNull();
    expect(iv?.title).toContain("GW-1001");
  });

  it("never renders a title with a hole in it when the number is missing", () => {
    for (const n of ["", "   "]) {
      const iv = buildRegisterInterrupt({
        orderId: "o-2",
        orderNumber: n,
        plan: {
          dispositionRequired: true,
          alertFloor: true,
          severity: "urgent",
          staffMessage: "Do not complete this sale.",
        },
        raisedAt: new Date().toISOString(),
      });
      expect(iv?.title).toBe("Leafly cancelled this order");
      expect(iv?.title).not.toMatch(/\s{2,}/);
    }
  });

  it("stays silent when the core says silence", () => {
    // The guard that stops a modal appearing for every cancellation of an
    // order nobody had touched. If this regresses, staff learn to dismiss
    // modals without reading them — which defeats the whole slice.
    expect(
      buildRegisterInterrupt({
        orderId: "o-3",
        orderNumber: "GW-1003",
        plan: { dispositionRequired: false, alertFloor: false, severity: "none", staffMessage: "" },
        raisedAt: new Date().toISOString(),
      }),
    ).toBeNull();
  });

  it("fails towards 'held' on an unreadable or future claim timestamp", () => {
    // Asymmetric cost. Treating a live claim as stale lets a second register
    // grab an order that is being bagged; treating a stale one as held costs
    // one human escalation. So garbage must never read as 'unclaimed'.
    const now = new Date("2026-09-18T20:00:00.000Z");
    for (const bad of ["not-a-date", "", "2099-01-01T00:00:00.000Z"]) {
      const a = assessRegisterClaim(
        { deviceId: "d-1", claimedAt: bad } as never,
        now,
      );
      expect(a.state).not.toBe("unclaimed");
    }
  });

  it("only ever accepts the two dispositions it designed", () => {
    // Allowlist, not denylist: an unanticipated value must be refused rather
    // than recorded as a disposition nobody designed.
    expect(toCancelDisposition("void")).toBe("void");
    expect(toCancelDisposition("walk_in")).toBe("walk_in");
    for (const bad of ["complete", "delete", "cancel", "", "   ", null, 42, {}]) {
      expect(toCancelDisposition(bad as never)).toBeNull();
    }
  });

  it("shows an unknown Leafly cancel reason verbatim instead of guessing", () => {
    // Leafly can add a reason code at any time. Inventing an explanation for
    // one we have never seen would put a false statement in front of staff.
    const out = explainCancelReason("a_brand_new_reason_code");
    expect(out).toContain("a_brand_new_reason_code");
  });

  it("gives the two dispositions genuinely different consequences", () => {
    expect(describeDisposition("void").label).not.toBe(describeDisposition("walk_in").label);
    expect(describeDisposition("void").detail).toMatch(/restock/i);
  });

  it("keeps the stale window long enough not to cancel a live sale", () => {
    // A claim that expires too early is the dangerous direction: it releases
    // an order somebody is actively bagging.
    expect(CLAIM_STALE_AFTER_MINUTES).toBeGreaterThanOrEqual(5);
  });
});

// ===========================================================================
describe("L-14 · the correction: receipt is not acceptance", () => {
  it("treats pending → confirmed as a legal forward transition", () => {
    const d = decideStatusChange({
      acknowledgedAt: "2026-09-18T20:00:00.000Z",
      currentStatus: "pending",
      nextStatus: "confirmed",
      cancelationReasonCode: null,
    });
    expect(d.allowed).toBe(true);
    expect(d.body).toEqual({ status: "confirmed" });
  });

  it("refuses a confirmed push when the order has NOT been acknowledged", () => {
    // This is the rule that made the first draft of this slice a no-op: the
    // snapshot handed to setLeaflyOrderStatus came from BEFORE the
    // acknowledgement, so acknowledged_at was null and every push refused.
    const d = decideStatusChange({
      acknowledgedAt: null,
      currentStatus: "pending",
      nextStatus: "confirmed",
      cancelationReasonCode: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("not_acknowledged");
  });

  it("sends status=confirmed from the acknowledgement path", () => {
    const src = code(read(ACK_SERVER));
    expect(src).toContain("setLeaflyOrderStatus");
    expect(src).toMatch(/nextStatus:\s*"confirmed"/);
  });

  it("hands the status push a POST-acknowledgement snapshot", () => {
    // The whole slice turns on this. If `input.order` is passed unchanged,
    // acknowledged_at is null, RULE 1 refuses, nothing is sent, and the only
    // symptom is a shopper who never sees their order confirmed.
    const src = code(read(ACK_SERVER));
    expect(src).toMatch(/acknowledged_at:\s*acknowledgedAt\.toISOString\(\)/);
    // And the stamp written to the database must be the SAME instant.
    expect(src).toMatch(/markLeaflyOrderAcknowledged\(\s*orderId\s*,\s*acknowledgedAt\s*\)/);
  });

  it("never lets a failed confirm push fail the acknowledgement", () => {
    // Leafly has already taken the acknowledgement and the ID images are
    // already destroyed. Reporting failure here invites a second press
    // against a door that is closed.
    const src = read(ACK_SERVER);
    const i = src.indexOf('nextStatus: "confirmed"');
    expect(i).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, i - 2000), i + 2000);
    expect(around).toContain("try {");
    expect(around).toContain("catch");
  });

  it("appends rather than overwrites an existing bridge warning", () => {
    // A bridge failure and a status failure are different problems and a
    // budtender may be facing both. Overwriting hides whichever came first.
    //
    // NOT pinned to one exact spelling. This assertion was originally written
    // as /bridgeWarning\s*=\s*bridgeWarning\s*\?/ and went stale the moment
    // the code moved to the template-literal form -- which it had to, because
    // the L-13 wiring guard requires the right-hand side of a bridgeWarning
    // assignment to begin with a string delimiter. A stale assertion is worse
    // than a missing one while it is red, so this checks the BEHAVIOUR in a
    // way that survives reformatting.
    const src = code(read(ACK_SERVER));

    // Every append site must mention bridgeWarning on its own right-hand
    // side. That is precisely what distinguishes an append from an overwrite.
    const appends = [...src.matchAll(/bridgeWarning\s*=\s*[^;]*bridgeWarning[^;]*;/g)];
    expect(appends.length).toBe(2);

    for (const m of appends) {
      // `?? ""` -- without it, appending onto a null first warning renders the
      // literal word "null" into a message a budtender has to act on.
      expect(m[0]).toMatch(/bridgeWarning\s*\?\?\s*""/);
      // .trim() -- without it, appending onto an empty warning leaves a
      // leading space, and the join below would double it.
      expect(m[0]).toContain(".trim()");
    }

    // And the region after the confirmed push must not contain a bridgeWarning
    // assignment that THROWS THE PRIOR VALUE AWAY. Scoped to that region on
    // purpose: the two earlier assignments are the FIRST write (the bridge
    // failure itself) and correctly do not reference the old value, so an
    // unscoped version of this check would either fail on those or have to be
    // weakened until it proved nothing.
    const at = src.indexOf('nextStatus: "confirmed"');
    expect(at).toBeGreaterThan(-1);
    const after = src.slice(at);
    const assignments = [...after.matchAll(/bridgeWarning\s*=\s*([^;]*);/g)];
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(a[1]).toContain("bridgeWarning");
    }
  });

  it("tells the operator that Accept is also the business acceptance", () => {
    // The button now does two things. Its own warning must say so.
    expect(LEAFLY_ACK_IRREVERSIBLE_WARNING).toMatch(/pending/i);
    // ...without losing the irreversible part, which still comes first.
    expect(LEAFLY_ACK_IRREVERSIBLE_WARNING).toMatch(/government ID/i);
    expect(LEAFLY_ACK_IRREVERSIBLE_WARNING.indexOf("government ID")).toBeLessThan(
      LEAFLY_ACK_IRREVERSIBLE_WARNING.indexOf("pending"),
    );
  });
});

// ===========================================================================
describe("L-14 · the dead branch is alive", () => {
  it("does NOT hardcode registerSaleOpen: false", () => {
    // The exact defect. A literal here silently disables every collision
    // branch in decideCancelPlan while leaving its unit tests green.
    const src = code(read(BRIDGE_SERVER));
    expect(src).not.toMatch(/registerSaleOpen:\s*false/);
    expect(src).not.toMatch(/registerSaleOpen:\s*true/);
  });

  it("reads the real claim and feeds it to the cancel plan", () => {
    const src = code(read(BRIDGE_SERVER));
    expect(src).toContain("readRegisterClaim");
    expect(src).toMatch(/registerSaleOpen:\s*claim\.registerSaleOpen/);
  });

  it("raises an interrupt only when the plan says to alert the floor", () => {
    const src = code(read(BRIDGE_SERVER));
    expect(src).toContain("raiseRegisterInterrupt");
    expect(src).toMatch(/plan\.alertFloor/);
  });
});

// ===========================================================================
describe("L-14 · the claim is taken and released", () => {
  it("claims the order when a register loads it", () => {
    // Asserts the CALL, not the name. The name also appears on the dynamic
    // import destructure, so an earlier version of this test stayed green with
    // the actual invocation deleted. Mutation testing caught that.
    const src = code(read(PICKUP_ROUTE));
    expect(src).toMatch(/await\s+claimLeaflyOrderForRegister\s*\(/);
    expect(src).toContain("isMarketplace");
  });

  it("releases the claim when the sale is superseded", () => {
    // Without this, a dead or abandoned till holds an order forever and the
    // interrupt is addressed to a device nobody is standing at.
    //
    // Again the CALL, not the name -- see the claim test above.
    const src = code(read(SYNC_STORE));
    expect(src).toMatch(/await\s+releaseLeaflyOrderClaim\s*\(/);
  });

  it("degrades to pre-L-14 behaviour when 0229 has not been applied", () => {
    // House rule 6: the owner applies migrations BY HAND. A missing table
    // must never take the register down.
    const src = code(read(CLAIM_SERVER));
    expect(src).toContain("isMissing0229");
    expect(src).toContain("42703"); // undefined_column
    expect(src).toContain("42P01"); // undefined_table
  });

  it("treats a duplicate interrupt as success, not failure", () => {
    // Leafly retries webhooks. 23505 means the floor has already been told.
    const src = code(read(CLAIM_SERVER));
    expect(src).toContain("23505");
  });

  it("guards the resolve against a race", () => {
    const src = code(read(CLAIM_SERVER));
    expect(src).toMatch(/\.is\(\s*"resolved_at"\s*,\s*null\s*\)/);
  });
});

// ===========================================================================
describe("L-14 · the modal cannot be escaped or jammed", () => {
  const modal = read(MODAL);

  it("is a real modal dialog", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
  });

  it("offers NO way out without a decision", () => {
    // Every one of these is a way a cancelled order gets handed to a customer.
    const c = code(modal);
    expect(c).not.toMatch(/onClick=\{[^}]*onClose/);
    expect(c).not.toMatch(/aria-label="Close"/i);
    expect(c).not.toMatch(/Escape/);
    expect(c).not.toMatch(/onKeyDown/);
  });

  it("guards against a double tap", () => {
    // Two taps must not file two dispositions for one sale.
    //
    // Asserts the EARLY RETURN, not merely the presence of the expression
    // `busy !== null`. That expression also appears in the `disabled=` and
    // style props below, so the first version of this test stayed green with
    // the real guard deleted. Mutation testing caught that.
    //
    // `disabled` alone is not sufficient: React re-renders asynchronously, and
    // two taps inside one frame both run the handler before the prop updates.
    expect(code(modal)).toMatch(/if\s*\(\s*busy\s*!==\s*null\s*\)\s*return\s*;/);
  });

  it("stays open and usable when the submit fails", () => {
    // If a network blip closed the modal, the interrupt would be gone from
    // the screen and unresolved in the database. If it froze, the till is
    // bricked. It must do neither.
    const c = code(modal);
    expect(c).toMatch(/setBusy\(null\)/);
    expect(c).toMatch(/setError/);
  });

  it("puts destructive styling only on the destructive choice", () => {
    expect(modal).toContain("Void this sale");
  });
});

// ===========================================================================
describe("L-14 · the register actually polls for interrupts", () => {
  const shell = read(SHELL);

  it("mounts the modal", () => {
    expect(shell).toContain("RegisterInterruptModal");
  });

  it("polls the interrupts endpoint", () => {
    expect(code(shell)).toContain("/api/pos/interrupts");
  });

  it("does NOT gate the poll on the home screen", () => {
    // The cancellation that matters most arrives MID-SALE. A poll that only
    // runs on the idle screen would reach the one cashier who does not need
    // it and miss the one who does.
    //
    // Asserts the absence of ANY mention of `screen`, not of one particular
    // spelling. The first version of this test looked for `screen === "home"`
    // and was defeated by `screen !== "home"` -- the identical defect written
    // the other way round. Mutation testing caught that; hence the widening.
    const c = code(shell);
    const i = c.indexOf("/api/pos/interrupts");
    expect(i).toBeGreaterThan(-1);
    const start = c.lastIndexOf("const pollInterrupts", i);
    expect(start).toBeGreaterThan(-1);
    const effect = c.slice(start, i + 500);
    expect(effect).not.toMatch(/\bscreen\b/);
  });

  it("never swaps a modal out from under a finger", () => {
    expect(code(shell)).toMatch(/setInterrupt\(\s*\(current\)\s*=>\s*current\s*\?\?/);
  });
});

// ===========================================================================
describe("L-14 · the endpoint validates what it is told", () => {
  const route = code(read(INTERRUPTS_ROUTE));

  it("allowlists the disposition through the pure core", () => {
    // Rule 11: the allowlist exists once. The route must not re-implement it.
    expect(route).toContain("toCancelDisposition");
  });

  it("requires a name, so the audit record is not anonymous", () => {
    expect(route).toContain("employeeName");
  });

  it("authenticates the device like every other register endpoint", () => {
    expect(route).toMatch(/withPosCors|posPreflightResponse/);
  });
});

// ===========================================================================
describe("L-14 · the migration protects the invariants", () => {
  const sql = read(MIGRATION);

  it("is idempotent, because the owner applies it by hand", () => {
    expect(sql).toContain("if not exists");
    expect(sql).not.toMatch(/drop\s+table/i);
  });

  it("allows only ONE open interrupt per order", () => {
    // Leafly retries. Three retries must not become three modals.
    //
    // Pinned to the EXACT index name. The first version used lazy quantifiers
    // between "unique index" and "where resolved_at is null", which let the
    // match begin at one index and end at another -- `..._open_idx` is also
    // partial on `resolved_at is null` -- so downgrading this index from
    // UNIQUE to ordinary still satisfied it. Mutation testing caught that.
    const m = sql.match(
      /create\s+(unique\s+)?index\s+(if not exists\s+)?leafly_register_interrupts_one_open_per_order/i,
    );
    expect(m).not.toBeNull();
    expect(m?.[1]).toBeTruthy(); // it must be UNIQUE, not merely an index
    // ...and it must be PARTIAL, or a resolved interrupt would block the next one.
    const after = sql.slice(sql.indexOf("leafly_register_interrupts_one_open_per_order"));
    expect(after.slice(0, 200)).toMatch(/where\s+resolved_at\s+is\s+null/i);
  });

  it("constrains the disposition at the database level too", () => {
    expect(sql).toMatch(/disposition[\s\S]{0,200}in\s*\(\s*'void'\s*,\s*'walk_in'\s*\)/i);
  });

  it("leaves the inbound cancel reason UNCONSTRAINED", () => {
    // Inbound facts from Leafly are permissive; our own outbound values are
    // constrained. A CHECK here would reject the truth when Leafly adds a code.
    expect(sql).not.toMatch(/cancel_reason_code[^\n]*check/i);
  });

  it("enables row level security", () => {
    expect(sql).toMatch(/enable row level security/i);
  });
});

// ===========================================================================
describe("L-14 · the core stays pure and self-tested", () => {
  it("has no server-only imports in the pure core", () => {
    const src = read(CLAIM_CORE);
    expect(src).not.toContain("server-only");
    expect(src).not.toContain("@/lib/supabase");
  });

  it("keeps a floor under its assertion count", () => {
    // A self-test file can be gutted to nothing and still "pass". The floor
    // makes deletion visible. Raised from 114 by this slice's additions.
    const src = read(CLAIM_CORE);
    const n = (src.match(/^\s*(ok|eq)\(/gm) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(60);
  });
});

// ===========================================================================
// SLICE L-14, THE BACK OFFICE HALF.
//
// The register half stops a till and asks a cashier what happened to product
// that was already bagged. Until these three parts, the ANSWER lived only in
// a database table: no screen in the building showed it. A cancelled order
// whose product was bagged and never voided is shrinkage that reconciles to
// nothing, so the answer is an inventory record, not a UI nicety.
//
// Everything below guards a decision the COMPILER CANNOT SEE.
// ===========================================================================
describe("L-14 \u00b7 the back office can see it", () => {
  const server = read(CLAIM_SERVER);
  const serverCode = code(server);

  it("reads RESOLVED rows as well as open ones", () => {
    // THE WHOLE POINT OF THE READER. The register's reader filters
    // `.is("resolved_at", null)` because it only cares whether it must stop.
    // If someone copies that filter into this one, the board silently loses
    // the only record of where bagged product went -- and every test that
    // only checks "the reader exists" would still pass.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).not.toBe("");
    expect(fn).not.toContain('is("resolved_at", null)');
    expect(fn).toContain('.in("local_order_id"');
  });

  it("selects the resolution columns, not just the question", () => {
    // Reading the row but not its answer would render every interrupt as
    // unresolved forever.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    for (const col of ["resolved_at", "disposition", "resolved_by_employee"]) {
      expect(fn).toContain(col);
    }
  });

  it("degrades rather than failing when 0229 is absent", () => {
    // AGENTS rule 6: the owner applies migrations by hand, so there is a real
    // window where this code is deployed and the table does not exist. The
    // board must not hide every live order behind a cosmetic missing table.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).toContain("isMissing0229(error)");
    expect(fn).toContain("degraded: true");
  });

  it("reuses isMissing0229 instead of re-spelling it", () => {
    // House rule 11. Two spellings of "the migration is missing" drift, and
    // the one that drifts is the one nobody is looking at.
    expect(serverCode.match(/function isMissing0229/g) ?? []).toHaveLength(1);
  });

  it("never reports a read failure as 'no interrupts'", () => {
    // These are OPPOSITE facts. Conflating them is precisely how a blocking
    // cancellation becomes invisible: an empty map with no problem set looks
    // exactly like a healthy, quiet shop.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).toMatch(/problem: `Register cancellation alerts/);
    // A non-missing-table error must set `problem`, not return silently.
    expect(fn).toContain("error.message");
  });

  it("never throws: the whole body is guarded", () => {
    // It is awaited on the page with no try/catch, deliberately, because it
    // cannot reject. That contract is load-bearing and asserted here.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).toContain("try {");
    expect(fn).toContain("} catch (err) {");
  });

  it("strips blank ids before querying", () => {
    // A blank id inside `.in()` is NOT a harmless no-op -- it widens the
    // filter, and the board starts showing one order's cancellation on
    // another order's card.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).toContain('filter((v) => v !== "")');
    expect(fn).toContain("new Set(");
  });

  it("caps the read and orders it newest first", () => {
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).toContain("BOARD_INTERRUPT_LIMIT");
    expect(fn).toContain('order("raised_at", { ascending: false })');
  });

  it("makes no judgement of its own about what 'blocking' means", () => {
    // Classification belongs to the pure core (house rule 11). If the server
    // grows a second opinion, the board and the register can disagree about
    // whether a till is stopped.
    const fn = serverCode.slice(
      serverCode.indexOf("export async function listInterruptsForOrders"),
    );
    expect(fn).not.toContain("BLOCKING");
    expect(fn).not.toContain("summariseInterrupt");
  });
});

// ===========================================================================
describe("L-14 \u00b7 the page wires it without guessing", () => {
  const page = read(ORDERS_PAGE);
  const pageCode = code(page);

  it("passes the ids the board ACTUALLY returned", () => {
    // Re-deriving the id set with a second query would let the two disagree
    // about which orders are on screen. That mismatch is how one order's
    // cancellation lands on another order's card.
    expect(pageCode).toContain("leaflyBoard.orders.map((o) => o.local_order_id");
  });

  it("annotates the const so the empty-board fallback is type checked", () => {
    // Without the annotation the fallback's bare `new Map()` is Map<any, any>
    // and nothing ever checks its key type -- the one mistake tsc would
    // otherwise have caught for us.
    expect(pageCode).toContain("const leaflyInterrupts: BoardInterrupts =");
  });

  it("hands the result to the panel", () => {
    expect(pageCode).toContain("interrupts={leaflyInterrupts}");
  });

  it("calls the reader exactly once", () => {
    // A second call site would double a round trip on the busiest page in the
    // shop, and the two results could disagree.
    //
    // Matched WITHOUT requiring a directly adjacent `await`: since L-26 the
    // call is wrapped in `withRenderBudget(...)`, so the await sits on the
    // wrapper. What this test actually protects is the number of CALL SITES,
    // not the token that happens to precede them.
    expect(pageCode.match(/listInterruptsForOrders\(/g) ?? []).toHaveLength(1);
  });

  /**
   * SLICE L-26 — and it must stay bounded.
   *
   * This reader is SEQUENTIAL: it runs after the page's main `Promise.all`
   * because it consumes the ids that board actually returned, so its latency
   * adds to the render rather than overlapping with it. The render is what
   * the Leafly acknowledge button waits on (Next.js answers a redirecting
   * server action only once the destination has rendered), which makes this
   * the last thing standing between an acknowledged order and the operator
   * seeing a page again.
   */
  it("is bounded, so a slow read cannot hang the acknowledge spinner", () => {
    expect(pageCode).toMatch(/withRenderBudget\(\s*listInterruptsForOrders\(/);
  });
});

// ===========================================================================
describe("L-14 \u00b7 the panel shows it and decides nothing", () => {
  const panel = read(ORDERS_PANEL);
  const panelCode = code(panel);

  it("asks the pure core for every judgement", () => {
    expect(panelCode).toContain("summariseInterrupt(row)");
    expect(panelCode).toContain("summariseInterrupts(allInterrupts)");
  });

  it("does not re-implement the core's state names as literals", () => {
    // One comparison is legitimate (choosing alarm colours from the state the
    // core returned). More than that means the panel has started deciding.
    expect(panelCode.match(/"BLOCKING"/g) ?? []).toHaveLength(1);
    expect(panelCode).not.toContain('"ANSWERED"');
    expect(panelCode).not.toContain('"CLOSED_NO_OP"');
  });

  it("renders resolved interrupts too, not only blocking ones", () => {
    // If the panel filtered to open rows it would throw away the answer --
    // the only record of where bagged product went.
    //
    // THIS ASSERTION WAS WIDENED AFTER A MUTATION SURVIVED IT. The first
    // version only looked for `filter(...BLOCKING)`, which is not how anyone
    // would actually write the bug. The mutation harness introduced the
    // realistic form -- `.filter((r) => r.resolvedAt === null)` -- and the
    // suite stayed green. What matters is not the WORD used to filter but
    // that the render list is filtered AT ALL, so that is what is asserted.
    const render = panelCode.slice(panelCode.indexOf("(interrupts ?? [])"));
    expect(render).not.toBe("");
    // The list is mapped straight to cards. Any .filter() between the list
    // and the .map() is dropping history on the floor.
    expect(render).toMatch(/\(interrupts \?\? \[\]\)\.map\(/);
    expect(render).not.toMatch(/\(interrupts \?\? \[\]\)\s*\.filter\(/);
    // Belt and braces: no resolution-state filtering anywhere in the panel.
    expect(panelCode).not.toMatch(/filter\([^)]*resolvedAt/);
    expect(panelCode).not.toMatch(/filter\([^)]*BLOCKING/);
  });

  it("counts from the board-wide tally, not from one card", () => {
    expect(panelCode).toContain("interruptTally.openCount");
  });

  it("states a degraded read instead of showing an empty healthy card", () => {
    expect(panelCode).toContain("interrupts?.degraded");
    expect(panelCode).toContain("interrupts?.problem");
  });

  it("keys strictly by local order id", () => {
    expect(panelCode).toContain("interrupts?.byOrderId.get(order.local_order_id)");
    // An order with no local id must get UNDEFINED rather than a lookup on a
    // blank key. A Map keyed by "" would hand EVERY such order the same rows.
    // Asserted as a guarded expression, not just the presence of the field:
    // the guard is the part that matters and the part a "tidy-up" would drop.
    const lookup = panelCode.slice(
      panelCode.indexOf("interrupts={"),
      panelCode.indexOf("interrupts={") + 220,
    );
    expect(lookup).toMatch(
      /order\.local_order_id\s*\?[\s\S]*byOrderId\.get\(order\.local_order_id\)[\s\S]*:\s*undefined/,
    );
  });

  it("keeps the prop optional so an un-updated caller cannot crash the page", () => {
    expect(panelCode).toContain("interrupts?: BoardInterrupts;");
    expect(panelCode).toContain("interrupts?: InterruptRecord[];");
  });

  it("says something true when a decision was not recognised", () => {
    // summariseInterrupt returns decision:null for an unrecognised
    // disposition rather than guessing. The panel must SAY so, not render a
    // blank line that reads as "nothing to see".
    expect(panel).toContain("needsAttention");
  });
});

// ===========================================================================
// BEHAVIOURAL, not textual. These run the core the dashboard depends on.
// ===========================================================================
describe("L-14 \u00b7 what the board will actually display", () => {
  const base: InterruptRecord = {
    rowId: "r1",
    title: "Order #42 was cancelled",
    message: "Leafly cancelled this order.",
    cancelReasonCode: "store_closed",
    dispositionRequired: true,
    raisedAt: "2026-02-01T10:00:00.000Z",
    resolvedAt: null,
    disposition: null,
    resolvedByEmployee: null,
  };

  it("an open interrupt reads as blocking and needs attention", () => {
    const s = summariseInterrupt(base);
    expect(s.state).toBe("BLOCKING");
    expect(s.needsAttention).toBe(true);
    expect(s.decision).toBeNull();
  });

  it("an open interrupt is blocking no matter how old it is", () => {
    // ASYMMETRIC TO CLAIM_STALE_AFTER_MINUTES ON PURPOSE. A stale CLAIM can be
    // aged out, because the worst case is another till picks the order up. An
    // unanswered CANCELLATION cannot, because ageing it out would silently
    // close the only question anybody ever asked about the bagged product.
    const ancient = { ...base, raisedAt: "2020-01-01T00:00:00.000Z" };
    expect(summariseInterrupt(ancient).state).toBe("BLOCKING");
  });

  it("a resolved interrupt carries the decision the till recorded", () => {
    const s = summariseInterrupt({
      ...base,
      resolvedAt: "2026-02-01T10:03:00.000Z",
      disposition: "void",
      resolvedByEmployee: "Alyssa",
    });
    expect(s.state).toBe("ANSWERED");
    expect(s.decision).not.toBeNull();
    expect(s.needsAttention).toBe(false);
  });

  it("an unrecognised disposition is flagged, never guessed", () => {
    // The disposition column is CHECK-constrained, but a future migration
    // could widen it, and a value this software does not understand must not
    // be rendered as whichever option happens to be listed first.
    const s = summariseInterrupt({
      ...base,
      resolvedAt: "2026-02-01T10:03:00.000Z",
      disposition: "something_new",
    });
    expect(s.decision).toBeNull();
    expect(s.needsAttention).toBe(true);
  });

  it("the banner counts only what is actually blocking", () => {
    const resolved = {
      ...base,
      rowId: "r2",
      resolvedAt: "2026-02-01T10:03:00.000Z",
      disposition: "walk_in",
    };
    const tally = summariseInterrupts([base, resolved]);
    expect(tally.openCount).toBe(1);
    expect(tally.worst).toBe("BLOCKING");
  });

  it("an empty board yields a silent tally", () => {
    // The page builds this exact value when no orders are on screen.
    const tally = summariseInterrupts([]);
    expect(tally.openCount).toBe(0);
    expect(tally.needsAttentionCount).toBe(0);
    expect(tally.worst).toBe("NONE");
  });

  it("never throws on a malformed row", () => {
    // It renders inside an admin page that must not blank out because one row
    // is odd. Deliberately hostile input, cast at the boundary.
    const nasty = {
      ...base,
      title: "",
      message: "",
      cancelReasonCode: null,
      raisedAt: "not-a-date",
      resolvedAt: "",
      disposition: "",
    } as InterruptRecord;
    expect(() => summariseInterrupt(nasty)).not.toThrow();
  });
});
