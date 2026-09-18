/**
 * tests/compliance/leafly-bridge-wiring.test.ts
 *
 * SLICE L-13 — PROVE THE BRIDGE WITHOUT LEAFLY.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * Slice L-10 built a bridge from a Leafly webhook to the shop floor. It is
 * made of eight separate seams: the webhook handler, the bridge server, the
 * acknowledgement path, the announcer, the printer, the order board, the
 * register queue and the settings screen. Every one of those seams is
 * individually covered by unit tests, and every one of those unit tests
 * passes on a bridge that is completely disconnected.
 *
 * That is not a hypothetical. A pure core can be perfect and have no callers.
 * We measured exactly that case one slice ago: `orderOriginLabel()` was fully
 * correct, fully self-tested, and invoked by nothing outside its own tests —
 * so for two slices the back office rendered Leafly orders as though they
 * were website orders, with a green suite the whole time. And this session
 * found the same shape again in `pickup-core.ts`, where `PickupQueueEntry`
 * simply never copied `orders.origin` across, so the LAST screen before a
 * regulated handover could not tell the two order types apart.
 *
 * The failure mode is specific and it is the expensive one: **the bridge
 * looks healthy and silently loses orders.** Leafly retries an unacknowledged
 * order and then auto-cancels it. A seam that quietly does nothing therefore
 * does not raise an alarm anywhere — not in CI, not on the floor, and not in
 * the back office. The customer's order simply evaporates, and the first
 * anybody at Greenway hears of it is a phone call.
 *
 * ===========================================================================
 * WHY IT ASSERTS AGAINST SOURCE TEXT
 * ===========================================================================
 * This file reads the actual source files and asserts that the connections
 * are present, in the same spirit as `leafly-order-webhooks.test.ts`, which
 * asserts route files exist on disk because "in Next.js the URL is the
 * directory path... a contract naming a path that nobody implemented looks
 * completely healthy in code review, passes every type check, and returns 404
 * to Leafly in production."
 *
 * The same argument applies here. The alternative — mocking Supabase, the
 * printer, the Pi and Leafly's API to drive a fake order end to end — would
 * prove that the MOCKS are wired together. It would not notice that the real
 * webhook handler had stopped calling the real bridge, because the mock of
 * the webhook handler would still call the mock of the bridge.
 *
 * Source-text assertions have a real weakness and it should be stated plainly
 * rather than discovered later: they prove a call SITE exists, not that it
 * executes at runtime. They are therefore a complement to the behavioural
 * tests, never a replacement. What they buy is the one thing the behavioural
 * tests structurally cannot buy — proof that the pieces are attached to each
 * other, provable on a laptop, in CI, at 3am, with no Leafly account, no
 * sandbox credentials, no Raspberry Pi, no receipt printer and no network.
 *
 * Standing rule R7 forbids sending sandbox traffic to Leafly. This file is
 * how we honour that rule and still know the bridge works.
 *
 * ===========================================================================
 * THE CHAIN BEING PROVEN
 * ===========================================================================
 *   Leafly order_submit webhook
 *     -> webhook-server        -> onLeaflyOrderArrived
 *        -> announcer (per-origin sound)  + printer (receipt)      [STAGE 1]
 *   staff acknowledge
 *     -> order-ack-server      -> onLeaflyOrderAccepted
 *        -> local order row    -> back-office board + register      [STAGE 2]
 *   Leafly order_cancel webhook
 *     -> webhook-server        -> onLeaflyOrderCanceled
 *        -> decideCancelPlan   -> the floor is told                 [STAGE 3]
 *
 * The two stages are the owner's decision, in his words: the order should
 * "make noise on the speaker, and print out the receipt immediately so we
 * know to accept the order as soon as possible", but only become floor
 * visible "once the order has been accepted by us".
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_BRIDGE_STAGES,
  LEAFLY_WORKFLOW_BUCKETS,
} from "@/lib/leafly/bridge-core";
import {
  MARKETPLACE_ORDER_ORIGINS,
  ORDER_ORIGINS,
} from "@/lib/orders/order-origin-core";

const ROOT = process.cwd();

/**
 * Read a source file, failing with the PATH rather than a bare ENOENT.
 *
 * A renamed file must fail this suite loudly and legibly. The whole point of
 * the gate is that a seam cannot disappear quietly, and "ENOENT: no such file
 * or directory, open '...'" buried in a stack trace is quiet enough that
 * somebody will skip the test to get their build green.
 */
