/**
 * src/lib/inventory/audit-hub-guidance-core.ts   (slice books-12)
 *
 * THE MENTOR'S BRAIN for the auditing hub. PURE — no imports from anything that
 * touches a database, a request, or a React tree. Everything the hub SAYS lives
 * here as data; the components only lay it out.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "I want this ui to surface and have and use the same level of professional
 *    guidance from any and all authoritative sources, federal, state, GAAP,
 *    industry standards, etc. I want to not just be blocked, but told why and
 *    how."
 *   "I want our PhD level cpa/ cfo to mentor and guide me as all the other
 *    features do. I want to shadow this genius expert so I can become an expert
 *    too."
 *
 * ---------------------------------------------------------------------------
 * WHY THE WORDS LIVE HERE AND NOT IN THE COMPONENTS
 * ---------------------------------------------------------------------------
 * The same rule LedgerExplainer states, applied again:
 *
 *   "A diagram that drifts from the engine is worse than no diagram: it teaches
 *    the wrong thing with confidence."
 *
 * A component that hardcodes "you need a recount above $50" will still say $50
 * long after the policy says $75. Here, the prose is DATA, the thresholds are
 * READ FROM the engine's own policy object, and self-tests assert the two agree.
 * When they disagree, this file fails to load rather than teaching a lie.
 *
 * ---------------------------------------------------------------------------
 * THE ONE IDEA THIS WHOLE MODULE EXISTS TO TEACH
 * ---------------------------------------------------------------------------
 * A refusal is not a wall. It is the most valuable teaching moment the software
 * ever gets, because it happens at the exact instant Michael is trying to do the
 * thing. So every refusal in this system answers three questions in this order:
 *
 *   1. WHAT happened          — in his words, not the database's
 *   2. WHY it is refused      — with the authority quoted, so it is not our opinion
 *   3. HOW to get past it     — the literal next click, never "contact support"
 *
 * A refusal missing #3 is a dead end, and a dead end teaches helplessness. The
 * `Remedy` type below makes #3 structurally mandatory: it is not optional, so a
 * blocker cannot be added without also writing the way out of it.
 */

import {
  DEFAULT_MATERIALITY,
  CADENCE_DAYS,
  MAX_PERMITTED_CADENCE_DAYS,
  formatCents,
  type AbcClass,
  type MaterialityPolicy,
} from "./inventory-audit-core";
import { AUDIT_HUB_AUTHORITY_IDS, AUDIT_HUB_BORROWED_AUTHORITY_IDS } from "./audit-hub-authorities";

// ═══════════════════════════════════════════════════════════════════════════
// 1) THE FIVE STEPS OF A REAL INVENTORY AUDIT
//
// Straight out of ISA 501.4, which is what the Big Four methodologies
// implement. Presented as the hub's spine so Michael walks the professional
// path without having to know he is doing it.
// ═══════════════════════════════════════════════════════════════════════════

export type MethodStep = {
  /** 1-based; the order is the method, not a suggestion. */
  n: number;
  /** What a professional calls it. Michael asked to become an expert; experts know the words. */
  formalName: string;
  /** What it actually means, in his language. */
  plainName: string;
  /** Why this step exists at all — the failure it prevents. */
  why: string;
  /** What the SYSTEM does for him here, so he can see where the work went. */
  systemDoes: string;
  /** What HE (or his staff) must still do. Software cannot count a jar. */
  humanDoes: string;
  /** Authority ids backing this step. Resolved against the registry by self-test. */
  authorityIds: readonly string[];
};

