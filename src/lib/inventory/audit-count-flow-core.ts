/**
 * src/lib/inventory/audit-count-flow-core.ts   (Fix Phase 4.1–4.3, migration 0326)
 *
 * THE COUNTER'S FLOW, AS PURE DECISIONS.
 *
 * The database (0326) is the enforcement: one counter per count, counts only
 * through RPCs, books captured per lot at first count, "I'm done" refused while
 * anything is blank. This file decides what the SCREEN offers, so the sheet
 * never shows a button the database will refuse, and so each decision can be
 * tested without a browser.
 *
 * Owner decisions this file carries out (00-OWNER-REQUEST-VERBATIM.md):
 *   D54  "Please do what the pros would do." -- release is a separate signed
 *        act; the audit becomes `counting` at the claimer's first lot.
 *   D55  "pressing I'm done should sent the cycle count back to the inventory
 *        audit page linking back to the one that initiated the count. It should
 *        notify me in the main /admin cockpit command center."
 *   D56  "Only one employee per scoped count."
 *   D60  "A-06-7- yes." -- each scan adds one.
 *   D61  "anytime during open hours." -- so stock may move while counting, and
 *        the books are captured per lot at first count (G-35).
 */
import type { AuditSessionStatus } from "./inventory-audit-post-core";

/** What the sheet knows about the person looking at it. */
export type CountViewer = {
  staffId: string;
  isOwner: boolean;
};

/** What the sheet knows about the claim. */
export type CountClaim = {
  status: AuditSessionStatus;
  claimedBy: string | null;
  claimedByName: string | null;
};

export type CountAccess =
  | { mode: "count"; banner: string }
  | { mode: "claim"; banner: string }
  | { mode: "locked"; banner: string };

/**
 * Can this viewer enter numbers, must they press Start counting first, or is
 * the sheet read-only for them? Mirrors `inventory_audit_counter_check`.
 */
export function countAccess(claim: CountClaim, viewer: CountViewer): CountAccess {
  if (claim.status !== "scope_approved" && claim.status !== "counting") {
    const why =
      claim.status === "draft"
        ? "This count has not been released to Cycle Counts yet."
        : claim.status === "review"
          ? "This count is finished and waiting for the owner. The numbers are locked."
          : claim.status === "approved"
            ? "This count is approved. The numbers are part of the record now."
            : "This count was cancelled.";
    return { mode: "locked", banner: why };
  }
  if (claim.claimedBy === null) {
    return {
      mode: "claim",
      banner:
        "Nobody is counting this yet. Press Start counting and it is yours: only one person counts a count, " +
        "so nobody else can enter numbers on it until you press I'm done (or the owner reassigns it).",
    };
  }
  if (claim.claimedBy === viewer.staffId) {
    return { mode: "count", banner: "You are counting this one. Scan each package once; each scan adds one." };
  }
  return {
    mode: "locked",
    banner:
      `${claim.claimedByName ?? "Someone else"} is counting this one. Only one person counts a count` +
      (viewer.isOwner ? " — reassign it on the audit page if they cannot finish." : "; ask the owner if it needs to move to you."),
  };
}

/** A line as the sheet sees it (no expected quantity, ever). */
export type FlowLine = {
  countedQty: number | null;
  recountQty: number | null;
  needsRecount: boolean;
};

/**
 * What a scan of an identified lot should do (G-36 req 2 and 3, D60).
 *   - first scan of the lot    -> add one, no question asked
 *   - the lot already has a number -> ask: add one / replace / count again from zero / cancel
 *   - the lot was asked for a second count and has none yet -> the scan
 *     starts the second count (add one to it)
 *   - the second count is in progress -> add one to it
 *   - the two counts disagree -> the scan is refused; a third count is typed
 */
export type ScanPlan =
  | { kind: "add"; target: "count" | "recount" }
  | { kind: "ask" }
  | { kind: "third" };