function source(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `L-13 wiring gate: expected source file "${relPath}" to exist. ` +
        `If it was renamed, update this test to the new path AND re-verify ` +
        `that the bridge is still connected — do not simply delete the assertion.`,
    );
  }
  return readFileSync(abs, "utf8");
}

/**
 * Strip // and /* *\/ comments before asserting a call site exists.
 *
 * Without this the gate is a fraud detector that fails to detect the most
 * likely fraud. Every one of these files documents its own wiring in prose —
 * `webhook-server.ts` contains the words "onLeaflyOrderArrived" in three
 * comments — so a naive `includes()` would keep passing after the actual call
 * was deleted, for as long as the comment describing it survived. Which is
 * precisely what happens: people delete code and leave the comment.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// The files that make up the bridge. Named once so a rename is a single edit
// and so the list itself is reviewable.
/**
 * Assert that `fnName` is both IMPORTED from the bridge and actually CALLED,
 * in `src` (already comment-stripped).
 *
 * WHY THIS HELPER EXISTS - AND WHY IT IS NOT `toContain(fnName)`
 * -------------------------------------------------------------
 * The first version of this gate used `expect(src).toContain("onLeaflyOrderArrived")`.
 * Mutation testing (scripts/compliance/mutate-leafly-l13.py) severed the
 * bridge two different ways and the gate said nothing to either:
 *
 *   M9  replaced the call with a hardcoded success object and left a
 *       `void onLeaflyOrderArrived;` behind. The name is still in the file.
 *       No order is ever announced or printed again.
 *
 *   M17 deleted the `await import("./bridge-server")` and declared a LOCAL
 *       stub with the identical name. The name is still in the file. The
 *       cancellation never reaches the floor.
 *
 * Both are realistic: M9 is what a hurried "temporarily disable this" looks
 * like, and M17 is what a bad merge or an over-eager mock looks like. So the
 * assertion has to pin down three separate things:
 *
 *   1. the binding comes from "./bridge-server" (not a local shadow),
 *   2. it is invoked, with `await` (an un-awaited promise is a lost result),
 *   3. its return value is bound to something (a call whose result is thrown
 *      away cannot influence the response, so failures cannot surface).
 */
function expectBridgeCall(src: string, fnName: string): void {
  // 1. imported from the bridge, by name
  const importRe = new RegExp(
    `\\{[^}]*\\b${fnName}\\b[^}]*\\}\\s*=\\s*await\\s+import\\(\\s*["']\\./bridge-server["']`,
  );
  expect(src, `${fnName} must be destructured from an import of "./bridge-server"`).toMatch(
    importRe,
  );

  // 2 + 3. awaited, and the result captured
  const callRe = new RegExp(`(const|let)\\s+\\w+\\s*=\\s*await\\s+${fnName}\\s*\\(`);
  expect(src, `${fnName} must be awaited and its result kept`).toMatch(callRe);
}

const PATHS = {
  bridgeCore: "src/lib/leafly/bridge-core.ts",
  bridgeServer: "src/lib/leafly/bridge-server.ts",
  webhookServer: "src/lib/leafly/webhook-server.ts",
  ackServer: "src/lib/leafly/order-ack-server.ts",
  boardServer: "src/lib/leafly/order-board-server.ts",
  panel: "src/components/admin/orders/LeaflyOrdersPanel.tsx",
  announcerPanel: "src/components/admin/orders/AnnouncerPanel.tsx",
  announcerActions: "src/app/admin/orders/announcer-actions.ts",
  originCore: "src/lib/orders/order-origin-core.ts",
  pickupCore: "src/lib/pos/pickup-core.ts",
  pickupStore: "src/lib/pos/pickup-store.ts",
  pickupRoute: "src/app/api/pos/pickup/route.ts",
  registerShell: "src/app/pos/RegisterShell.tsx",
  ordersList: "src/app/admin/orders/page.tsx",
  orderDetail: "src/app/admin/orders/[id]/page.tsx",
  originBadge: "src/components/admin/orders/OrderOriginBadge.tsx",
} as const;