export const AUDIT_METHOD: readonly MethodStep[] = [
  {
    n: 1,
    formalName: "Plan the scope and set materiality",
    plainName: "Decide what gets counted, and what size of mistake matters",
    why:
      "Counting everything every time is impossible in a working shop, and counting whatever catches " +
      "your eye is not an audit — it is a guess with extra steps. The professional answer is to choose " +
      "deliberately, write down WHY you chose it, and be able to defend that choice a year later.",
    systemDoes:
      "Ranks every lot by risk — value, how long since it was last counted, whether it has a history of " +
      "coming up wrong, and whether the same product sits in several batches at once — then proposes a " +
      "scope and writes the reason in plain English.",
    humanDoes:
      "Read the proposed scope and approve it, or change it. You are the one who knows that the back " +
      "room flooded last week.",
    authorityIds: ["AS_2510_11_CYCLE_COUNT_BASIS", "AS_1105_25_SELECTING_SPECIFIC_ITEMS"],
  },
  {
    n: 2,
    formalName: "Evaluate the count instructions and controls",
    plainName: "Make sure whoever counts knows exactly how, before they start",
    why:
      "ISA 501 makes this the FIRST thing an auditor evaluates — before observing anything. A count " +
      "performed well against bad instructions produces a confident wrong answer, which is the most " +
      "expensive kind.",
    systemDoes:
      "Generates the count sheet with a step-by-step checklist, refuses to let a lot be skipped silently, " +
      "and hides the expected quantity so the counter cannot be led by it.",
    humanDoes:
      "Hand the counter the sheet and let them work. Do not tell them what you expect to find.",
    authorityIds: ["ISA_501_A4_COUNT_CONTROLS", "WAC_314_55_087_ADP_AUDIT_TRAIL"],
  },
  {
    n: 3,
    formalName: "Observe the count and inspect the goods",
    plainName: "Watch it happen, and put your hands on the product",
    why:
      "You are checking two different things at once: that the count is being done properly, and that " +
      "the product is actually saleable. A jar that exists but is mouldy counts as one unit and is worth " +
      "nothing.",
    systemDoes:
      "Records WHO counted, WHEN, and whether each line was scanned or typed — so the count sheet is " +
      "evidence rather than a claim.",
    humanDoes:
      "Look at the product, not just the barcode. Damaged, expired, mislabelled — note it while you are " +
      "standing in front of it.",
    authorityIds: ["ISA_501_4_EXISTENCE_AND_CONDITION", "AS_2510_12_RECORDS_ALONE"],
  },
  {
    n: 4,
    formalName: "Perform test counts — in both directions",
    plainName: "Spot-check the sheet against the shelf, AND the shelf against the sheet",
    why:
      "This is the step amateurs skip and it is the one that catches theft. Checking only that the " +
      "written lines exist can never reveal the box nobody wrote down. Both directions, always.",
    systemDoes:
      "Flags lots where several batches of one product exist together — the situation where a counter is " +
      "most likely to count one pile and record it against the wrong batch.",
    humanDoes:
      "Pick a few packages off the shelf at random and confirm each one appears on the sheet. Then pick a " +
      "few lines off the sheet and go find them.",
    authorityIds: ["ISA_501_A7_TWO_WAY_TEST_COUNTS", "AS_1105_11_EXISTENCE"],
  },
  {
    n: 5,
    formalName: "Reconcile, explain, and post",
    plainName: "Explain every difference, then let it hit the books",
    why:
      "An unexplained disappearance is not a rounding error in this industry — Washington treats it as a " +
      "sale you have to pay excise tax on. \"We don't know\" is the single most expensive sentence " +
      "available to you, so the system makes it a deliberate choice rather than a default.",
    systemDoes:
      "Drafts the journal entry with the right accounts, refuses to post while anything is unexplained, " +
      "and never posts to the ledger on its own.",
    humanDoes:
      "Give a reason for each difference, approve the result, then review and post the journal entry " +
      "yourself.",
    authorityIds: [
      "WAC_314_55_089_4_C_DEEMED_SALES",
      "WAC_314_55_089_4_A_MONTHLY_LOST",
      "ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 2) THE TWO-WAY TRACE, MADE CONCRETE
//
// Michael asked what Deloitte does. This is the answer he can act on, and it is
// the highest-value idea in the module, so it gets its own structure rather
// than being a paragraph someone might skim.
// ═══════════════════════════════════════════════════════════════════════════

export type TraceDirection = {
  id: "sheet_to_floor" | "floor_to_sheet";
  formalName: string;
  plainName: string;
  /** The assertion it tests. Naming it is what makes this teachable. */
  proves: string;
  /** What it CANNOT prove — stated, because believing otherwise is the trap. */
  cannotProve: string;
  /** A concrete instruction. */
  howTo: string;
  /** The real-world failure that happens when this direction is skipped. */
  whatBreaksWithoutIt: string;
};

export const TRACE_DIRECTIONS: readonly TraceDirection[] = [
  {
    id: "sheet_to_floor",
    formalName: "Sheet to floor",
    plainName: "Start with the list, go find it on the shelf",
    proves:
      "EXISTENCE and ACCURACY — the things you have written down are really there, in the quantity you " +
      "wrote down.",
    cannotProve:
      "Completeness. It is structurally incapable of finding something that was never written down. If a " +
      "whole shelf is missing from the sheet, this test passes perfectly.",
    howTo:
      "Pick a handful of lines from the count sheet at random. Walk to the shelf. Count what is actually " +
      "there. It should match.",
    whatBreaksWithoutIt:
      "Numbers in the system that nothing on the floor supports — the shape a paper inventory takes when " +
      "it has quietly become fiction.",
  },
  {
    id: "floor_to_sheet",
    formalName: "Floor to sheet",
    plainName: "Start with the shelf, go find it on the list",
    proves:
      "COMPLETENESS — everything that is physically in the building made it onto the record.",
    cannotProve:
      "That the recorded quantities are right for items you did not happen to pick up.",
    howTo:
      "Pick packages off the shelf at random — including from the back room, the display case, and " +
      "anywhere product gets set down. Find each one on the sheet.",
    whatBreaksWithoutIt:
      "Product that exists but is invisible to the books. This is the direction that catches the box in " +
      "the back nobody counted, and it is the one people skip.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 3) BLIND COUNTS — WHY THE COUNTER IS NOT SHOWN THE ANSWER
// ═══════════════════════════════════════════════════════════════════════════

export const BLIND_COUNT_DOCTRINE = {
  what: "The count sheet does not show the quantity the system expects.",
  why:
    "If you show a counter the number they are supposed to find, you have not run a count — you have run " +
    "a confirmation. Human beings agree with the number on the page. They count eleven, see the sheet " +
    "says twelve, assume they miscounted, and write twelve. The one piece of information you were trying " +
    "to obtain is destroyed by showing it to them.",
  soWhat:
    "This is not distrust of your staff. It is the same reason a pharmacist counts pills twice without " +
    "looking at the label the second time. Blind counting is standard practice everywhere inventory " +
    "matters, and it costs nothing to do.",
  exception:
    "On a RECOUNT the system still withholds the expected number, but it does tell the counter that the " +
    "first count did not match — because a second count has to be independent, not a rubber stamp, and " +
    "the counter needs to know to be careful rather than fast.",
  authorityIds: ["ISA_501_A4_COUNT_CONTROLS"],
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 4) REFUSALS: WHAT / WHY / HOW
//
// The structure that makes "told why and how" mandatory rather than aspirational.
// ═══════════════════════════════════════════════════════════════════════════

export type RemedyStep = {
  /** The literal action. "Open X and do Y" — never "resolve the issue". */
  action: string;
  /** Where it happens, so he is not hunting for it. */
  where: string;
};

export type Remedy = {
  /** Machine-readable, so a screen can branch without matching on prose. */
  code: string;
  /** WHAT happened, in Michael's language. */
  what: string;
  /** WHY the system will not proceed. The reasoning, not the rule number. */
  why: string;
  /** HOW to get past it. NOT optional — a blocker without a way out is a dead end. */
  how: readonly RemedyStep[];
  /** The authority that makes this more than our house preference. May be empty. */
  authorityIds: readonly string[];
  /**
   * True when this refusal is protecting against one of the owner's OWN
   * documented historical failures (standing rule 19). Those get extra weight
   * on screen, because they are not hypothetical here.
   */
  fromOwnHistory: boolean;
};

export const REMEDIES: readonly Remedy[] = [
  {
    code: "UNCOUNTED_LINES",
    what: "Some lots in this audit have no number entered yet.",
    why:
      "A blank is not a zero. If a batch is genuinely gone, that is real information worth recording; if " +
      "it was simply never reached, closing the audit would silently declare the shelf correct for " +
      "something nobody looked at. The system cannot tell those two apart, so it refuses to guess.",
    how: [
      { action: "Open the count sheet and find the lines still showing 'not counted'", where: "Count sheet" },
      { action: "Enter 0 for any batch you looked for and could not find — that is a real count", where: "Count sheet" },
      { action: "Come back to the review screen once nothing is blank", where: "Audit review" },
    ],
    authorityIds: ["ISA_501_A4_COUNT_CONTROLS"],
    fromOwnHistory: false,
  },
  {
    code: "MATERIAL_VARIANCE_NEEDS_RECOUNT",
    what: "A difference is big enough that it needs a second count before it can be accepted.",
    why:
      "Big differences are usually counting mistakes, not losses — and the cheapest moment to find that " +
      "out is now, while the product is still on the shelf in front of somebody. Once this posts, you are " +
      "explaining a loss to the ledger instead of fixing an error on the floor.",
    how: [
      { action: "Send the flagged lines back for a recount, ideally to a DIFFERENT person", where: "Audit review" },
      { action: "Have them count without being told the first number", where: "Count sheet" },
      { action: "If the recount agrees, the difference is real — record why it happened", where: "Audit review" },
    ],
    authorityIds: ["ISA_501_A4_COUNT_CONTROLS", "ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL"],
    fromOwnHistory: false,
  },
  {
    code: "MISSING_REASON",
    what: "A difference has no explanation written against it.",
    why:
      "In Washington, product that disappears without an explanation is treated as a SALE — and taxed at " +
      "37% as if you had sold it. 'Unknown' is therefore not a neutral answer, it is the most expensive " +
      "one on the list. Writing down 'broken jar' at the moment it is discovered is worth real money later.",
    how: [
      { action: "Pick a reason for each flagged line — damaged, expired, miscount, theft, or unknown", where: "Audit review" },
      { action: "Add one sentence of detail. 'Jar cracked in transit' is enough", where: "Audit review" },
      { action: "If it genuinely is unknown, say so deliberately — but expect it to be taxed", where: "Audit review" },
    ],
    authorityIds: ["WAC_314_55_089_4_C_DEEMED_SALES", "WAC_314_55_089_4_A_MONTHLY_LOST"],
    fromOwnHistory: false,
  },
  {
    code: "NO_COST_ON_LOT",
    what: "A lot has no unit cost recorded, so the money effect cannot be worked out.",
    why:
      "A count difference has to become dollars before it can touch the books. With no cost, any total " +
      "the system printed would be a number it made up. It would rather show you nothing than show you " +
      "something invented — an invented cost is exactly how a $4.6 million inventory plug gets born.",
    how: [
      { action: "Open the lot and enter the cost from the vendor's invoice or manifest", where: "Inventory → lot detail" },
      { action: "If the invoice cannot be found, say so rather than estimating", where: "Inventory → lot detail" },
      { action: "Return here — the total will calculate itself", where: "Audit review" },
    ],
    authorityIds: ["REG_1_471_3_B_RESELLER_COST", "REG_1_471_2_E_BURDEN_OF_PROOF"],
    fromOwnHistory: true,
  },
  {
    code: "NOT_APPROVED",
    what: "The audit has not been approved yet, so nothing can post.",
    why:
      "Inventory is on the never-post-automatically list, deliberately. Inventory moves when goods move " +
      "and a person confirms goods moved. An audit that posted itself would be a machine deciding that " +
      "product left the building.",
    how: [
      { action: "Read the variance summary and satisfy yourself it is right", where: "Audit review" },
      { action: "Press Approve — your name and the time are recorded against it", where: "Audit review" },
      { action: "Then post the shelf correction, and review the journal entry separately", where: "Audit review" },
    ],
    authorityIds: ["WAC_314_55_087_ADP_AUDIT_TRAIL"],
    fromOwnHistory: false,
  },
  {
    code: "ALREADY_POSTED",
    what: "This audit has already moved the shelf and cannot be posted twice.",
    why:
      "Posting the same count twice would subtract the same missing product from the shelf again, and the " +
      "second subtraction has nothing behind it. That is the road to negative inventory — a number that " +
      "cannot exist in the physical world and which you have seen your own books produce before.",
    how: [
      { action: "If the result was wrong, start a NEW audit and count again", where: "Auditing hub" },
      { action: "The correction goes in as its own entry, so the record shows both", where: "Audit review" },
    ],
    authorityIds: [],
    fromOwnHistory: true,
  },
  {
    code: "SCOPE_NOT_APPROVED",
    what: "Counting cannot start because the scope has not been agreed yet.",
    why:
      "Deciding what to count AFTER seeing the numbers is how a count becomes a search for a comfortable " +
      "answer. Fixing the scope first is what makes the result evidence instead of an opinion.",
    how: [
      { action: "Read the proposed scope and the reason given for it", where: "Audit detail" },
      { action: "Approve it, or adjust it and then approve", where: "Audit detail" },
    ],
    authorityIds: ["AS_1105_25_SELECTING_SPECIFIC_ITEMS"],
    fromOwnHistory: false,
  },
  {
    code: "LOT_MERGE_SIGNATURE",
    what: "Several batches of the same product look like they were counted as one pile.",
    why:
      "Two packages of one product from different batches are identical from the outside. When a counter " +
      "counts the pile and puts the whole number against one batch, that batch goes up and the other goes " +
      "to zero — and the total looks perfect. Under state traceability rules those are two different " +
      "regulated items, so a tidy total hides a real compliance failure.",
    how: [
      { action: "Recount this product with the batches physically separated first", where: "Count sheet" },
      { action: "Check the label on EVERY package — they cannot be told apart by eye", where: "Count sheet" },
      { action: "Scan rather than type; the scan reads the batch for you", where: "Count sheet" },
    ],
    authorityIds: ["WAC_314_55_087_ADP_AUDIT_TRAIL"],
    fromOwnHistory: true,
  },
];

const REMEDY_BY_CODE: ReadonlyMap<string, Remedy> = new Map(REMEDIES.map((r) => [r.code, r]));

export function findRemedy(code: string): Remedy | undefined {
  return REMEDY_BY_CODE.get(code);
}

/**
 * Map a blocker sentence produced by the engine onto a remedy.
 *
 * The engine's `readinessOf().blockers` are prose, written for humans. This
 * matches them to the "how do I fix it" content WITHOUT the engine having to
 * know the hub exists.
 *
 * It returns UNDEFINED rather than a generic fallback when nothing matches, and
 * that is deliberate: a fallback like "check your entries" would look like
 * guidance while containing none, and would hide the fact that a blocker exists
 * with no documented way out. The screen shows the raw engine sentence in that
 * case, which is at least true.
 */
/**
 * Map one of the engine's blocker sentences onto the documented remedies.
 *
 * WHY THIS RETURNS A LIST. Some engine blockers deliberately cover two distinct
 * faults in one sentence — `readinessOf` emits "either a shrink has no
 * explanation, or a lot has no cost on file" as a single line. Returning one
 * remedy there would document half the problem and silently drop the other
 * half, which is precisely the kind of tidy-looking gap this whole slice exists
 * to prevent.
 *
 * DEFECTS D4 AND D5, FOUND BY THE SCREENSHOT HARNESS, RECORDED NOT HIDDEN.
 * The first version of this matcher was written against blocker sentences I had
 * PARAPHRASED rather than read. When the harness was rewired to call the real
 * `readinessOf`, two real blockers fell through to "no scripted fix":
 *
 *   D4  "...has no count sheet line at all (...). Scope said to count it and
 *        nobody did..."            — a lot in scope that was never even listed.
 *        Missed because the matcher only looked for "not been counted".
 *   D5  "...shows the lot-consolidation pattern. This must be re-counted
 *        package by package..."    — the owner's OWN documented failure.
 *        Missed because the matcher looked for "merge", and the engine says
 *        "consolidation". Note "re-counted" is hyphenated and so does not
 *        contain "recount", which is why it did not even match the wrong rule.
 *
 * Both were live product defects, not harness defects: a real blocked audit
 * would have shown Michael the wall with no way through it — and D5 is the one
 * that has actually happened in this shop before.
 *
 * ORDER MATTERS. The tests are arranged most-specific first. The consolidation
 * test runs before anything touching "count", and the uncounted test runs
 * before the generic scope test, because the missing-line sentence itself
 * contains the word "Scope".
 */
export function remediesForBlocker(blocker: string): readonly Remedy[] {
  const b = blocker.toLowerCase();
  const out: Remedy[] = [];
  const add = (code: string) => {
    const r = findRemedy(code);
    if (r && !out.some((x) => x.code === r.code)) out.push(r);
  };

  // D5. The owner's own history. Checked first so no generic rule can claim it.
  if (
    b.includes("consolidation") ||
    b.includes("package by package") ||
    b.includes("merge") ||
    b.includes("same product")
  ) {
    add("LOT_MERGE_SIGNATURE");
  }

  // D4. "no count sheet line at all" and "left out of a count" are the engine's
  // words for a lot in scope that nobody even wrote a line for. That is a
  // stronger version of a blank, and it takes the same remedy.
  if (
    b.includes("not been counted") ||
    b.includes("uncounted") ||
    b.includes("still blank") ||
    b.includes("no count sheet line") ||
    b.includes("left out of a count")
  ) {
    add("UNCOUNTED_LINES");
  }

  if (b.includes("recount")) add("MATERIAL_VARIANCE_NEEDS_RECOUNT");
  if (b.includes("reason") || b.includes("explanation") || b.includes("unexplained")) {
    add("MISSING_REASON");
  }
  if (b.includes("cost")) add("NO_COST_ON_LOT");
  if (b.includes("already posted") || b.includes("posting it again")) add("ALREADY_POSTED");
  if (b.includes("scope") && b.includes("approv")) add("SCOPE_NOT_APPROVED");
  if (out.length === 0 && b.includes("approve")) add("NOT_APPROVED");

  return out;
}

/**
 * Single-remedy convenience. Returns the FIRST applicable remedy, or undefined
 * when nothing is documented — never a generic fallback, because a vague
 * instruction that sounds like help is worse than an honest "no answer yet".
 */
export function remedyForBlocker(blocker: string): Remedy | undefined {
  return remediesForBlocker(blocker)[0];
}

// ══════════════════════════════════════════════════════════════════════════
// 4b) WHY IT WENT MISSING — the reason vocabulary, and what each one costs
// ══════════════════════════════════════════════════════════════════════════

/**
 * The reasons a counted quantity may differ from the books.
 *
 * WHY THIS IS DATA AND NOT A DROPDOWN IN A COMPONENT.
 * In Washington, product that leaves the building without a recorded, credible
 * explanation is treated as a SALE and taxed accordingly — WAC 314-55-089(4)(c).
 * That makes the reason field a TAX field wearing an operations field's
 * clothing. A vocabulary that lives inside a `<select>` gets edited by whoever
 * is styling the page; a vocabulary that lives here, with its consequences
 * attached and its own self-tests, does not.
 *
 * NOTE WHAT IS NOT IN THIS LIST: there is no "adjustment", no "correction", and
 * no "variance". Those are words that describe the NUMBER changing rather than
 * the PRODUCT moving, and they are exactly how a real shortage gets filed as
 * housekeeping. Every entry here names a physical event or admits that nobody
 * knows which physical event happened.
 *
 * `costsTax` is stated plainly rather than buried. Michael should be able to
 * see, at the moment of choosing, which answers are expensive — not discover
 * it from an assessment letter.
 */
export type VarianceReason = {
  /** Stored in inventory_audit_lines.reason_code. */
  code: string;
  /** What Michael reads in the list. */
  label: string;
  /** When to choose this one, in plain words. */
  whenToUse: string;
  /**
   * True when this answer is likely to be treated as a taxable disappearance
   * rather than an ordinary business loss. Shown as a warning, never hidden.
   */
  costsTax: boolean;
  /** Free-text detail is not optional for these. */
  requiresNote: boolean;
  authorityIds: readonly string[];
};

export const VARIANCE_REASONS: readonly VarianceReason[] = [
  {
    code: "miscount",
    label: "Earlier miscount — the shelf was always right",
    whenToUse:
      "The product never moved; a previous count or a receiving entry put the wrong number in " +
      "the system. This is the most common answer and it is not an admission of anything.",
    costsTax: false,
    requiresNote: true,
    authorityIds: ["ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL"],
  },
  {
    code: "damaged",
    label: "Damaged — broken, spilled, or unsaleable",
    whenToUse:
      "A physical accident you can describe. 'Jar cracked in transit' is enough detail. If the " +
      "product still physically exists, it belongs in Returns & Destruction, not here.",
    costsTax: false,
    requiresNote: true,
    authorityIds: ["WAC_314_55_089_4_C_DEEMED_SALES"],
  },
  {
    code: "expired",
    label: "Expired — past its date and pulled",
    whenToUse:
      "Product that aged out. Expiry is a foreseeable business loss, which is why it is treated " +
      "very differently from product that simply is not there.",
    costsTax: false,
    requiresNote: false,
    authorityIds: ["WAC_314_55_089_4_C_DEEMED_SALES"],
  },
  {
    code: "theft",
    label: "Theft or diversion — somebody took it",
    whenToUse:
      "Choose this when you actually believe it, not as a default for anything missing. Most " +
      "differences are paperwork, not people, and treating every variance as theft is the " +
      "fastest way to lose good staff over a data-entry error.",
    costsTax: false,
    requiresNote: true,
    authorityIds: ["WAC_314_55_089_4_C_DEEMED_SALES"],
  },
  {
    code: "unrecorded_sale",
    label: "Sold but not rung up correctly",
    whenToUse:
      "The product genuinely left with a customer but the sale did not land against this lot. " +
      "This is a till problem, and naming it here is what lets you go and find it.",
    costsTax: false,
    requiresNote: true,
    authorityIds: ["ISA_501_A5_CUTOFF_MOVEMENT"],
  },
  {
    code: "unknown",
    label: "Unknown — nobody can say what happened",
    whenToUse:
      "The honest answer when there is no evidence either way. It is a legitimate choice and " +
      "sometimes the only truthful one. It is also the most expensive answer on this list, so " +
      "choose it deliberately rather than by leaving a box empty.",
    costsTax: true,
    requiresNote: true,
    authorityIds: ["WAC_314_55_089_4_C_DEEMED_SALES", "WAC_314_55_089_4_A_MONTHLY_LOST"],
  },
];

const VARIANCE_REASON_BY_CODE: ReadonlyMap<string, VarianceReason> = new Map(
  VARIANCE_REASONS.map((r) => [r.code, r]),
);

/** Look a reason up. Returns undefined for anything unrecognised, never a guess. */
export function findVarianceReason(code: string | null): VarianceReason | undefined {
  return code === null ? undefined : VARIANCE_REASON_BY_CODE.get(code);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) THE CADENCE, EXPLAINED IN MONEY AND TIME
// ═══════════════════════════════════════════════════════════════════════════

export type CadenceExplanation = {
  abcClass: AbcClass;
  label: string;
  everyNDays: number;
  /** How that lands in a real week. */
  inPractice: string;
  why: string;
};

export const CADENCE_EXPLAINED: readonly CadenceExplanation[] = [
  {
    abcClass: "A",
    label: "Your most valuable stock",
    everyNDays: CADENCE_DAYS.A,
    inPractice: "Roughly the top 80% of your inventory value. A small number of lots, most of the money.",
    why:
      "A mistake here costs the most, so it gets found the fastest. This is the whole idea behind counting " +
      "by value rather than by shelf: your attention is finite and should follow the dollars.",
  },
  {
    abcClass: "B",
    label: "The middle",
    everyNDays: CADENCE_DAYS.B,
    inPractice: "The next 15% of value. More lots, less money each.",
    why: "Worth watching regularly, not worth watching constantly.",
  },
  {
    abcClass: "C",
    label: "The long tail",
    everyNDays: CADENCE_DAYS.C,
    inPractice: "The last 5% of value, usually the largest number of lots.",
    why:
      "Cheap items still have to be counted — they are still regulated product — but counting them weekly " +
      "would consume the staff time the valuable stock needs.",
  },
  {
    abcClass: "U",
    label: "Unvalued — cost unknown",
    everyNDays: CADENCE_DAYS.U,
    inPractice: "Anything the system cannot price, because no cost was ever recorded.",
    why:
      "These are counted on the SHORTEST cycle of all, which surprises people. A lot with no cost is not " +
      "low risk, it is UNMEASURED risk: it could be the most valuable thing in the building and the books " +
      "would not know. Unknown is treated as dangerous, never as small.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 6) WHAT COUNTING PROVES — AND WHAT IT DOES NOT
//
// Michael asked to become an expert. Experts are precise about the limits of
// their evidence; that precision is most of what separates them from amateurs.
// ═══════════════════════════════════════════════════════════════════════════

export const PROVES_AND_DOES_NOT = {
  proves: [
    "The product on your balance sheet physically exists, on the day you counted it.",
    "The condition it is in — saleable, damaged, expired.",
    "Whether your day-to-day controls are working, because a clean count is evidence about the system, " +
      "not just about the shelf.",
  ],
  doesNotProve: [
    "That you own it. Consignment product sits on your shelf and is not yours.",
    "That it is worth what the books say. Existence is a quantity question; value is a separate one.",
    "That nothing is missing from the RECORDS — only counting floor-to-sheet gets at that.",
    "That the difference you found is theft. Most differences are paperwork, not people.",
  ],
  authorityIds: ["AS_1105_11_EXISTENCE", "ISA_501_4_EXISTENCE_AND_CONDITION"],
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 7) THE GLOSSARY — shadow the expert, learn the words
// ═══════════════════════════════════════════════════════════════════════════

export type GlossaryEntry = { term: string; plain: string; why: string };

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "Cycle count",
    plain: "Counting a slice of the shop often, instead of the whole shop once a year.",
    why:
      "Legitimate as long as the slices add up to the same confidence as counting everything annually — " +
      "that is the actual written test, not just 'we count regularly'.",
  },
  {
    term: "Variance",
    plain: "The difference between what the system expected and what was actually on the shelf.",
    why: "Positive means you found more than expected, which is a control problem too, not good news.",
  },
  {
    term: "Gross vs net variance",
    plain: "Net adds the differences together with their signs. Gross adds their sizes, ignoring direction.",
    why:
      "A $600 overage and a $600 shortage net to zero and look flawless. Gross shows $1,200 of error. " +
      "Gross is the honest number, which is why this system shows both and leads with gross.",
  },
  {
    term: "Materiality",
    plain: "How big a difference has to be before it is worth acting on.",
    why:
      "Set BEFORE you look at the results, deliberately. Deciding what counts as significant after seeing " +
      "the numbers is how people talk themselves out of bad news.",
  },
  {
    term: "Cutoff",
    plain: "Making sure a sale that happened during the count is not mistaken for missing product.",
    why: "In a shop that sells while it counts, this is the single biggest source of fake variances.",
  },
  {
    term: "Test count",
    plain: "The auditor counting some of it themselves rather than trusting the sheet.",
    why: "Done in both directions — sheet to floor and floor to shelf — because each proves a different thing.",
  },
  {
    term: "Blind count",
    plain: "Counting without being shown the number you are expected to find.",
    why: "Showing the expected number turns a count into a confirmation and destroys its value.",
  },
  {
    term: "Deemed sale",
    plain: "Washington treating disappeared product as if you sold it, and taxing it.",
    why: "This is why 'unknown' is the most expensive reason code on the list.",
  },
  {
    term: "Roll-forward",
    plain: "Counting on a date that is not year-end, then accounting for everything that moved since.",
    why:
      "It is what makes cycle counting work at all. The movement in between has to be reliable, which is " +
      "why a count that disagrees with the system is evidence about your controls.",
  },
  {
    term: "Existence vs completeness",
    plain: "Existence: what is written down is really there. Completeness: what is there got written down.",
    why: "Two different tests needing two different procedures. Confusing them is the classic error.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 8) MATERIALITY, READ FROM THE ENGINE (never re-typed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Describe the live materiality policy in English.
 *
 * Takes the policy as an argument rather than reaching for the default, so the
 * screen always describes the policy actually in force. Hardcoding the numbers
 * in prose is the drift this whole module is built to prevent.
 */
export function describeMateriality(policy: MaterialityPolicy = DEFAULT_MATERIALITY): string {
  const abs = formatCents(policy.absCents);
  const recount = formatCents(policy.recountAtCents);
  // The engine stores the percentage in MILLI-percent (2_000 = 2.000%), because
  // integer arithmetic on money must not go anywhere near a float. Converting it
  // for display is this function's job; re-typing "2%" into prose is exactly the
  // drift that would survive a policy change.
  const pct = formatMilliPct(policy.milliPct);
  return (
    `A difference is treated as significant once it reaches ${abs} in value, or once it is off by ` +
    `${pct} or more of what the books expected — whichever happens first. Two tests rather than one, ` +
    `because ${abs} against a single cheap package is a serious error, while the same ${abs} spread ` +
    `across a large valuable lot may be ordinary rounding. Above ${recount}, one count is not enough ` +
    `on its own: the system asks for a second, independent count before it will accept the number.`
  );
}

/**
 * Render milli-percent as a human percentage. 2_000 → "2%", 2_500 → "2.5%".
 *
 * Trailing zeros are trimmed because "2.000%" reads like a tolerance a
 * laboratory would quote, and this sentence is for a shop owner.
 */
export function formatMilliPct(milliPct: number): string {
  const pct = milliPct / 1000;
  return `${Number.isInteger(pct) ? pct.toString() : pct.toFixed(3).replace(/0+$/, "")}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 9) SELF-TESTS  (Rule 15: each targets one behaviour and can fail alone)
// ═══════════════════════════════════════════════════════════════════════════

export function __runAuditHubGuidanceCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`audit-hub-guidance-core self-test FAILED: ${msg}`);
  };
  const eq = <T,>(actual: T, expected: T, msg: string) => {
    if (actual !== expected) {
      throw new Error(
        `audit-hub-guidance-core self-test FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
      );
    }
  };

  // ── 1) THE METHOD IS THE PROFESSIONAL METHOD, IN ORDER ────────────────────
  eq(AUDIT_METHOD.length, 5, "the method has all five steps");
  AUDIT_METHOD.forEach((s, i) => {
    eq(s.n, i + 1, `method step ${i + 1} is numbered in sequence`);
    ok(s.formalName.trim().length > 0, `step ${s.n} names what a professional calls it`);
    ok(s.plainName.trim().length > 0, `step ${s.n} says it in plain English too`);
    ok(s.why.length >= 40, `step ${s.n} explains why it exists`);
    ok(s.systemDoes.length >= 20, `step ${s.n} says what the system does`);
    ok(s.humanDoes.length >= 20, `step ${s.n} says what the human must still do`);
  });

  // The order is the method. Test counts CANNOT come before the count is
  // planned, and reconciliation cannot come before test counts. If someone
  // reorders these, the hub would teach the steps in the wrong sequence.
  eq(AUDIT_METHOD[3].formalName.includes("Test count") || AUDIT_METHOD[3].formalName.includes("test count"), true,
    "test counts are step 4, after observation");
  ok(AUDIT_METHOD[4].why.includes("tax") || AUDIT_METHOD[4].why.includes("sale"),
    "the final step carries the deemed-sale warning");

  // ── 2) EVERY AUTHORITY ID CITED IS ONE THIS SLICE MAY CITE ────────────────
  // The permitted set = ids this module introduces + ids it explicitly borrows
  // + ids the books-10 auditor owns. Citing anything else means the panel would
  // silently render nothing, which is how a screen loses its support without
  // anyone noticing.
  const permitted = new Set<string>([
    ...AUDIT_HUB_AUTHORITY_IDS,
    ...AUDIT_HUB_BORROWED_AUTHORITY_IDS,
    // Owned by inventory-audit-authorities.ts, resolvable through the shared registry.
    "AS_1105_25_SELECTING_SPECIFIC_ITEMS",
    "AS_1105_27_NO_PROJECTION",
    "REG_1_471_3_B_RESELLER_COST",
    "REG_1_471_2_F_3_OMITTING_STOCK",
    "REG_1_471_2_F_2_NOMINAL_PRICE",
    "AS_1105_11_COMPLETENESS",
  ]);
  const citedEverywhere: string[] = [
    ...AUDIT_METHOD.flatMap((s) => [...s.authorityIds]),
    ...REMEDIES.flatMap((r) => [...r.authorityIds]),
    ...BLIND_COUNT_DOCTRINE.authorityIds,
    ...PROVES_AND_DOES_NOT.authorityIds,
    ...VARIANCE_REASONS.flatMap((r) => [...r.authorityIds]),
  ];
  for (const id of citedEverywhere) {
    ok(permitted.has(id), `cited authority ${id} is one this module is entitled to cite`);
  }

  // ── 2b) THE VARIANCE REASON VOCABULARY ──────────────────────────────
  ok(VARIANCE_REASONS.length >= 5, "there is a real vocabulary, not a token list");

  const rCodes = VARIANCE_REASONS.map((r) => r.code);
  eq(new Set(rCodes).size, rCodes.length, "no duplicate reason codes");

  VARIANCE_REASONS.forEach((r) => {
    ok(r.label.trim().length > 0, `${r.code} has a label`);
    ok(r.whenToUse.length >= 40, `${r.code} explains WHEN to choose it`);
  });

  // "unknown" MUST exist. Removing it would look like tightening the controls
  // while actually forcing people to pick a reason they do not believe — which
  // is how a shrink record becomes fiction.
  const unknown = findVarianceReason("unknown");
  ok(unknown !== undefined, "'unknown' remains an available answer");
  ok(unknown?.costsTax === true, "'unknown' is flagged as the expensive answer");

  // ...and it must be the ONLY one flagged as a deemed sale. If everything were
  // marked expensive the warning would carry no information and be ignored.
  eq(VARIANCE_REASONS.filter((r) => r.costsTax).length, 1,
    "exactly one reason carries the deemed-sale warning, so the warning still means something");

  // NEGATIVE CONTROL. Words that describe the NUMBER changing rather than the
  // PRODUCT moving are how a real shortage gets filed as housekeeping.
  ["adjustment", "correction", "variance", "shrink", "writeoff", "write_off"].forEach((bad) => {
    eq(findVarianceReason(bad), undefined,
      `NEGATIVE CONTROL: '${bad}' is not an acceptable explanation for missing product`);
  });

  // An unrecognised code returns undefined rather than the first entry. A
  // silent fallback here would relabel somebody's stated reason.
  eq(findVarianceReason("not_a_real_code"), undefined, "an unknown reason code is not guessed at");
  eq(findVarianceReason(null), undefined, "a null reason code is not guessed at");

  // ── 3) THE TWO-WAY TRACE IS ACTUALLY TWO WAYS ─────────────────────────────
  eq(TRACE_DIRECTIONS.length, 2, "both trace directions are present");
  const ids = TRACE_DIRECTIONS.map((t) => t.id);
  ok(ids.includes("sheet_to_floor"), "sheet-to-floor is taught");
  ok(ids.includes("floor_to_sheet"), "floor-to-sheet is taught");

  // The entire teaching value is that the two prove DIFFERENT things. If both
  // said the same, the lesson would be gone while the screen still looked full.
  const s2f = TRACE_DIRECTIONS.find((t) => t.id === "sheet_to_floor")!;
  const f2s = TRACE_DIRECTIONS.find((t) => t.id === "floor_to_sheet")!;
  ok(/existence/i.test(s2f.proves), "sheet-to-floor is described as proving existence");
  ok(/completeness/i.test(f2s.proves), "floor-to-sheet is described as proving completeness");
  ok(/completeness/i.test(s2f.cannotProve), "sheet-to-floor admits it cannot prove completeness");
  ok(s2f.proves !== f2s.proves, "the two directions do not claim to prove the same thing");

  // ── 4) EVERY REFUSAL HAS A WAY OUT ────────────────────────────────────────
  // This is THE test for Michael's "not just be blocked, but told why and how".
  // A remedy with an empty `how` is a dead end wearing a helpful costume.
  ok(REMEDIES.length >= 8, "the common refusals are all covered");
  for (const r of REMEDIES) {
    ok(r.what.trim().length >= 20, `${r.code} says WHAT happened`);
    ok(r.why.trim().length >= 40, `${r.code} says WHY, with reasoning rather than a rule number`);
    ok(r.how.length >= 1, `${r.code} says HOW to fix it — a blocker with no way out is a dead end`);
    for (const step of r.how) {
      ok(step.action.trim().length > 0, `${r.code} remedy steps name a real action`);
      ok(step.where.trim().length > 0, `${r.code} remedy steps say where to do it`);
      // "Contact support" is not a remedy in a single-owner business. Michael IS
      // support. A step like that would be an admission the system gave up.
      ok(
        !/contact support|contact your administrator/i.test(step.action),
        `${r.code} does not punt to a support desk that does not exist`,
      );
    }
  }

  // No duplicate codes — a duplicate would make findRemedy return whichever was
  // built first, silently shadowing the other.
  const codes = REMEDIES.map((r) => r.code);
  eq(new Set(codes).size, codes.length, "remedy codes are unique");

  // ── 5) BLOCKER → REMEDY MATCHING ──────────────────────────────────────────
  // ── THE ENGINE'S REAL SENTENCES, NOT PARAPHRASES ───────────────────────
  // DEFECTS D4 AND D5. The original version of these tests asserted against
  // blocker strings I had WRITTEN MYSELF to look like the engine's. They passed
  // perfectly and proved nothing, because both sides of the comparison came out
  // of the same imagination. The screenshot harness, once rewired to call the
  // real readinessOf(), showed two real blockers hitting "no scripted fix".
  //
  // These fixtures are now copied VERBATIM from inventory-audit-core.ts, with
  // the template holes filled. If the engine's wording drifts, the matcher must
  // drift with it — and until then, these are the sentences a blocked Michael
  // actually sees.
  const REAL_UNCOUNTED =
    "2 lines have not been counted. Blank is not zero — a line nobody looked at " +
    "cannot be treated as an empty shelf.";
  const REAL_MISSING_LINE =
    "1 lot in this session has no count sheet line at all (LOT-f). Scope said to " +
    "count it and nobody did — stock that is left out of a count cannot be treated " +
    "as stock that is not there.";
  const REAL_RECOUNT = "3 lines need a second blind recount before posting.";
  const REAL_MERGE =
    "1 product shows the lot-consolidation pattern. This must be re-counted " +
    "package by package before anything is posted.";
  const REAL_UNDOCUMENTED =
    "1 line cannot post yet — either a shrink has no explanation, or a lot has no " +
    "cost on file.";
  const REAL_NOT_APPROVED =
    '"October spot check" is being counted. Only an approved audit can change ' +
    "inventory. Nothing was posted.";

  eq(remedyForBlocker(REAL_UNCOUNTED)?.code, "UNCOUNTED_LINES",
    "the REAL uncounted-lines sentence finds its remedy");
  // D4 regression. Before the fix this returned undefined.
  eq(remedyForBlocker(REAL_MISSING_LINE)?.code, "UNCOUNTED_LINES",
    "D4: a lot in scope with NO LINE AT ALL is given the uncounted remedy");
  eq(remedyForBlocker(REAL_RECOUNT)?.code, "MATERIAL_VARIANCE_NEEDS_RECOUNT",
    "the REAL recount sentence finds its remedy");
  // D5 regression. Before the fix this returned undefined — on the one blocker
  // that guards a failure this shop has ALREADY had.
  eq(remedyForBlocker(REAL_MERGE)?.code, "LOT_MERGE_SIGNATURE",
    "D5: the REAL lot-consolidation sentence finds its remedy");
  ok(remedyForBlocker(REAL_MERGE)?.fromOwnHistory === true,
    "D5: and it is still flagged as the owner's own history");
  eq(remedyForBlocker(REAL_NOT_APPROVED)?.code, "NOT_APPROVED",
    "the REAL not-approved gate sentence finds its remedy");

  // The two-fault sentence must yield BOTH ways out, not just the first.
  const both = remediesForBlocker(REAL_UNDOCUMENTED).map((r) => r.code);
  ok(both.includes("MISSING_REASON") && both.includes("NO_COST_ON_LOT"),
    "a blocker naming two faults returns both remedies");

  // NEGATIVE CONTROL. "re-counted" (hyphenated) must NOT be mistaken for a
  // recount blocker — that near-miss is exactly what hid D5.
  ok(!remediesForBlocker(REAL_MERGE).some((r) => r.code === "MATERIAL_VARIANCE_NEEDS_RECOUNT"),
    "NEGATIVE CONTROL: 're-counted package by package' is not a recount blocker");

  // EVERY blocker the engine can emit must have a documented way out. This is
  // the test that turns "I fixed two" into "there are no more".
  const ALL_REAL_BLOCKERS = [
    REAL_UNCOUNTED, REAL_MISSING_LINE, REAL_RECOUNT, REAL_MERGE,
    REAL_UNDOCUMENTED, REAL_NOT_APPROVED,
  ];
  ALL_REAL_BLOCKERS.forEach((b) => {
    ok(remediesForBlocker(b).length > 0,
      `every real engine blocker has a remedy: ${b.slice(0, 46)}...`);
  });

  ok(remedyForBlocker("3 lots have not been counted")?.code === "UNCOUNTED_LINES",
    "an uncounted-lines blocker finds its remedy");
  ok(remedyForBlocker("2 lines require a recount")?.code === "MATERIAL_VARIANCE_NEEDS_RECOUNT",
    "a recount blocker finds its remedy");
  ok(remedyForBlocker("a variance has no reason recorded")?.code === "MISSING_REASON",
    "a missing-reason blocker finds its remedy");
  ok(remedyForBlocker("lot has no unit cost")?.code === "NO_COST_ON_LOT",
    "a missing-cost blocker finds its remedy");

  // THE REFUSAL TO INVENT GUIDANCE. An unmatched blocker returns undefined so
  // the screen shows the engine's own true sentence. A generic fallback would
  // look like help while containing none — and would hide the fact that a
  // blocker exists with no documented remedy.
  eq(remedyForBlocker("something nobody has ever seen before"), undefined,
    "an unrecognised blocker is NOT given invented guidance");

  // ── 6) CADENCE PROSE MATCHES THE ENGINE'S ACTUAL POLICY ───────────────────
  // The drift this module exists to prevent, tested directly: if CADENCE_DAYS
  // changes and this prose does not, the two would teach different rules.
  eq(CADENCE_EXPLAINED.length, 4, "every ABC class is explained, including unvalued");
  for (const c of CADENCE_EXPLAINED) {
    eq(c.everyNDays, CADENCE_DAYS[c.abcClass],
      `the ${c.abcClass} cadence on screen equals the cadence in the engine`);
    ok(c.everyNDays <= MAX_PERMITTED_CADENCE_DAYS,
      `the ${c.abcClass} cadence respects the maximum the engine enforces`);
  }

  // Unvalued stock must be counted at least as often as the most valuable
  // stock. If this ever inverted, the system would be teaching that "we don't
  // know what it costs" is a reason to look at it LESS.
  const u = CADENCE_EXPLAINED.find((c) => c.abcClass === "U")!;
  const a = CADENCE_EXPLAINED.find((c) => c.abcClass === "A")!;
  ok(u.everyNDays <= a.everyNDays, "unvalued stock is counted at least as often as the most valuable stock");

  // ── 7) MATERIALITY PROSE IS COMPUTED, NEVER TYPED ─────────────────────────
  const desc = describeMateriality(DEFAULT_MATERIALITY);

  // ── THE NaN GATE ──────────────────────────────────────────────────────────
  // THIS TEST EXISTS BECAUSE IT ALREADY CAUGHT A REAL BUG IN THIS FILE.
  //
  // The first version of describeMateriality() read `policy.materialCents` and
  // `policy.materialPct`. Neither field exists — MaterialityPolicy declares
  // `absCents`, `milliPct` and `recountAtCents`. So the sentence rendered as
  // "$NaN.NaN ... undefined%" and shipped that to Michael.
  //
  // The original test did not notice, because it compared the broken output
  // against the SAME broken expression: formatCents(undefined) === "$NaN.NaN"
  // on both sides, so the assertion passed while the screen was nonsense. That
  // is the exact failure mode standing rule 15 is about — a test that cannot
  // fail is decoration.
  //
  // The fix is to assert on the SHAPE of the output, not on a round trip
  // through the same function. NaN and undefined can never satisfy these.
  ok(!/NaN/.test(desc), "the materiality sentence contains no NaN");
  ok(!/undefined/.test(desc), "the materiality sentence contains no undefined");
  ok(/\$\d/.test(desc), "the materiality sentence contains a real dollar amount");
  ok(/\d%/.test(desc), "the materiality sentence contains a real percentage");

  ok(desc.includes(formatCents(DEFAULT_MATERIALITY.absCents)),
    "the materiality sentence quotes the live cash threshold");
  ok(desc.includes(formatCents(DEFAULT_MATERIALITY.recountAtCents)),
    "the materiality sentence quotes the live recount threshold");

  // Proven RESPONSIVE to a different policy. Without this, a hardcoded string
  // that happened to match the defaults would pass everything above.
  const alt = describeMateriality({ absCents: 999_99, milliPct: 42_000, recountAtCents: 1_234_56 });
  ok(alt.includes("$999.99"), "the sentence follows the cash threshold it is given");
  ok(alt.includes("42%"), "the sentence follows the percentage it is given");
  ok(alt.includes("$1,234.56"), "the sentence follows the recount threshold it is given");
  ok(!alt.includes(formatCents(DEFAULT_MATERIALITY.absCents)),
    "the sentence does not smuggle in the default threshold");

  // Milli-percent conversion, including the awkward fractional case.
  eq(formatMilliPct(2_000), "2%", "2000 milli-percent renders as 2%");
  eq(formatMilliPct(2_500), "2.5%", "2500 milli-percent renders as 2.5%");
  eq(formatMilliPct(500), "0.5%", "500 milli-percent renders as 0.5%");

  // ── 8) THE LIMITS OF THE EVIDENCE ARE STATED ──────────────────────────────
  ok(PROVES_AND_DOES_NOT.proves.length >= 3, "what a count proves is stated");
  ok(PROVES_AND_DOES_NOT.doesNotProve.length >= 3, "what a count does NOT prove is stated");
  ok(PROVES_AND_DOES_NOT.doesNotProve.some((t) => /own/i.test(t)),
    "the ownership limit is called out — existence is not title");

  // ── 9) GLOSSARY ───────────────────────────────────────────────────────────
  ok(GLOSSARY.length >= 10, "the glossary covers the vocabulary of the trade");
  const terms = GLOSSARY.map((g) => g.term.toLowerCase());
  eq(new Set(terms).size, terms.length, "no term is defined twice");
  for (const g of GLOSSARY) {
    ok(g.plain.trim().length >= 20, `${g.term} has a plain-English definition`);
    ok(g.why.trim().length >= 20, `${g.term} explains why it matters, not just what it means`);
  }
  ok(terms.includes("gross vs net variance"), "the gross-vs-net lesson is in the glossary");
  ok(terms.includes("blind count"), "blind counting is in the glossary");

  // ── 10) BLIND COUNT DOCTRINE KEEPS ITS EXCEPTION ──────────────────────────
  // The exception is the subtle part: recounts still withhold the number. If
  // that sentence were dropped, staff would be shown the expected quantity at
  // exactly the moment independence matters most.
  ok(BLIND_COUNT_DOCTRINE.exception.length >= 40, "the recount exception is spelled out");
  ok(/independent|independence/i.test(BLIND_COUNT_DOCTRINE.exception),
    "the recount exception explains that independence is the point");
}