export function planScan(line: FlowLine, secondCountStarted: boolean): ScanPlan {
  if (line.countedQty === null) return { kind: "add", target: "count" };
  if (line.recountQty !== null && line.recountQty !== line.countedQty && !secondCountStarted) {
    return { kind: "third" };
  }
  if (line.needsRecount && (line.recountQty === null || secondCountStarted)) {
    return { kind: "add", target: "recount" };
  }
  return { kind: "ask" };
}

/** The three answers to "this lot already has a number". */
export const ALREADY_COUNTED_CHOICES = [
  { mode: "add", label: "Add this one to the count", hint: "You found another package of the same batch." },
  { mode: "replace", label: "Type the right total", hint: "The number on screen is wrong; enter what you have now." },
  { mode: "restart", label: "Count this lot again from zero", hint: "Start this batch over. Your first number is cleared." },
] as const;

export type CountMode = "add" | "replace" | "restart" | "third";

/** Is "I'm done" available? The database refuses the same thing (AUDIT_BLANK_LINES). */
export function doneState(lines: readonly FlowLine[]): { enabled: boolean; why: string } {
  const blank = lines.filter((l) => l.countedQty === null).length;
  if (lines.length === 0) return { enabled: false, why: "This count has no lots." };
  if (blank > 0) {
    return {
      enabled: false,
      why: `${blank} lot${blank === 1 ? " is" : "s are"} still blank. Blank is not zero: count ${blank === 1 ? "it" : "them"}, or type 0 if the shelf is empty.`,
    };
  }
  const secondOpen = lines.filter((l) => l.needsRecount && l.recountQty === null).length;
  const disagree = lines.filter((l) => l.recountQty !== null && l.recountQty !== l.countedQty).length;
  if (secondOpen > 0 || disagree > 0) {
    return {
      enabled: true,
      why:
        `You can finish, but ${secondOpen + disagree} lot${secondOpen + disagree === 1 ? "" : "s"} still ` +
        `${secondOpen + disagree === 1 ? "needs" : "need"} another count. The owner will send it back if it must be counted again.`,
    };
  }
  return { enabled: true, why: "Every lot has a number. Press I'm done and the count goes to the owner." };
}

/** Live progress from the lines themselves (G-34), not from posting-time totals. */
export function liveProgress(lines: readonly FlowLine[]): { total: number; counted: number; blank: number } {
  const counted = lines.filter((l) => l.countedQty !== null).length;
  return { total: lines.length, counted, blank: lines.length - counted };
}

/** The owner-side stage buttons, from LEGAL_STATUS_MOVES plus the 0326 claim. */
export type StageControl = "release" | "cancel" | "send_back" | "reassign" | "approve";

export function ownerStageControls(status: AuditSessionStatus, posted: boolean): StageControl[] {
  if (posted) return [];
  switch (status) {
    case "draft":
      return ["release", "cancel"];
    case "scope_approved":
      return ["reassign", "cancel"];
    case "counting":
      return ["reassign", "cancel"];
    case "review":
      return ["approve", "send_back", "cancel"];
    default:
      return [];
  }
}

/** Per-lot movement between the first count and now (G-35): plain words for the owner. */
export function movementNote(booksAtCount: number | null, movedQty: number): string | null {
  if (booksAtCount === null) {
    return "Counted before per-lot capture existed; compared with the books when the audit was created.";
  }
  if (movedQty === 0) return null;
  const dir = movedQty < 0 ? `${Math.abs(movedQty)} sold or removed` : `${movedQty} received or added`;
  return (
    `Stock moved while this lot was being counted (${dir}). The count cannot be trusted as one moment in time — ` +
    `send it back so the counter uses "Count this lot again from zero". Posting is refused until then.`
  );
}