describe("L-13: every seam of the Leafly bridge is actually connected", () => {
  // =========================================================================
  // STAGE 1 — ARRIVAL: the speaker and the printer, immediately
  // =========================================================================
  describe("stage 1 — arrival reaches the speaker and the printer", () => {
    it("the order_submit webhook handler really calls onLeaflyOrderArrived", () => {
      const src = code(source(PATHS.webhookServer));
      expectBridgeCall(src, "onLeaflyOrderArrived");
    });

    it("the arrival result is INSPECTED, not discarded", () => {
      // Calling the bridge and ignoring what it says is only marginally
      // better than not calling it: a failure to announce or to print would
      // then leave no trace anywhere, and the whole point of stage 1 is that
      // the shop finds out fast. The handler must look at `ok` and at the
      // announced/printed flags.
      const src = code(source(PATHS.webhookServer));
      expect(src).toMatch(/bridged\.ok/);
      expect(src).toMatch(/bridged\.announced/);
      expect(src).toMatch(/bridged\.printed/);
    });

    it("arrival is wired to the order_submit event specifically", () => {
      // The call must live in the submit path. If it drifted into, say, the
      // preview handler, every unit test would still pass and no order would
      // ever be announced.
      const src = code(source(PATHS.webhookServer));
      const idx = src.indexOf("onLeaflyOrderArrived");
      expect(idx).toBeGreaterThan(-1);
      // The nearest preceding event discriminator should be the submit one.
      const before = src.slice(0, idx);
      expect(before).toContain("order_submit");
    });

    it("the bridge exports both stages, and they are distinct", () => {
      expect([...LEAFLY_BRIDGE_STAGES]).toEqual(["arrival", "acceptance"]);
      expect(new Set(LEAFLY_BRIDGE_STAGES).size).toBe(LEAFLY_BRIDGE_STAGES.length);
    });

    it("the arrival path announces AND prints, because the owner asked for both", () => {
      // Owner, verbatim: "it should however, make noise on the speaker, and
      // print out the receipt immediately so we know to accept the order as
      // soon as possible."
      const src = code(source(PATHS.bridgeServer));
      expect(src).toMatch(/announce|announcer/i);
      expect(src).toMatch(/print/i);
    });

    it("the arrival path does NOT create the local order (that is stage 2)", () => {
      // Decision 1: floor-visible on ACCEPTANCE. If order creation leaked
      // into the arrival path, a Leafly order would appear on the register
      // before anybody accepted it — and if we then failed to accept in
      // time, Leafly would auto-cancel an order the floor had already built.
      //
      // Expressed against `insertLocalOrder`, which is the act itself. It is
      // NOT expressed against `readLeaflyOrderPayload`, because the arrival
      // path legitimately reads the payload in order to PRINT it — reading
      // is stage 1, inserting is stage 2, and conflating them would have
      // produced a test that forbids the owner's own decision 2.
      const src = source(PATHS.bridgeServer);
      const arrivalStart = src.indexOf("export async function onLeaflyOrderArrived");
      const acceptedStart = src.indexOf("export async function onLeaflyOrderAccepted");
      expect(arrivalStart).toBeGreaterThan(-1);
      expect(acceptedStart).toBeGreaterThan(arrivalStart);
      const arrivalBody = code(src.slice(arrivalStart, acceptedStart));
      expect(arrivalBody).not.toContain("insertLocalOrder");
      // The arrival stage must still be asked for a decision rather than
      // assuming one — the stage split lives in the core, not here.
      expect(arrivalBody).toContain('stage: "arrival"');
    });
  });

  // =========================================================================
  // STAGE 2 — ACCEPTANCE: the order reaches the floor
  // =========================================================================
  describe("stage 2 — acceptance reaches the floor", () => {
    it("the acknowledgement path calls onLeaflyOrderAccepted", () => {
      const src = code(source(PATHS.ackServer));
      expect(src).toContain("onLeaflyOrderAccepted");
    });

    it("a bridge failure during acceptance is surfaced to the human, not swallowed", () => {
      // This is the single most dangerous silent failure in the system.
      // Acknowledging is a one-way door with Leafly: if we tell Leafly "yes"
      // and then fail to create the local order, the customer is expecting
      // cannabis that no screen in the building knows about. The staff member
      // who pressed Accept MUST be told.
      const src = code(source(PATHS.ackServer));
      expectBridgeCall(src, "onLeaflyOrderAccepted");

      // It must be ASSIGNED A REAL MESSAGE, not merely mentioned.
      //
      // Mutation M10 changed the assignment to `bridgeWarning = null && "..."`,
      // which reads almost exactly like the original in a diff, always
      // evaluates to null, and passed the first version of this assertion
      // because the identifier was still there. So the assignment is matched
      // as an assignment, and its right-hand side must begin with a string.
      expect(src, "bridgeWarning must be assigned a literal message").toMatch(
        /bridgeWarning\s*=\s*[`"']/,
      );
      // ...and the message must name the irreversibility, because that is the
      // instruction the staff member needs: acknowledging again is not an
      // option, so they have to build from the printed ticket.
      expect(src).toMatch(/DO NOT acknowledge it again/);
      // ...and it must actually leave the function.
      expect(src).toMatch(/warning[\s\S]{0,200}bridgeWarning/);
    });

    it("the acceptance path creates the local order", () => {
      const src = source(PATHS.bridgeServer);
      const acceptedStart = src.indexOf("export async function onLeaflyOrderAccepted");
      expect(acceptedStart).toBeGreaterThan(-1);
      const body = code(src.slice(acceptedStart, acceptedStart + 4000));
      // It asks the core for the decision...
      expect(body).toContain('stage: "acceptance"');
      // ...reads the stored payload rather than inventing one...
      expect(body).toContain("readLeaflyOrderPayload");
      // ...and actually writes the row.
      expect(body).toContain("insertLocalOrder");
      // The draft builder itself lives in the pure core, where it is tested.
      expect(code(source(PATHS.bridgeCore))).toContain("buildLeaflyLocalOrderDraft");
    });

    it("the created local order is linked back, so it cannot be created twice", () => {
      // Without the writeback, a second acknowledgement (or a retry) builds a
      // SECOND local order for the same Leafly order: two tickets, two bags,
      // one customer, and inventory decremented twice.
      const src = code(source(PATHS.bridgeServer));
      expect(src).toContain("local_order_id");
    });
  });

  // =========================================================================
  // STAGE 3 — CANCELLATION: Q-B, the owner's question
  // =========================================================================
  describe("stage 3 — a Leafly cancellation follows the order to the floor", () => {
    it("the cancel webhook really calls onLeaflyOrderCanceled", () => {
      const src = code(source(PATHS.webhookServer));
      expectBridgeCall(src, "onLeaflyOrderCanceled");
    });

    it("the cancellation carries Leafly's reason code through", () => {
      // The reason code is the difference between "the customer changed
      // their mind" and "we could not verify the customer" - and it is what
      // the floor needs in order to know whether to restock quietly or to
      // find a manager. Dropping it makes every cancellation look the same.
      const src = code(source(PATHS.webhookServer));
      expect(src).toMatch(/onLeaflyOrderCanceled\([\s\S]{0,200}cancelationReasonCode/);
    });

    it("a cancellation that needs a human is not allowed to pass silently", () => {
      const src = code(source(PATHS.webhookServer));
      expect(src).toMatch(/dispositionRequired/);
    });

    it("the cancellation decision comes from the shared core, not from the server file", () => {
      // House rule 11. If the server re-derived "is it safe to auto-cancel?"
      // the answer could differ from the tested one, and the owner's Q-B
      // policy would exist in two places with one of them untested.
      const server = code(source(PATHS.bridgeServer));
      expect(server).toContain("decideCancelPlan");
      const core = code(source(PATHS.bridgeCore));
      expect(core).toContain("export function decideCancelPlan");
    });

    it("the safe-to-auto-cancel set is an ALLOWLIST, never a denylist", () => {
      // The direction of this list is the whole safety argument. An allowlist
      // fails closed: a status nobody anticipated gets escalated to a human.
      // A denylist fails open: an unanticipated status is silently auto
      // cancelled, which is how a bagged order disappears off a shelf.
      const core = code(source(PATHS.bridgeCore));
      expect(core).toContain("SAFE_TO_AUTO_CANCEL_STATUSES");
      // It is a Set, and it is MEMBERSHIP-tested. The shape matters: a
      // membership test on a small explicit set fails closed, because an
      // unlisted status is simply not in it. The dangerous alternative -
      // `if (!UNSAFE.has(status)) autoCancel()` - fails OPEN, silently
      // auto-cancelling a status nobody thought about. That is how an order
      // that is already bagged, or already in an open register sale,
      // disappears off the shelf with no human ever being told.
      expect(core).toMatch(/SAFE_TO_AUTO_CANCEL_STATUSES\s*=\s*new Set\(/);
      expect(core).toMatch(/SAFE_TO_AUTO_CANCEL_STATUSES\.has\(/);
      // and it is queried POSITIVELY: `if (SAFE.has(x))`, never `if (!SAFE.has(x))`
      expect(core).not.toMatch(/!\s*SAFE_TO_AUTO_CANCEL_STATUSES\.has\(/);
    });
  });

  // =========================================================================
  // THE BACK OFFICE BOARD (Q-C)
  // =========================================================================
  describe("the back-office workflow board is really driven by the core", () => {
    it("the panel groups orders with groupLeaflyWorkflow", () => {
      const src = code(source(PATHS.panel));
      expect(src).toContain("groupLeaflyWorkflow");
    });

    it("the panel renders the pipeline warning the core computes", () => {
      // Without this render the core can be perfectly correct about a silent
      // speaker and nobody is ever told.
      const src = code(source(PATHS.panel));
      expect(src).toContain("pipelineWarning");
    });

    it("every workflow bucket the core can return has a heading in the UI path", () => {
      // A bucket with no heading renders as an unlabelled pile of orders.
      const core = source(PATHS.bridgeCore);
      for (const bucket of LEAFLY_WORKFLOW_BUCKETS) {
        expect(core).toContain(bucket);
      }
      const src = source(PATHS.panel);
      for (const bucket of LEAFLY_WORKFLOW_BUCKETS) {
        expect(src).toContain(bucket);
      }
    });

    it("the board tolerates a database that has not run migration 0228 yet", () => {
      // AGENTS rule 6: the owner applies migrations BY HAND, so there is
      // always a window where the code is deployed and the columns are not
      // there. During that window a 42703 must degrade, not blank the board —
      // and the single-order read matters most, because a failure there makes
      // the Accept action refuse, and Leafly auto-cancels.
      const src = source(PATHS.boardServer);
      expect(src).toContain("BOARD_COLUMNS_LEGACY");
      const occurrences = src.split("BOARD_COLUMNS_LEGACY").length - 1;
      // one definition + three fallback call sites (pending, acked, one)
      expect(occurrences).toBeGreaterThanOrEqual(4);
      expect(src).toContain("42703");
    });

    it("the board does NOT collapse an untracked column into 'it never happened'", () => {
      // Three-state discipline: undefined (column not tracked) is not null
      // (tracked, did not happen). Writing `announced_at ?? null` in the row
      // mapper would accuse every order on a pre-0228 database of arriving
      // silently, hiding the one real silent arrival inside eleven false
      // alarms — and staff would learn to ignore the warning.
      const src = code(source(PATHS.panel));
      const start = src.indexOf("function toWorkflowRow");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, start + 1200);
      expect(body).toContain("announced_at");
      expect(body).toContain("printed_at");
      expect(body).not.toMatch(/announced_at\s*\?\?\s*null/);
      expect(body).not.toMatch(/printed_at\s*\?\?\s*null/);
    });
  });

  // =========================================================================
  // THE SOUND LIBRARY (owner decision 3)
  // =========================================================================
  describe("per-order-type sounds are wired to the sound library", () => {
    it("the settings action writes BOTH columns for BOTH origins", () => {
      // Four columns. Writing only the one that changed leaves a stale upload
      // path alive underneath a built-in selection, and the resolver prefers
      // the path — so the owner picks "bell", sees "bell" selected, and keeps
      // hearing last month's custom upload.
      const src = code(source(PATHS.announcerActions));
      expect(src).toContain("soundSelectionToColumns");
      expect(src).toContain("greenway_sound_id");
      expect(src).toContain("greenway_custom_sound_path");
      expect(src).toContain("leafly_sound_id");
      expect(src).toContain("leafly_custom_sound_path");
    });

    it("a failed save tells the owner WHY instead of silently reverting", () => {
      const src = source(PATHS.announcerActions);
      expect(src).toContain("0228");
    });

    it("the settings screen actually renders the picker and resolves what will play", () => {
      const src = code(source(PATHS.announcerPanel));
      expect(src).toContain("announcerUpdateOriginSoundsAction");
      expect(src).toContain("resolveOriginSoundWithLibrary");
      // and warns when both origins would make the same noise, which would
      // silently undo the entire feature
      expect(src).toContain("describeSoundCollision");
    });

    it("Leafly's fallback sound differs from the website's, as the owner required", () => {
      // Owner: "you can set it to fall back to one of the other sounds that
      // is not the same as the fallback one for our online orders noise."
      // Asserted behaviourally against the core, not by reading the file.
      const core = source(PATHS.originCore);
      expect(core).toContain("ORIGIN_DEFAULT_SOUND_IDS");
      // The real inequality is proven in order-origin's own self-tests; here
      // we prove the DEFAULTS TABLE is still the single source the bridge
      // reads, so the two cannot drift apart in separate files.
      expect(code(source(PATHS.bridgeCore))).toMatch(/resolveOriginSound|ORIGIN_DEFAULT_SOUND_IDS/);
    });
  });

  // =========================================================================
  // THE REGISTER (owner: "the two types need to be distinguishable")
  // =========================================================================
  describe("the register can tell a Leafly order from a website order", () => {
    it("the pickup queue entry carries the origin", () => {
      const src = code(source(PATHS.pickupCore));
      expect(src).toContain("origin: OrderOrigin");
      expect(src).toContain("originLabel");
      expect(src).toContain("isMarketplace");
    });

    it("the three fields are COMPUTED, not hardcoded", () => {
      // Mutation M11 replaced `isMarketplace: isMarketplaceOrigin(origin)`
      // with `isMarketplace: false` - reintroducing the exact defect this
      // slice exists to fix - and the first version of this gate passed,
      // because the word "isMarketplace" was still present.
      //
      // Note that the behavioural mirror in pickup-core.test.ts DOES catch
      // this one. Both are kept: the behavioural test proves the value is
      // right, and this proves it is derived from the shared core rather
      // than from a local re-implementation that happens to agree today.
      const src = code(source(PATHS.pickupCore));
      const start = src.indexOf("export function toPickupQueueEntry");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("}", src.indexOf("return {", start)) + 1);
      expect(body).toMatch(/origin\s*=\s*toOrderOrigin\(/);
      expect(body).toMatch(/originLabel:\s*orderOriginLabel\(/);
      expect(body).toMatch(/isMarketplace:\s*isMarketplaceOrigin\(/);
      // and never pinned to a constant
      expect(body).not.toMatch(/isMarketplace:\s*(true|false)\b/);
    });

    it("the label comes from the shared core, not a copy on the iPad", () => {
      // House rule 11. The register is a separate bundle and cannot import
      // back-office components, which is exactly the pressure that produces
      // a second copy of the mapping. The word is computed server-side.
      const src = code(source(PATHS.pickupCore));
      expect(src).toContain("orderOriginLabel");
      expect(src).toContain("isMarketplaceOrigin");
      expect(src).toMatch(/from\s+["']@\/lib\/orders\/order-origin-core["']/);

      // And the mapping is not re-implemented here.
      //
      // The first version of this assertion banned the STRING "Leafly"
      // anywhere in the file, and it failed - on the file's own self-tests,
      // which legitimately assert `originLabel === "Leafly"`. That is a bad
      // assertion in a specific and instructive way: it would have forced
      // the next author to DELETE a correct test in order to get a green
      // build. A gate that can only be satisfied by removing coverage is
      // worse than no gate.
      //
      // So the ban is narrowed to the thing actually being prevented: a
      // second copy of the origin -> word SWITCH. That is the shape house
      // rule 11 exists to stop, and no legitimate test needs it.
      const productionHalf = src.slice(0, src.indexOf("__runPickupCoreTests"));
      expect(productionHalf).not.toMatch(/case\s+["']leafly["']\s*:/);
      expect(productionHalf).not.toMatch(/\bORIGIN_LABELS?\b/);
    });

    it("origin survives the hand-copied API payload", () => {
      // The route copies the load result field by field rather than
      // spreading it, so a new field is dropped unless it is named here.
      // That is deliberate (the payload is a contract with an external
      // client) and it is precisely why it needs a gate.
      const src = code(source(PATHS.pickupRoute));
      expect(src).toContain("origin: loaded.origin");
      expect(src).toContain("originLabel: loaded.originLabel");
      expect(src).toContain("isMarketplace: loaded.isMarketplace");
    });

    it("the register renders the badge on the queue tile and the detail pane", () => {
      const src = code(source(PATHS.registerShell));
      expect(src).toContain("PickupOriginBadge");
      // twice rendered (tile + detail), once defined
      const uses = src.split("PickupOriginBadge").length - 1;
      expect(uses).toBeGreaterThanOrEqual(3);
    });

    it("the loaded-order banner names the marketplace", () => {
      // The badge vanishes when the modal closes. What stays on screen over
      // the open sale is the banner — and the open sale is exactly the one
      // the owner asked about, the one Leafly can cancel underneath.
      const src = code(source(PATHS.registerShell));
      expect(src).toMatch(/originLabel[\s\S]{0,200}loaded into this sale/);
    });

    it("the register no longer calls every online order a website order", () => {
      const src = source(PATHS.registerShell);
      expect(src).not.toContain("Website orders, ready first");
    });
  });

  // =========================================================================
  // THE BACK OFFICE LISTS
  // =========================================================================
  describe("the back office marks origin where staff actually look", () => {
    it("the orders list renders the badge", () => {
      const src = code(source(PATHS.ordersList));
      expect(src).toContain("OrderOriginBadge");
    });

    it("the single-order page renders the badge without hiding the website case", () => {
      // On a list, a badge on every row is noise. On ONE order, "where did
      // this come from?" is a real question and an absent badge is an
      // unanswered one.
      const src = code(source(PATHS.orderDetail));
      expect(src).toContain("OrderOriginBadge");
      expect(src).not.toMatch(/<OrderOriginBadge[^>]*hideWebsite/);
    });

    it("the badge derives its word from the core", () => {
      const src = code(source(PATHS.originBadge));
      expect(src).toContain("orderOriginLabel");
      expect(src).toContain("toOrderOrigin");
    });
  });

  // =========================================================================
  // THE WHOLE-SYSTEM INVARIANTS
  // =========================================================================
  describe("system-wide invariants that no single seam can guarantee", () => {
    it("Leafly is the only marketplace, and it is a real origin", () => {
      expect([...MARKETPLACE_ORDER_ORIGINS]).toEqual(["leafly"]);
      for (const m of MARKETPLACE_ORDER_ORIGINS) {
        expect(ORDER_ORIGINS).toContain(m);
      }
    });

    it("every file in the bridge exists at the path this gate expects", () => {
      // Cheap, and it converts a silent rename into one legible failure
      // instead of a dozen confusing ones.
      for (const [name, rel] of Object.entries(PATHS)) {
        expect(existsSync(join(ROOT, rel)), `${name} -> ${rel}`).toBe(true);
      }
    });

    it("the bridge is reachable from the webhook without a dynamic string", () => {
      // An import built from a variable (`await import(someVar)`) cannot be
      // statically verified by anything, including this gate. Requiring the
      // literal keeps the connection greppable.
      const src = code(source(PATHS.webhookServer));
      expect(src).toContain('"./bridge-server"');
    });

    it("no seam of the bridge has been left as a TODO", () => {
      // A `TODO` inside the bridge is a seam somebody knew was unfinished.
      // Cheap to check, and it has caught real half-wiring before.
      for (const rel of [
        PATHS.bridgeServer,
        PATHS.webhookServer,
        PATHS.ackServer,
        PATHS.boardServer,
      ]) {
        const src = code(source(rel));
        expect(src, rel).not.toMatch(/\bTODO\b|\bFIXME\b/);
      }
    });
  });
});
