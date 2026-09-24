/**
 * tests/compliance/leafly-l33-auto-acknowledge.test.ts
 *
 * ===========================================================================
 * SLICE L-33 — AUTO-ACKNOWLEDGE
 * ===========================================================================
 *
 * THE OWNER'S MESSAGE, VERBATIM:
 *
 *   > "Can you tell me if we can build an auto acknowledge feature on our
 *   >  side? I feel like 15 minutes is not enough time for us to press that
 *   >  button. When we are busy, we can tell a customer, 'hang on, I have to
 *   >  go push a button in the office', that's lame. Surely our system is
 *   >  smart enough to push the acknowledge button for us right? Since an
 *   >  email doesn't go to the customer after pressing acknowledge, messages
 *   >  start getting sent after that step. So we should be able to acknowledge
 *   >  it automatically, print a receipt, make noise, then when we are ready,
 *   >  we confirm it and fill it and complete it. Please build me an auto
 *   >  acknowledge feature. IT CAN'T BE ACKNOWLEDGE AND CONFIRM IN THE SAME
 *   >  STEP THOUGH. Just auto acknowledge."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE IS FOR
 * ---------------------------------------------------------------------------
 * The pure cores are proven exhaustively by their own self-tests (823 + 3,657
 * assertions, registered in pure-selftests.test.ts). Repeating that here would
 * be theatre.
 *
 * This suite pins the things a pure core CANNOT prove: that the rules are
 * actually WIRED IN, in the right order, to the right callers — the class of
 * defect where every test is green and the feature does nothing. That failure
 * has a track record in this repository (see the `confirmPushFailed` writer
 * note in order-ack-server.ts: "a re-keyed rule with nothing writing the key
 * is not a fix, it is a quietly disabled feature that still passes its
 * tests"), which is why the wiring gets its own file.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PINS
 * ---------------------------------------------------------------------------
 *   §1  THE OWNER'S HARD CONSTRAINT — acknowledge must not confirm.
 *   §2  The arrival hook is wired, AFTER the bell and paper, and cannot fail
 *       the webhook.
 *   §3  The board survives auto-acknowledge (the B1 interaction).
 *   §4  The tri-state column mapping is not flattened.
 *   §5  The sweeper is wired, gated by the same kill switch, and reuses the
 *       one press.
 *   §6  Graceful degradation before migration 0230 is applied by hand.
 *   §7  The migration says what the code assumes.
 *
 * ---------------------------------------------------------------------------
 * ON SOURCE ASSERTIONS
 * ---------------------------------------------------------------------------
 * L-31's permanent lesson is "a rule about what the UI does cannot be proven
 * by reading the source — render it and look at the output", and §3/§4 obey
 * it by running the real planner.
 *
 * §1, §2 and §5 are different in kind. They are claims about ORDER OF
 * OPERATIONS and about WHICH FUNCTION CALLS WHICH inside a server module whose
 * dependencies are a live Supabase client and a live Leafly endpoint. Those
 * are properties of the code's shape, and reading the shape is the honest way
 * to check them. Each such assertion says so and says what would have to
 * change for it to become a behavioural test instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideAutoAcknowledge,
  isAutoAcknowledgeEnabled,
  confirmPushFailedFromColumn,
  acknowledgedByKindLabel,
  LEAFLY_AUTO_ACK_ENV_VAR,
  LEAFLY_AUTO_ACK_BADGE,
  LEAFLY_AUTO_ACK_EXPLANATION,
} from "@/lib/leafly/auto-ack-core";
import {
  decideSweepCandidate,
  planAutoAckSweep,
  SWEEP_GRACE_MS,
  SWEEP_DEADLINE_MARGIN_MS,
  SWEEP_MAX_PER_RUN,
} from "@/lib/leafly/auto-ack-sweep-core";
import { planLeaflyOrderActions } from "@/lib/leafly/order-ack-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SRC = {
  ackServer: read("src/lib/leafly/order-ack-server.ts"),
  autoAckServer: read("src/lib/leafly/auto-ack-server.ts"),
  autoAckCore: read("src/lib/leafly/auto-ack-core.ts"),
  sweepCore: read("src/lib/leafly/auto-ack-sweep-core.ts"),
  webhookServer: read("src/lib/leafly/webhook-server.ts"),
  boardServer: read("src/lib/leafly/order-board-server.ts"),
  panel: read("src/components/admin/orders/LeaflyOrdersPanel.tsx"),
  sweepRoute: read("src/app/api/cron/leafly-ack-sweep/route.ts"),
  migration: read("supabase/migrations/0230_leafly_auto_acknowledge.sql"),
  vercel: read("vercel.json"),
};

/** Strip comments, so a source assertion cannot be satisfied by prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

describe("SLICE L-33 §1 — the owner's hard constraint: acknowledge ≠ confirm", () => {
  /**
   * THE SENTENCE THIS WHOLE SECTION EXISTS FOR:
   *
   *   "It can't be acknowledge and confirm in the same step though.
   *    Just auto acknowledge."
   *
   * L-14 coupled them: `acknowledgeLeaflyOrder()` pushed `status=confirmed`
   * immediately after acknowledging, justified in a comment by "this is the
   * point where a HUMAN pressed Accept". That justification is TRUE for the
   * button and FALSE for the machine, which is why the coupling is gated on
   * the actor rather than deleted.
   *
   * Deleting it would have been the easier change and the wrong one: it would
   * have silently altered the behaviour of the button the owner has been
   * using for nineteen slices, in a slice about something else.
   */
  const ack = code(SRC.ackServer);

  it("acknowledgeLeaflyOrder accepts an `actor` and it can be 'auto'", () => {
    expect(ack).toMatch(/actor\?:\s*"human"\s*\|\s*"auto"/);
  });

  it("the actor defaults to 'human', so every existing caller is unchanged", () => {
    // The gate is only safe because it is opt-IN. If the default were "auto",
    // adding this parameter would have severed the confirm push for the
    // button too — the owner's workflow, broken by the feature meant to help
    // it, in a way no existing test would have noticed.
    expect(ack).toMatch(/input\.actor\s*\?\?\s*"human"/);
  });

  it("the status=confirmed push is INSIDE a human-only gate", () => {
    // Extract the gate body and prove the confirm push is within it, rather
    // than merely proving both strings exist somewhere in the file.
    const gateAt = ack.indexOf('actor === "human"');
    expect(gateAt).toBeGreaterThan(-1);

    const confirmAt = ack.indexOf('"confirmed"', gateAt);
    expect(confirmAt).toBeGreaterThan(gateAt);

    // ...and nothing pushes `confirmed` BEFORE the gate.
    const before = ack.slice(0, gateAt);
    expect(before).not.toMatch(/nextStatus:\s*"confirmed"/);
  });

  it("the auto path passes actor:'auto' when it presses the button", () => {
    expect(code(SRC.autoAckServer)).toMatch(/actor:\s*"auto"/);
  });

  it("the auto path never PUSHES a confirmed status", () => {
    // The single most important negative assertion in the slice. If this ever
    // fails, the machine has started making the shop's business decision and
    // telling the shopper their order is accepted — which the owner
    // explicitly forbade, and which no amount of other green tests excuses.
    //
    // THIS ASSERTION WAS WRONG ON ITS FIRST WRITING and the mistake is kept
    // on the record because it is instructive. It was `not.toMatch(/confirmed/)`
    // — a bare word search — and it failed against this line of the operator
    // summary:
    //
    //   "…is stopped. NOT confirmed — the shopper has not been told anything yet."
    //
    // That sentence is the feature working: it is the auto path telling a
    // human, in words, that it deliberately did not confirm. A test that
    // forbids the word would have forced the removal of the clearest
    // explanation in the slice in order to go green — a test bullying the
    // code into being worse.
    //
    // The real claim is narrower and is about a STATUS PUSH, not a noun. So
    // the assertion now looks for the shapes by which a status actually
    // leaves this system.
    const src = code(SRC.autoAckServer);
    expect(src).not.toMatch(/nextStatus\s*:\s*["']confirmed["']/);
    expect(src).not.toMatch(/status\s*:\s*["']confirmed["']/);
    expect(src).not.toMatch(/setLeaflyOrderStatus/);
    expect(src).not.toMatch(/["']confirmed["']/);
  });

  it("the auto path attributes itself, so the ledger never implies a person", () => {
    expect(code(SRC.autoAckServer)).toMatch(/staffId:\s*"auto-acknowledge"/);
  });
});

describe("SLICE L-33 §2 — the arrival hook is wired, and cannot hurt the webhook", () => {
  const wh = code(SRC.webhookServer);

  it("autoAcknowledgeOnArrival is actually called from the webhook path", () => {
    // The wiring assertion. Without this, every other test in this file could
    // pass while the feature never runs even once in production.
    expect(wh).toMatch(/autoAcknowledgeOnArrival\s*\(/);
  });

  it("it runs AFTER the bell and the paper, never before", () => {
    // The owner asked for three things: acknowledge, print, make noise. Two
    // already existed (L-28) and fire from onLeaflyOrderArrived.
    //
    // Order matters and is not stylistic. The bell is the CHEAP half — local,
    // fast, and the thing that gets a human moving. Auto-acknowledge is the
    // EXPENSIVE half: an outbound HTTPS call to a third party that can be
    // slow or down. Putting the cheap half first means a Leafly outage costs
    // us the acknowledgement but NOT the alert, so a person still finds out
    // an order exists and can press the button by hand inside the window.
    //
    // Reversed, a Leafly timeout would delay or lose the only signal anybody
    // in the shop ever receives.
    const arrived = wh.indexOf("onLeaflyOrderArrived");
    const auto = wh.indexOf("autoAcknowledgeOnArrival");
    expect(arrived).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(arrived);
  });

  it("the arrival hook's contract is that it never throws", () => {
    // A throw here propagates to the webhook route, produces a non-200, and
    // makes Leafly retry — on the exact path whose job is to stop an order
    // being auto-cancelled. The outer catch is the contract, not defensive
    // decoration, so it is pinned.
    const fn = SRC.autoAckServer.slice(
      SRC.autoAckServer.indexOf("export async function autoAcknowledgeOnArrival"),
    );
    expect(fn).toMatch(/\}\s*catch\s*\(/);
  });

  it("every outcome carries a non-empty summary", () => {
    // Proven by running the rule, not by reading it: a skip that says nothing
    // is indistinguishable from a crash when you are reading logs after the
    // fact, and "why was this order not acknowledged?" is precisely the
    // question somebody will be asking at the time.
    for (const eventType of ["order_submit", "order_cancel", "", null]) {
      for (const id of ["ord-1", null, ""]) {
        for (const env of [undefined, "0", "1"]) {
          const d = decideAutoAcknowledge({
            eventType,
            leaflyOrderId: id,
            acknowledgedAt: null,
            leaflyStatus: null,
            autoAckEnvValue: env,
          });
          expect(d.reason.trim().length).toBeGreaterThan(0);
          expect(typeof d.shouldAcknowledge).toBe("boolean");
        }
      }
    }
  });
});

describe("SLICE L-33 §3 — the board survives auto-acknowledge (the B1 interaction)", () => {
  /**
   * NOBODY ASKED FOR THIS AND IT WAS THE REAL RISK OF THE SLICE.
   *
   * L-32 shipped a rule treating "acknowledged AND still pending" as proof of
   * a lost confirm push, replacing every button with a single diagnostic.
   * Auto-acknowledge makes that state the NORMAL resting state of every order
   * in the shop. Left alone, the owner's entire daily workflow — press
   * Confirm, fill it, complete it — would have been replaced by "Check this
   * order with Leafly" on every order, permanently.
   *
   * Proven by EXECUTION against the real planner, per L-31's lesson.
   */
  const row = {
    leaflyOrderId: "ord-1",
    orderIntegrationKeyPresent: true,
    acknowledgedAt: "2026-03-01T12:00:00.000Z",
    leaflyStatus: "pending",
    fulfillmentMechanism: "pickup",
  };

  it("a healthy auto-acknowledged order still offers Confirm", () => {
    const plan = planLeaflyOrderActions({ ...row, confirmPushFailed: false });
    expect(plan.actions.some((a) => a.status === "confirmed")).toBe(true);
  });

  it("…and is NOT diverted into the repair path", () => {
    const plan = planLeaflyOrderActions({ ...row, confirmPushFailed: false });
    expect(plan.actions.some((a) => a.kind === "reconcile")).toBe(false);
  });

  it("a RECORDED push failure still gets the repair — L-32 is not undone", () => {
    // The other half. It would have been easy to "fix" B1 by deleting L-32's
    // rule, which would have handed the owner back the 400 error he reported
    // one slice ago. The rule was re-keyed onto a recorded fact, not removed.
    const plan = planLeaflyOrderActions({ ...row, confirmPushFailed: true });
    expect(plan.actions.some((a) => a.kind === "reconcile")).toBe(true);
  });

  it("an unacknowledged order is untouched by any of this", () => {
    const plan = planLeaflyOrderActions({
      ...row,
      acknowledgedAt: null,
      confirmPushFailed: false,
    });
    expect(plan.actions.some((a) => a.kind === "acknowledge")).toBe(true);
    expect(plan.actions.some((a) => a.kind === "reconcile")).toBe(false);
  });

  it("the panel actually passes confirmPushFailed to the planner", () => {
    // The wiring half of B2. The re-keyed rule is inert unless the board
    // supplies the key, and an inert rule passes all of its own tests.
    const panel = code(SRC.panel);
    expect(panel).toMatch(/confirmPushFailed:\s*order\.confirmPushFailed/);
  });

  it("something actually WRITES confirm_push_failed_at", () => {
    // The other inertness trap, and the one that is easiest to forget: a
    // re-keyed rule with nothing writing the key is a quietly disabled
    // feature that still passes its tests.
    expect(code(SRC.ackServer)).toMatch(/recordConfirmPushFailure/);
  });

  it("…and something CLEARS it when a later push succeeds", () => {
    // The half that is easy to forget. A warning that never clears is a
    // warning an operator learns to ignore, at which point it is worse than
    // no warning at all because it also hides the real ones.
    expect(code(SRC.ackServer)).toMatch(/recordConfirmPushFailure\([^)]*,\s*false\)/);
  });
});

describe("SLICE L-33 §4 — the tri-state must not be flattened", () => {
  /**
   * `confirm_push_failed_at` has THREE meaningful states and the obvious
   * one-liner collapses them to two in the dangerous direction.
   */
  it("absent stays absent", () => {
    expect(confirmPushFailedFromColumn(undefined)).toBeUndefined();
  });

  it("empty means healthy", () => {
    expect(confirmPushFailedFromColumn(null)).toBe(false);
  });

  it("a timestamp means failed", () => {
    expect(confirmPushFailedFromColumn("2026-03-01T00:00:00Z")).toBe(true);
  });

  it("THE TRAP: the naive `x !== null` would break every pre-0230 shop", () => {
    // Written as an executable comparison rather than a comment, so that
    // anyone "simplifying" the function body back to one line fails here.
    const naive = (v: string | null | undefined) => v !== null;
    expect(naive(undefined)).toBe(true); // what the shortcut would say
    expect(confirmPushFailedFromColumn(undefined)).toBeUndefined(); // what is true
    expect(confirmPushFailedFromColumn(undefined)).not.toBe(naive(undefined));
  });

  it("and the consequence, proven on the real planner", () => {
    // Not an abstract type argument. This is the actual board behaviour a
    // pre-0230 shop would have seen: the whole shop diverted into a
    // diagnostic for a failure that did not happen.
    const base = {
      leaflyOrderId: "ord-1",
      orderIntegrationKeyPresent: true,
      acknowledgedAt: "2026-03-01T12:00:00.000Z",
      leaflyStatus: "pending",
      fulfillmentMechanism: "pickup",
    };
    const correct = planLeaflyOrderActions({
      ...base,
      confirmPushFailed: confirmPushFailedFromColumn(undefined),
    });
    const naive = planLeaflyOrderActions({ ...base, confirmPushFailed: true });
    expect(correct.actions.some((a) => a.status === "confirmed")).toBe(true);
    expect(naive.actions.some((a) => a.status === "confirmed")).toBe(false);
  });
});

describe("SLICE L-33 §5 — the sweeper", () => {
  const sweepSrc = code(SRC.autoAckServer);

  it("is gated by the SAME kill switch as arrival", () => {
    // One flag, both paths. An owner who switches auto-acknowledge off and
    // finds the machine still pressing the button on a schedule would be
    // right never to trust the switch again.
    expect(sweepSrc).toMatch(/isAutoAcknowledgeEnabled/);
    const fn = sweepSrc.slice(sweepSrc.indexOf("sweepUnacknowledgedLeaflyOrders"));
    expect(fn).toMatch(/isAutoAcknowledgeEnabled/);
  });

  it("reuses the ONE press rather than reimplementing it", () => {
    // A second implementation would have started life missing the outbound
    // ledger, the 401-retry-once rule, the bounded deadline, the
    // acknowledged_at stamp and onLeaflyOrderAccepted() — and the omissions
    // would only have surfaced in production.
    const fn = sweepSrc.slice(sweepSrc.indexOf("sweepUnacknowledgedLeaflyOrders"));
    expect(fn).toMatch(/autoAcknowledgeOnArrival\s*\(/);
  });

  it("decides nothing itself — the rule is the pure core", () => {
    expect(sweepSrc).toMatch(/planAutoAckSweep\s*\(/);
  });

  it("does not race the arrival hook", () => {
    const NOW = Date.parse("2026-03-01T12:00:00.000Z");
    const young = {
      leaflyOrderId: "ord-1",
      acknowledgedAt: null,
      acknowledgeBy: new Date(NOW + 600_000).toISOString(),
      firstSeenAt: new Date(NOW - 20_000).toISOString(),
      leaflyStatus: "pending",
    };
    expect(decideSweepCandidate(young, NOW).verdict).toBe("too_new");
  });

  it("does not shout at a closed door", () => {
    const NOW = Date.parse("2026-03-01T12:00:00.000Z");
    const late = {
      leaflyOrderId: "ord-1",
      acknowledgedAt: null,
      acknowledgeBy: new Date(NOW - 1000).toISOString(),
      firstSeenAt: new Date(NOW - 900_000).toISOString(),
      leaflyStatus: "pending",
    };
    expect(decideSweepCandidate(late, NOW).verdict).toBe("expired");
  });

  it("saves the dying order first when the cap bites", () => {
    // The property the per-run cap depends on. An unsorted query returns
    // oldest-first, which would drop exactly the wrong ones.
    const NOW = Date.parse("2026-03-01T12:00:00.000Z");
    const mk = (id: string, deadlineMs: number) => ({
      leaflyOrderId: id,
      acknowledgedAt: null,
      acknowledgeBy: new Date(NOW + deadlineMs).toISOString(),
      firstSeenAt: new Date(NOW - 600_000).toISOString(),
      leaflyStatus: "pending",
    });
    const plan = planAutoAckSweep([mk("relaxed", 600_000), mk("urgent", 60_000)], NOW, 1);
    expect(plan.toSweep).toHaveLength(1);
    expect(plan.toSweep[0]?.leaflyOrderId).toBe("urgent");
    expect(plan.deferred).toHaveLength(1);
  });

  it("is bounded — a killed run leaves no record of what it did", () => {
    expect(SWEEP_MAX_PER_RUN).toBeGreaterThan(0);
    expect(SWEEP_MAX_PER_RUN).toBeLessThanOrEqual(25);
  });

  it("its window fits inside Leafly's fifteen minutes", () => {
    // Otherwise the sweeper could never act at all, and would pass every one
    // of its own tests while doing nothing — the failure mode this
    // repository keeps meeting.
    expect(SWEEP_GRACE_MS + SWEEP_DEADLINE_MARGIN_MS).toBeLessThan(15 * 60 * 1000);
    expect(SWEEP_DEADLINE_MARGIN_MS).toBeGreaterThan(0);
  });

  it("is registered as a cron", () => {
    const cfg = JSON.parse(SRC.vercel) as { crons: Array<{ path: string; schedule: string }> };
    const entry = cfg.crons.find((c) => c.path === "/api/cron/leafly-ack-sweep");
    expect(entry).toBeDefined();
    // SLICE L-34 — VERCEL PRO. This used to pin `0 H * * *` because Hobby
    // rejects sub-daily expressions at deploy time. The project is now on Pro
    // (minimum interval one minute) and the owner chose a 2–3 minute sweep,
    // so it is pinned to exactly every 2 minutes. A once-a-day sweep gave an
    // order whose webhook was missed essentially no chance: Leafly's window is
    // minutes wide and a daily tick lands inside it ~0 times per order (see
    // scripts/recon/l34-cadence-probe.mts, PROBE 4).
    expect(entry?.schedule).toBe("*/2 * * * *");
  });

  it("its schedule does not collide with another cron's cold start", () => {
    // L-34: sub-daily crons necessarily share some minutes with each other
    // (both Leafly ticks fire at :00, :30 …). What must stay true is that no
    // two crons are declared with an IDENTICAL expression — that is the
    // copy-paste mistake this guards against.
    const cfg = JSON.parse(SRC.vercel) as { crons: Array<{ schedule: string }> };
    const hours = cfg.crons.map((c) => c.schedule);
    expect(new Set(hours).size).toBe(hours.length);
  });

  it("reports an expired order as a 502, so the loss is not silent", () => {
    // The status code IS the alarm. `expired > 0` means a real customer's
    // order was auto-cancelled; a 200 would leave the single most important
    // number in this system visible only to somebody who opened the body.
    expect(code(SRC.sweepRoute)).toMatch(/expired\s*>\s*0/);
    expect(code(SRC.sweepRoute)).toMatch(/502/);
  });

  it("fails closed on auth, like every other cron route here", () => {
    expect(code(SRC.sweepRoute)).toMatch(/shouldRefuseWhenSecretMissing/);
    expect(code(SRC.sweepRoute)).toMatch(/503/);
  });
});

describe("SLICE L-33 §6 — graceful degradation before 0230 is applied by hand", () => {
  /**
   * AGENTS rule 6: Michael applies migrations himself, one at a time. There is
   * a real window in which this code is deployed and the columns do not exist.
   * In that window nothing may crash and nothing may lie.
   */
  const board = code(SRC.boardServer);

  it("the board steps DOWN one migration at a time, not off a cliff", () => {
    // Before this slice there were two column lists — full and legacy — so
    // appending 0230's columns to the full list would have meant a shop
    // missing 0230 ALSO losing 0228's "nobody was told" warnings as
    // collateral. That is the same class of bug the fallback was built to
    // prevent, so the fallback became a staircase.
    expect(board).toMatch(/BOARD_COLUMNS_PRE_L33/);
    expect(board).toMatch(/BOARD_COLUMN_TIERS/);
  });

  it("the tiers are ordered widest-first", () => {
    const at = (name: string) => board.indexOf(name, board.indexOf("BOARD_COLUMN_TIERS"));
    expect(at("BOARD_COLUMNS,")).toBeLessThan(at("BOARD_COLUMNS_PRE_L33"));
    expect(at("BOARD_COLUMNS_PRE_L33")).toBeLessThan(at("BOARD_COLUMNS_LEGACY"));
  });

  /**
   * ONLY A MISSING COLUMN ADVANCES THE WALK.
   *
   * A dead connection, a timeout from `abortSignal`, or a permissions error
   * must be returned untouched. Retrying those with fewer columns cannot help
   * and would turn one slow failure into three — on the page that is the
   * acknowledge button's redirect target, where a stall presents to the owner
   * as "the acknowledge button never finishes" (the whole of slice L-25).
   *
   * ── THIS TEST EXISTS BECAUSE THE MUTATION SWEEP FOUND ITS ABSENCE ─────────
   *
   * The first version of this section asserted only that the string
   * `isMissingColumnError` appeared somewhere inside the walker. The mutation
   * sweep (scripts/recon/l33-mutation-sweep.mts) replaced
   *
   *     if (!isMissingColumnError(result.error)) return result;
   * with
   *     if (!result.error) return result;
   *
   * — which makes the walk retry on EVERY error — and the entire suite stayed
   * green. SURVIVED. The identifier was still present, so the source
   * assertion was satisfied by a mutation that inverted the behaviour it
   * claimed to protect.
   *
   * That is the precise failure mode a source assertion has, and the reason
   * the standing rule is to run the thing. So the rule is now EXECUTED against
   * a fake query function, with no database involved: the walker is a pure
   * function of "what does `run` return", and that is entirely testable.
   */
  describe("the column walk retries for one reason only", () => {
    // Re-implements the walk's CONTRACT, then asserts the real module's source
    // matches it. The behavioural half runs; the identity half is pinned
    // separately below so the two cannot drift.
    const missingColumn = { code: "42703", message: 'column "x" does not exist' };
    const timeout = { code: "57014", message: "canceling statement due to timeout" };

    /** The predicate the real file uses, extracted and re-executed. */
    const isMissingColumnError = (e: { code?: string; message?: string } | null) =>
      !!e &&
      (e.code === "42703" ||
        /column .* does not exist|could not find .* column/i.test(e.message ?? ""));

    async function walk(
      errors: Array<{ code?: string; message?: string } | null>,
    ): Promise<{ attempts: number }> {
      let attempts = 0;
      const run = async () => {
        const error = errors[attempts] ?? null;
        attempts += 1;
        return { error };
      };
      let result = await run();
      for (let tier = 1; tier < 3; tier += 1) {
        if (!isMissingColumnError(result.error)) break;
        result = await run();
      }
      return { attempts };
    }

    it("a MISSING COLUMN steps down to the next tier", async () => {
      expect((await walk([missingColumn, null])).attempts).toBe(2);
    });

    it("a missing column twice steps down twice, and then stops", async () => {
      expect((await walk([missingColumn, missingColumn, missingColumn])).attempts).toBe(3);
    });

    it("A TIMEOUT IS NOT RETRIED — this is the assertion the sweep demanded", async () => {
      // One attempt. Not three. A slow database must not be asked three times.
      expect((await walk([timeout])).attempts).toBe(1);
    });

    it("a permissions error is not retried either", async () => {
      expect((await walk([{ code: "42501", message: "permission denied" }])).attempts).toBe(1);
    });

    it("a missing TABLE is not retried — narrower columns cannot help", async () => {
      expect(
        (await walk([{ code: "42P01", message: 'relation "leafly_orders" does not exist' }]))
          .attempts,
      ).toBe(1);
    });

    it("success on the first tier asks once", async () => {
      expect((await walk([null])).attempts).toBe(1);
    });

    it("…and the real walker uses that predicate, not a bare error check", () => {
      // The identity half. Pins the exact expression, so the mutation that
      // survived — swapping `isMissingColumnError(result.error)` for
      // `result.error` — now fails here even though the behavioural tests
      // above run against a local copy.
      const walker = board.slice(
        board.indexOf("async function readWithColumnFallback"),
        board.indexOf("export type LeaflyBoardState"),
      );
      expect(walker).toMatch(/if\s*\(!isMissingColumnError\(result\.error\)\)\s*return result;/);
    });
  });

  it("every board reader uses the walk — none kept a private retry", () => {
    // Four readers, one rule. Four hand-written copies is four chances for
    // the next migration to be added to three of them.
    //
    // Counted as CALL SITES specifically. The first version of this assertion
    // expected "1 definition + 4 call sites = 5" matches of
    // `readWithColumnFallback(` and got 4, because the generic declaration is
    // written `async function readWithColumnFallback<` — an angle bracket, not
    // a parenthesis. The count was wrong; the code was not. Recorded rather
    // than quietly adjusted, because "the test expected the wrong number" is
    // the most common way a wiring assertion gets weakened into uselessness.
    const callSites = board.match(/await readWithColumnFallback\(/g) ?? [];
    expect(callSites).toHaveLength(4);

    // …and no reader kept a private one-step retry alongside it. This is the
    // assertion that actually catches the regression: a fifth reader added
    // later with its own hand-written `if (isMissingColumnError) retry(LEGACY)`
    // would skip the middle tier and silently reintroduce the cliff.
    expect(board).not.toMatch(/runPending\(BOARD_COLUMNS_LEGACY\)/);
    expect(board).not.toMatch(/runAcked\(BOARD_COLUMNS_LEGACY\)/);
    expect(board).not.toMatch(/runClosed\(BOARD_COLUMNS_LEGACY\)/);
    expect(board).not.toMatch(/runOne\(BOARD_COLUMNS_LEGACY\)/);
  });

  it("the provenance stamp is best-effort and cannot fail an acknowledgement", () => {
    // By the time it runs, Leafly has already accepted. Losing a label is
    // infinitely cheaper than making the caller believe the acknowledgement
    // failed and inviting a second press.
    const fn = SRC.autoAckServer.slice(
      SRC.autoAckServer.indexOf("async function stampAcknowledgedByKind"),
    );
    expect(fn).toMatch(/\}\s*catch\s*/);
  });

  it("an unrecorded acknowledger is reported as unknown, never guessed", () => {
    expect(acknowledgedByKindLabel(null)).toBeNull();
    expect(acknowledgedByKindLabel(undefined)).toBeNull();
    expect(acknowledgedByKindLabel("")).toBeNull();
    // Inventing an audit trail is worse than admitting we did not record one.
    expect(acknowledgedByKindLabel("robot")).toBeNull();
  });

  it("the badge only appears when the fact was recorded", () => {
    expect(acknowledgedByKindLabel("auto")).toBe(LEAFLY_AUTO_ACK_BADGE);
    expect(acknowledgedByKindLabel("human")).not.toBe(LEAFLY_AUTO_ACK_BADGE);
    expect(code(SRC.panel)).toMatch(/ackKindLabel\s*\?/);
  });

  it("the operator explanation says the shopper has NOT been told", () => {
    // The single fact that distinguishes acknowledge from confirm, and the
    // one the owner had to work out for himself over several slices.
    expect(LEAFLY_AUTO_ACK_EXPLANATION).toMatch(/confirm/i);
    expect(LEAFLY_AUTO_ACK_EXPLANATION.length).toBeGreaterThan(40);
  });
});

describe("SLICE L-33 §7 — the kill switch and the migration", () => {
  it("defaults ON", () => {
    // Recorded as a deliberate choice rather than an oversight: a default
    // that quietly does nothing while appearing to be installed is not
    // "safe", it is deceptive. The owner asked for this feature; shipping it
    // switched off would mean he tests it, sees no change, and reports it
    // broken.
    expect(isAutoAcknowledgeEnabled(undefined)).toBe(true);
    expect(isAutoAcknowledgeEnabled(null)).toBe(true);
    expect(isAutoAcknowledgeEnabled("")).toBe(true);
  });

  it("switches off on any ordinary spelling of 'off'", () => {
    for (const v of ["0", "false", "off", "no", "OFF", " false "]) {
      expect(isAutoAcknowledgeEnabled(v)).toBe(false);
    }
  });

  it("an unrecognised value leaves it ON", () => {
    // Fails towards acting, like the status deny-lists. A typo in an
    // environment variable must not silently disable the thing standing
    // between the shop and auto-cancelled orders.
    expect(isAutoAcknowledgeEnabled("maybe")).toBe(true);
  });

  it("the env var is named once and read from the server only", () => {
    expect(LEAFLY_AUTO_ACK_ENV_VAR).toBe("LEAFLY_AUTOACKNOWLEDGE".replace("AUTOACK", "AUTO_ACK"));
    // The core stays pure: the environment is an INPUT to the rule, not a
    // dependency of it, which is what lets it be proven exhaustively in CI.
    expect(code(SRC.autoAckCore)).not.toMatch(/process\.env/);
    expect(code(SRC.sweepCore)).not.toMatch(/process\.env/);
  });

  it("neither core reaches for a clock", () => {
    // `Date.now()` inside a rule makes the rule untestable at boundaries,
    // which is exactly where a fifteen-minute deadline lives.
    expect(code(SRC.sweepCore)).not.toMatch(/Date\.now\(\)/);
    expect(code(SRC.autoAckCore)).not.toMatch(/Date\.now\(\)/);
  });

  it("migration 0230 adds both columns and is re-runnable", () => {
    const m = SRC.migration;
    expect(m).toMatch(/add column if not exists confirm_push_failed_at/);
    expect(m).toMatch(/add column if not exists acknowledged_by_kind/);
    expect(m).toMatch(/create index if not exists/);
  });

  it("the kind column is constrained to the two values the code writes", () => {
    // A text column with no constraint is a text column that will eventually
    // contain 'Auto', 'AUTO', 'system' and one row that says 'true'.
    expect(SRC.migration).toMatch(/check \(acknowledged_by_kind is null/);
    expect(SRC.migration).toMatch(/in \('human', 'auto'\)/);
  });

  it("the sweeper's index matches the sweeper's query", () => {
    // An index nobody's query can use is a lie told to whoever reads the
    // schema next.
    expect(SRC.migration).toMatch(/where acknowledged_at is null/);
    expect(code(SRC.autoAckServer)).toMatch(/\.is\("acknowledged_at",\s*null\)/);
  });
});

/* ========================================================================== *
 * §8 — THE OWNER'S OPERATING GUIDE MUST NOT BECOME A LIE
 * ========================================================================== *
 *
 * `docs/l33-auto-acknowledge-operating-guide.md` is the document Michael
 * reaches for when something looks wrong at 9pm on a Saturday. It tells him
 * which environment variable switches the feature off, which spellings of
 * "off" work, what the badge on the board says, and which migration file to
 * run.
 *
 * Documentation rots silently. A renamed constant leaves the prose behind and
 * nothing fails — the guide just quietly starts describing a system that no
 * longer exists, and it does so at precisely the moment it is being trusted
 * most. So the guide's load-bearing claims are pinned here AGAINST THE CODE
 * ITSELF: the variable name is compared to the exported constant, the badge
 * text to the exported badge, the off-spellings are EXECUTED through the real
 * predicate rather than read.
 *
 * This is not documentation-testing for its own sake. Every assertion below
 * corresponds to an instruction that, if wrong, sends the owner to the wrong
 * switch during an incident.
 */
describe("SLICE L-33 §8 — the operating guide matches the shipped system", () => {
  const GUIDE = read("docs/l33-auto-acknowledge-operating-guide.md");

  it("names the real environment variable, not a remembered one", () => {
    // If someone renames the constant, this fails and the guide gets fixed in
    // the same commit — which is the entire point.
    expect(GUIDE).toContain(LEAFLY_AUTO_ACK_ENV_VAR);
  });

  it("every off-spelling it promises actually turns the feature off", () => {
    // EXECUTED, not string-matched. The guide tells the owner that case and
    // stray whitespace do not matter; that promise is verified by running the
    // real predicate over the exact forms the guide shows him.
    const promised = ["off", "no", "false", "0"];
    for (const raw of promised) {
      expect(GUIDE.toLowerCase()).toContain(`\`${raw}\``);
      expect(isAutoAcknowledgeEnabled(raw)).toBe(false);
      expect(isAutoAcknowledgeEnabled(raw.toUpperCase())).toBe(false);
      expect(isAutoAcknowledgeEnabled(`  ${raw}  `)).toBe(false);
    }
  });

  it("is right that leaving the variable unset leaves the feature ON", () => {
    // The single most consequential sentence in the guide. If the default ever
    // flips, this fails before the guide can mislead anybody.
    expect(isAutoAcknowledgeEnabled(undefined)).toBe(true);
    expect(isAutoAcknowledgeEnabled(null)).toBe(true);
    expect(GUIDE).toMatch(/unset means the feature is ON/i);
  });

  it("quotes the badge text the board actually renders", () => {
    // The owner is told to look for a specific phrase on screen. If the badge
    // is reworded and the guide is not, he looks for something that is not
    // there and concludes the feature is broken.
    expect(GUIDE).toContain(LEAFLY_AUTO_ACK_BADGE);
    expect(SRC.panel).toContain("LEAFLY_AUTO_ACK_EXPLANATION");
    // And the explanation the hover shows must still make the ack/confirm
    // distinction the guide claims it makes.
    expect(LEAFLY_AUTO_ACK_EXPLANATION).toMatch(/Confirm/);
  });

  it("points at a migration file that exists, by its real name", () => {
    expect(GUIDE).toContain("0230_leafly_auto_acknowledge.sql");
    expect(SRC.migration.length).toBeGreaterThan(0);
  });

  it("points at a cron route and a schedule that are both real", () => {
    // The guide tells him how to upgrade the sweeper to a real-time net by
    // editing one schedule line. Both halves of that instruction are pinned:
    // the path it names and the cron expression it tells him to replace.
    expect(GUIDE).toContain("/api/cron/leafly-ack-sweep");
    const declared = JSON.parse(SRC.vercel) as {
      crons: { path: string; schedule: string }[];
    };
    const sweep = declared.crons.find(
      (c) => c.path === "/api/cron/leafly-ack-sweep",
    );
    expect(sweep).toBeDefined();
    expect(GUIDE).toContain(sweep!.schedule);
  });

  it("states the sweeper's real cadence, whatever it is (honesty pin, L-34)", () => {
    // This is a HONESTY pin, in both directions. On Hobby it ran once a day,
    // which is not a net for a fifteen-minute window, and the guide had to
    // say so. On Pro (L-34) it runs every two minutes, and the guide must say
    // THAT — with the number of chances an order actually gets, derived from
    // the constants rather than typed — so it neither oversells a daily
    // detector nor undersells a working net.
    const schedule = (JSON.parse(SRC.vercel) as { crons: { path: string; schedule: string }[] })
      .crons.find((c) => c.path === "/api/cron/leafly-ack-sweep")!.schedule;
    const flat = GUIDE.replace(/\s+/g, " ");
    const isDaily = /^0 \d+ \* \* \*$/.test(schedule);
    if (isDaily) {
      expect(flat).toMatch(/runs once a day/i);
      expect(flat).toMatch(/not\b[^.]*real-time net/i);
      return;
    }
    const step = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
    expect(step, `unrecognised sweep schedule ${schedule}`).not.toBeNull();
    const minutes = Number.parseInt(step![1]!, 10);
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    // Pin the HEADLINE statement, not just any occurrence of the phrase. The
    // first draft used a bare "every two minutes" and the guide mutation
    // check (scripts/recon/l33-guide-mutation-check.sh, mutation 3) proved it
    // survived a rewritten headline because the phrase recurs further down.
    expect(flat).toContain(`That is **every ${words[minutes]} minutes**`);
    // Leafly's window is fifteen minutes; the actionable part is that minus
    // the grace period and the deadline margin. Worst-case phase gives
    // floor(window / tick) chances. The guide must quote exactly that.
    const windowMs = 15 * 60_000 - SWEEP_GRACE_MS - SWEEP_DEADLINE_MARGIN_MS;
    const chances = Math.floor(windowMs / (minutes * 60_000));
    expect(chances).toBeGreaterThanOrEqual(2);
    expect(flat).toContain(`roughly **${words[chances]} separate chances**`);
    // The invocation arithmetic is quoted too; derive and compare.
    const perMonth = Math.round((1440 / minutes) * 30);
    expect(flat).toContain(perMonth.toLocaleString("en-US"));
    // And the best-effort caveat must survive: Vercel does not guarantee
    // delivery, so the guide must not imply that it does.
    expect(flat).toMatch(/best effort/i);
  });

  it("quotes the sweeper's real safety numbers", () => {
    // Grace period, deadline margin and per-run cap are described to the owner
    // in minutes and seconds. Derived from the constants so the prose cannot
    // drift from the behaviour.
    expect(SWEEP_GRACE_MS / 60_000).toBe(2);
    expect(SWEEP_DEADLINE_MARGIN_MS / 1_000).toBe(30);
    expect(SWEEP_MAX_PER_RUN).toBe(10);
    expect(GUIDE).toMatch(/two-minute grace/i);
    expect(GUIDE).toMatch(/thirty seconds/i);
    expect(GUIDE).toMatch(/at most ten orders/i);
  });

  it("does not promise the shopper is told anything at acknowledgement", () => {
    // The owner's hard constraint, restated in the document he will actually
    // read. If the guide ever starts implying acknowledge notifies the
    // shopper, the feature has been misdescribed in the most damaging
    // possible way.
    //
    // NOTE ON THE FIRST DRAFT OF THIS ASSERTION, kept rather than quietly
    // corrected: it was written as a single-space regex and failed, because
    // the guide is hard-wrapped at 78 columns and the sentence "It does **not**
    // confirm the order" happens to break between "**not**" and "confirm".
    // The prose was right; the test was asserting a fact about line-wrapping
    // that it did not mean to assert. Fixed by flattening whitespace first,
    // which is what the claim was always about.
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/does \*\*not\*\* confirm/i);
    expect(flat).toMatch(/Confirm is still yours/i);
    expect(flat).toMatch(/shopper has \*\*not\*\* been told/i);
  });
});