// ─── self-tests ─────────────────────────────────────────────────────────────
export function __runAuditCountFlowTests(): number {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`audit-count-flow-core: ${m}`);
    n++;
  };
  const me: CountViewer = { staffId: "a", isOwner: false };
  const owner: CountViewer = { staffId: "o", isOwner: true };

  // D56: claim / count / locked
  ok(countAccess({ status: "scope_approved", claimedBy: null, claimedByName: null }, me).mode === "claim", "unclaimed released count asks to claim");
  ok(countAccess({ status: "counting", claimedBy: "a", claimedByName: "A" }, me).mode === "count", "claimer counts");
  const other = countAccess({ status: "counting", claimedBy: "b", claimedByName: "Bob" }, me);
  ok(other.mode === "locked" && other.banner.includes("Bob"), "another claimer locks the sheet and names them");
  ok(countAccess({ status: "counting", claimedBy: "b", claimedByName: "Bob" }, owner).banner.includes("reassign"), "owner is told to reassign");
  ok(countAccess({ status: "draft", claimedBy: null, claimedByName: null }, me).mode === "locked", "draft is not counted");
  ok(countAccess({ status: "review", claimedBy: "a", claimedByName: "A" }, me).mode === "locked", "review locks the counts (D55)");
  // NEGATIVE CONTROL: the owner is not a counter unless they claimed it
  ok(countAccess({ status: "counting", claimedBy: "a", claimedByName: "A" }, owner).mode === "locked", "the owner does not count over a claim");

  // D60 / G-36 scan planning
  ok(planScan({ countedQty: null, recountQty: null, needsRecount: false }, false).kind === "add", "first scan adds");
  ok(planScan({ countedQty: 3, recountQty: null, needsRecount: false }, false).kind === "ask", "re-scan asks, never silently becomes a second count");
  const r = planScan({ countedQty: 3, recountQty: null, needsRecount: true }, false);
  ok(r.kind === "add" && r.target === "recount", "a requested second count is started by scanning");
  const r2 = planScan({ countedQty: 3, recountQty: 2, needsRecount: true }, true);
  ok(r2.kind === "add" && r2.target === "recount", "a second count in progress keeps adding");
  ok(planScan({ countedQty: 3, recountQty: 2, needsRecount: true }, false).kind === "third", "two disagreeing counts need a typed third");
  ok(planScan({ countedQty: 3, recountQty: 3, needsRecount: true }, false).kind === "ask", "agreeing counts: a re-scan asks");

  // I'm done
  ok(!doneState([{ countedQty: null, recountQty: null, needsRecount: false }]).enabled, "blank blocks I'm done");
  ok(doneState([{ countedQty: 0, recountQty: null, needsRecount: false }]).enabled, "zero is a count");
  ok(!doneState([]).enabled, "empty count cannot finish");
  ok(doneState([{ countedQty: 4, recountQty: 6, needsRecount: true }]).why.includes("another count"), "disagreement is mentioned");

  const p = liveProgress([
    { countedQty: 1, recountQty: null, needsRecount: false },
    { countedQty: null, recountQty: null, needsRecount: false },
  ]);
  ok(p.counted === 1 && p.blank === 1 && p.total === 2, "live progress from lines");

  // owner stage controls (D54, G-33)
  ok(ownerStageControls("draft", false).includes("release"), "draft offers Release to Cycle Counts");
  ok(ownerStageControls("review", false).includes("send_back"), "review offers Send back");
  ok(ownerStageControls("counting", false).includes("cancel"), "counting can be cancelled");
  ok(ownerStageControls("approved", true).length === 0, "posted offers nothing");
  ok(!ownerStageControls("counting", false).includes("approve"), "counting cannot be approved");

  // G-35 movement
  ok(movementNote(10, 0) === null, "no movement, no note");
  ok((movementNote(10, -2) ?? "").includes("2 sold"), "a sale mid-count is named");
  ok((movementNote(null, 0) ?? "").includes("before per-lot capture"), "legacy line is explained");
  return n;
}
