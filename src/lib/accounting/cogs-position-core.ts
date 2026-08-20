/**
 * src/lib/accounting/cogs-position-core.ts   (books-20)
 *
 * FORM 1125-A, AND THE POSITION BEHIND THE NUMBER ON IT.
 *
 * Roadmap item 4, part 1. Pure functions, integer cents, no I/O, no database.
 * Form 1120-S page 1 and Schedules K, K-1, L, M-1 and M-2 come next, in
 * books-21, and they cannot be built first: line 2 of Form 1120-S is "Cost of
 * goods sold (attach Form 1125-A)", so the return literally cannot be computed
 * until this is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED THE WAY IT IS
 * ---------------------------------------------------------------------------
 *
 * Michael has decided, deliberately and in writing, to keep classifying costs
 * into COGS the way his grandfather has done it for twelve years. He knows it
 * is aggressive. He said so: "Not saying that it is appropriate by statute, but
 * I'd rather beg forgiveness rather than ask permission."
 *
 * That leaves this engine with a genuine design problem, because two obvious
 * designs are both wrong.
 *
 *   REFUSING TO COMPUTE would be wrong. Standing rule 28 gives the owner
 *   executive authority over his own return. He has been told the law, he has
 *   understood it, and he has chosen. A tool that downs tools in protest is a
 *   tool he stops opening, and then he has no records at all, which is worse
 *   for him than an aggressive position that is at least documented.
 *
 *   SILENTLY COMPLYING would also be wrong, and worse. It would make this
 *   system a participant rather than a record-keeper, and it would leave him
 *   with no idea what the exposure actually is in dollars.
 *
 * So the engine does the only honest third thing: it computes the position
 * BOTH WAYS, every time, and puts the difference in front of him in dollars.
 * The conservative computation is what §1.471-3(b) allows a reseller. The
 * as-filed computation is what he has chosen. The gap between them is the
 * amount of deduction at risk, and it is never hidden, never rounded away, and
 * never reported without both numbers beside it.
 *
 * And it requires him to say so ON THE RECORD, per year, with a date and a
 * reason. This is the books-18 principle carried forward: AN UNCHOSEN POSITION
 * IS NOT A CHOSEN POSITION. A default is not a decision. If the acknowledgement
 * for a year is missing, the engine refuses that year — not because the
 * position is wrong, but because nobody has said it is theirs.
 *
 * ---------------------------------------------------------------------------
 * THE PART MICHAEL SPECIFICALLY ASKED FOR
 * ---------------------------------------------------------------------------
 *
 * He asked the system to "properly and aggressively tell me to do it the right
 * way and help me do it the right way," because he expects §280E to end soon
 * and wants to be ready to operate normally. So `adviseOnMethodChange` is not
 * decoration. It is the mechanism: §446(e) consent, Form 3115, the §481(a)
 * cumulative true-up, and the finding that surprises everyone — that filing the
 * form is what BUYS protection for the earlier years, while doing nothing buys
 * none. See `REVPROC_2015_13_AUDIT_PROTECTION`.
 *
 * ---------------------------------------------------------------------------
 * AND WHEN §280E ENDS
 * ---------------------------------------------------------------------------
 *
 * Standing rule 8 says §280E relief must be A SWITCH, NOT A REBUILD. So the
 * sunset is a single dated input, `section280ERepealEffectiveForYearsAfter`,
 * and every consequence flows from it. On the day Congress or the courts end
 * it, somebody sets one field and the whole engine changes behaviour. Nobody
 * rewrites this file under time pressure in April.
 */
import type { StatementRefusal } from "@/lib/accounting/financial-statements-core";
import {
  LAST_SUPPORTED_YEAR,
  SYSTEM_START_YEAR,
} from "@/lib/accounting/s-corporation-year-core";

// ---------------------------------------------------------------------------
// 1) MONEY
// ---------------------------------------------------------------------------

/** Standing rule 4: money is integer cents, always. Never a float. */
export function assertCogsCents(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(
      `INTEGER CENTS VIOLATION: ${label} = ${value}. Money is integer cents in this system; ` +
        `a fractional cent means a float crept in upstream and every later comparison is unsafe.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `UNSAFE INTEGER: ${label} = ${value}. Beyond Number.MAX_SAFE_INTEGER arithmetic silently ` +
        `stops being exact, which is worse than failing.`,
    );
  }
}

/** Cents to a human string. Negatives are parenthesised, as on a return. */
export function formatCents(cents: number): string {
  assertCogsCents(cents, "formatCents input");
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `(${s})` : s;
}

// ---------------------------------------------------------------------------
// 2) REFUSALS
// ---------------------------------------------------------------------------

export type CogsRefusalCode =
  | "NOT_INTEGER_CENTS"
  | "NEGATIVE_AMOUNT"
  | "FISCAL_YEAR_OUT_OF_RANGE"
  | "POSITION_NOT_ELECTED"
  | "POSITION_ACKNOWLEDGEMENT_UNDATED"
  | "POSITION_ACKNOWLEDGEMENT_WRONG_YEAR"
  | "POSITION_ACKNOWLEDGEMENT_NO_REASON"
  | "POSITION_ACKNOWLEDGEMENT_NO_DECIDER"
  | "POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN"
  | "TAXPAYER_ROLE_UNKNOWN"
  | "PRODUCER_CLAIM_CONTRADICTS_STATE_LICENCE"
  | "INVENTORY_NOT_COUNTED"
  | "ENDING_INVENTORY_EXCEEDS_AVAILABLE"
  | "COST_ALLOCATION_UNEXPLAINED"
  | "SECTION_263A_ANSWER_MISSING"
  | "VALUATION_METHOD_MISSING"
  | "QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED"
  | "METHOD_CHANGE_WITHOUT_CONSENT";

export const ALL_COGS_REFUSAL_CODES: readonly CogsRefusalCode[] = [
  "NOT_INTEGER_CENTS",
  "NEGATIVE_AMOUNT",
  "FISCAL_YEAR_OUT_OF_RANGE",
  "POSITION_NOT_ELECTED",
  "POSITION_ACKNOWLEDGEMENT_UNDATED",
  "POSITION_ACKNOWLEDGEMENT_WRONG_YEAR",
  "POSITION_ACKNOWLEDGEMENT_NO_REASON",
  "POSITION_ACKNOWLEDGEMENT_NO_DECIDER",
  "POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN",
  "TAXPAYER_ROLE_UNKNOWN",
  "PRODUCER_CLAIM_CONTRADICTS_STATE_LICENCE",
  "INVENTORY_NOT_COUNTED",
  "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
  "COST_ALLOCATION_UNEXPLAINED",
  "SECTION_263A_ANSWER_MISSING",
  "VALUATION_METHOD_MISSING",
  "QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED",
  "METHOD_CHANGE_WITHOUT_CONSENT",
] as const;

/** Same shape as a statement refusal, narrowed to this slice's codes. */
export type CogsRefusal = Omit<StatementRefusal, "code"> & { code: CogsRefusalCode };

/**
 * DEFECT CORRECTED IN books-21. This used to read:
 *
 *     /** Greenway's first S-corporation year. Matches books-19. *\/
 *     export const FIRST_S_CORP_YEAR = 2026;
 *
 * "Matches books-19" was true and was the problem: it faithfully copied a wrong
 * fact. Greenway has been an S corporation since roughly 2015/2016. What is
 * actually true about 2026 is that it is where these BOOKS start.
 *
 * Nothing in this file needs the election year \u2014 \u00a7471 and \u00a71.61-3 apply to a
 * cannabis reseller whatever its tax classification \u2014 so the range check now
 * uses the honest constant and the false explanation attached to it is gone.
 */
export { SYSTEM_START_YEAR, LAST_SUPPORTED_YEAR };

// ---------------------------------------------------------------------------
// 3) WHO THE TAXPAYER IS UNDER §471, AND WHY IT IS NOT A JUDGMENT CALL
// ---------------------------------------------------------------------------

/**
 * Reseller or producer. This single fact decides which half of §1.471-3
 * applies, and therefore decides everything else in this file.
 *
 * `unknown` is a real and necessary member. Standing rule 1 forbids guessing,
 * and the difference between these two is the difference between "labour is
 * inventoriable" and "labour is dead on arrival under §280E".
 */
export type TaxpayerRole = "reseller" | "producer" | "unknown";

/**
 * Washington cannabis licences held. Facts, not conclusions.
 *
 * These are separate booleans rather than a single enum because a taxpayer can
 * in principle hold more than one licence type — just not, in Washington, a
 * retail licence alongside a production one. That prohibition is the point, and
 * it is enforced below from the statute rather than assumed here.
 */
export type CannabisLicences = {
  readonly holdsRetailLicence: boolean;
  readonly holdsProducerLicence: boolean;
  readonly holdsProcessorLicence: boolean;
};

/**
 * Determine the §471 role FROM THE LICENCES, not from anybody's opinion.
 *
 * RCW 69.50.328: "Neither a licensed cannabis producer nor a licensed cannabis
 * processor shall have a direct or indirect financial interest in a licensed
 * cannabis retailer." So in Washington, holding a retail licence forecloses
 * production as a matter of state law. That makes Greenway a reseller under
 * §1.471-3(b) permanently, not as a matter of degree, and it means the
 * generous producer paragraph §1.471-3(c) is simply unavailable.
 *
 * This is why the answer is computed rather than configured. A field somebody
 * can set to "producer" is a field somebody will eventually set to "producer".
 */
export function determineTaxpayerRole(licences: CannabisLicences): {
  role: TaxpayerRole;
  because: string;
} {
  const { holdsRetailLicence, holdsProducerLicence, holdsProcessorLicence } = licences;

  if (holdsRetailLicence && (holdsProducerLicence || holdsProcessorLicence)) {
    // Not a classification question — a licensing impossibility. Reported as
    // unknown so the caller must resolve the contradiction rather than have
    // this function silently pick a winner.
    return {
      role: "unknown",
      because:
        "The licence facts contradict Washington law: RCW 69.50.328 forbids a licensed producer or " +
        "processor from holding any direct or indirect financial interest in a licensed retailer. " +
        "Both cannot be true at once, so one of these facts is wrong and the role cannot be " +
        "determined until that is fixed.",
    };
  }

  if (holdsRetailLicence) {
    return {
      role: "reseller",
      because:
        "Greenway holds a Washington retail licence and, under RCW 69.50.328, cannot hold or have an " +
        "interest in a producer or processor licence. It therefore buys finished goods and resells " +
        "them, which is the §1.471-3(b) reseller case. The producer rules in §1.471-3(c) are not " +
        "available and never will be while the retail licence is held.",
    };
  }

  if (holdsProducerLicence || holdsProcessorLicence) {
    return {
      role: "producer",
      because:
        "A producer or processor licence is held and no retail licence is. §1.471-3(c) governs, which " +
        "does allow direct labour and indirect production costs into inventory.",
    };
  }

  return {
    role: "unknown",
    because:
      "No cannabis licence is recorded. Which paragraph of §1.471-3 applies cannot be determined " +
      "without knowing what the business actually does, and guessing would decide the entire COGS " +
      "position by accident.",
  };
}

// ---------------------------------------------------------------------------
// 4) THE POSITION, AND THE REQUIREMENT THAT SOMEBODY OWN IT
// ---------------------------------------------------------------------------

/**
 * Which COGS computation goes on the return.
 *
 * `conservative` is what §1.471-3(b) plainly allows a reseller. `as_filed` is
 * the historical treatment Michael has chosen to continue. There is no third
 * option and no default: see `PositionElection`.
 */
export type CogsPosition = "conservative" | "as_filed";

/**
 * An owner's dated, reasoned, per-year choice of position.
 *
 * WHY EVERY FIELD IS REQUIRED.
 *
 * This is not paperwork for its own sake. If this position is ever examined,
 * the question will not only be "was it right" but "who decided, when, and
 * knowing what". A contemporaneous record that the owner was advised of the
 * conservative computation and consciously chose otherwise is materially
 * better for him than a silence that looks like nobody ever thought about it.
 * It is also the difference between a position and an oversight, which is the
 * difference that matters most when penalties are being discussed.
 *
 * `acknowledgedConservativeAmountCents` exists so the record proves he was
 * shown the actual alternative number, not merely warned in the abstract.
 */
export type PositionElection = {
  readonly fiscalYear: number;
  readonly position: CogsPosition;
  /** ISO date the owner made this choice. Not the filing date. */
  readonly decidedOnIso: string;
  /** Who decided. A name, because "the system" cannot elect a tax position. */
  readonly decidedBy: string;
  /** Why, in the owner's own words. */
  readonly reason: string;
  /** The conservative number he was shown when he decided, in cents. */
  readonly acknowledgedConservativeAmountCents: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the election. Refuses rather than warns (standing rule 27).
 *
 * Note what is NOT refused: choosing `as_filed`. That is the owner's call and
 * this function does not second-guess it. What is refused is choosing it
 * WITHOUT a date, WITHOUT a name, WITHOUT a reason, or for the wrong year —
 * because each of those turns a decision back into a default.
 */
export function validatePositionElection(
  election: PositionElection | null,
  fiscalYear: number,
): readonly CogsRefusal[] {
  const out: CogsRefusal[] = [];

  if (election === null) {
    out.push({
      code: "POSITION_NOT_ELECTED",
      message:
        `No COGS position has been chosen for ${fiscalYear}. This system computes the cost of goods ` +
        `sold two ways — the conservative reseller computation that §1.471-3(b) plainly allows, and ` +
        `the treatment carried forward from prior years — and it will not pick one for you.`,
      whatToDo:
        "Open the COGS position screen for this year, read both numbers and the gap between them, and " +
        "record which one goes on the return, who decided, and why. Last year's answer does not carry " +
        "forward automatically and is not supposed to: an unchosen position is not a chosen position.",
      authorityIds: ["REG_1_471_3_B_RESELLER", "IRC_280E", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
      });
    return out;
  }

  if (election.fiscalYear !== fiscalYear) {
    out.push({
      code: "POSITION_ACKNOWLEDGEMENT_WRONG_YEAR",
      message:
        `The COGS position on file is dated for ${election.fiscalYear}, but this return is for ` +
        `${fiscalYear}. A position elected for one year is not evidence of a decision about another.`,
      whatToDo:
        `Record a position for ${fiscalYear} specifically. If the answer is the same as ` +
        `${election.fiscalYear}, that is fine — but say so this year, with this year's numbers in ` +
        `front of you, because this year's numbers are different.`,
      authorityIds: ["REG_1_471_2_B_CONSISTENCY_WEIGHT"],
    });
  }

  if (!ISO_DATE.test(election.decidedOnIso)) {
    out.push({
      code: "POSITION_ACKNOWLEDGEMENT_UNDATED",
      message:
        `The COGS position for ${fiscalYear} has no usable decision date (got ` +
        `"${election.decidedOnIso}"). An undated acknowledgement cannot show the decision was made ` +
        `before the return was filed rather than reconstructed afterwards.`,
      whatToDo:
        "Record the actual calendar date the decision was made, as YYYY-MM-DD. If that date is not " +
        "known, the honest thing is to make the decision again today and date it today.",
      authorityIds: ["IRC_446_F_NO_SHELTER"],
    });
  }

  if (election.reason.trim().length < 10) {
    out.push({
      code: "POSITION_ACKNOWLEDGEMENT_NO_REASON",
      message:
        `The COGS position for ${fiscalYear} has no stated reason. "Because we always have" is a ` +
        `reason and is acceptable here; an empty box is not, because it leaves no evidence that ` +
        `anyone considered the question at all.`,
      whatToDo:
        "Write one or two sentences saying why this position was chosen. Plain words are fine. The " +
        "point is that a human being thought about it on a particular day and said so.",
      authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
    });
  }

  if (election.decidedBy.trim().length === 0) {
    out.push({
      code: "POSITION_ACKNOWLEDGEMENT_NO_DECIDER",
      message:
        `The COGS position for ${fiscalYear} does not say who decided it. A tax position belongs to a ` +
        `person, not to a piece of software.`,
      whatToDo: "Record the name of the person who made this call.",
      authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
    });
  }

  if (
    election.position === "as_filed" &&
    election.acknowledgedConservativeAmountCents === null
  ) {
    out.push({
      code: "POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN",
      message:
        `The ${fiscalYear} election chooses the historical treatment but does not record the ` +
        `conservative figure that was on screen when the choice was made. Without it there is no ` +
        `evidence the alternative was actually seen.`,
      whatToDo:
        "Re-open the position screen and confirm the choice with both numbers displayed, so the record " +
        "shows what was known at the time.",
      authorityIds: ["REG_1_471_3_B_RESELLER"],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 5) THE FORM ITSELF
// ---------------------------------------------------------------------------

/**
 * Inventory valuation method, Form 1125-A line 9a.
 *
 * Taken from the form as published (Rev. November 2024), not from memory.
 */
export type ValuationMethod =
  | "cost"
  | "lower_of_cost_or_market"
  | "other"
  | "non_incidental_materials_and_supplies"
  | "afs_section_471_c"
  | "non_afs_section_471_c";

/**
 * A single cost bucket feeding COGS, tagged with how defensible it is.
 *
 * `direct` costs are ones §1.471-3(b) names outright for a reseller: the
 * invoice price of merchandise, and transportation or other charges incurred in
 * acquiring possession. `allocable` costs are the contested ones — the payroll
 * and overhead that the grandfather's method routes into COGS and that a
 * reseller reading §1.471-3(b) literally would not.
 *
 * The tag is what makes standing rule 8 achievable. Because every contested
 * dollar is labelled at the point of entry, changing the position later is a
 * query, not an archaeology project.
 */
export type CostBucket = {
  readonly label: string;
  readonly amountCents: number;
  /** `direct` = named in §1.471-3(b). `allocable` = the contested treatment. */
  readonly character: "direct" | "allocable";
  /**
   * For allocable costs: how the amount was arrived at. Required, because an
   * allocation with no stated basis is indistinguishable from a plug, and
   * standing rule 12 forbids silent plugs.
   */
  readonly allocationBasis: string | null;
};

/**
 * Everything needed to fill in Form 1125-A and to judge the position.
 *
 * Line numbers below are from Form 1125-A (Rev. November 2024) as published by
 * the IRS. They were read off the form, not recalled.
 */
export type CogsYearInput = {
  readonly fiscalYear: number;
  readonly licences: CannabisLicences;

  /** Line 1. Inventory at beginning of year. */
  readonly beginningInventoryCents: number;
  /** Line 2. Purchases. */
  readonly purchasesCents: number;

  /**
   * Lines 3 and 5, decomposed. Cost of labor and other costs arrive here as
   * tagged buckets rather than as two totals, so the contested portion is
   * visible instead of buried inside a subtotal.
   */
  readonly costBuckets: readonly CostBucket[];

  /** Line 4. Additional §263A costs. */
  readonly additionalSection263ACostsCents: number;
  /** Line 7. Inventory at end of year. */
  readonly endingInventoryCents: number;

  /** Line 9a. Null means unanswered, which is refused, not defaulted. */
  readonly valuationMethod: ValuationMethod | null;
  /** Line 9e. Whether §263A applies. Null means unanswered. */
  readonly section263AApplies: boolean | null;
  /**
   * Line 9f. Was there any change in determining quantities, cost, or
   * valuations between opening and closing inventory? Null means unanswered.
   */
  readonly changeInQuantitiesCostOrValuations: boolean | null;
  /** If line 9f is yes, the form demands an explanation. */
  readonly changeExplanation: string | null;

  /**
   * Was ending inventory established by a physical count? §1.471-2(d) and the
   * books-10 inventory auditor both turn on this.
   */
  readonly endingInventoryWasCounted: boolean | null;

  /** The owner's dated election for this year. Null means not yet chosen. */
  readonly positionElection: PositionElection | null;

  /**
   * The position actually USED on last year's filed return, and whether the
   * consent \u00a7446(e) requires has been obtained for a change away from it.
   *
   * WHY THIS IS IN THE INPUT AT ALL.
   *
   * \u00a7446(e) says a taxpayer who changes his method of accounting shall,
   * BEFORE computing taxable income under the new method, secure the consent
   * of the Secretary. Switching which costs go into inventory is a change in
   * method \u2014 \u00a71.446-1(e)(2)(ii)(a) names a change in the basis used in
   * valuing inventories explicitly. So the single most dangerous thing this
   * screen could do is let the owner quietly tick "conservative" this year
   * after twelve years of "as filed" and file it, believing he has finally
   * done the right thing, when what he has actually done is make an
   * unauthorised change of method with no audit protection and no \u00a7481(a)
   * adjustment.
   *
   * `priorYearPosition` is null only for the first year on the system, where
   * there is no prior year to change away from.
   */
  readonly priorYearPosition: CogsPosition | null;

  /**
   * Has consent for a change of method been secured \u2014 in practice, a Form
   * 3115 filed under the automatic change procedures? Null means unknown,
   * which is treated as "not yet", because \u00a7446(e) requires consent BEFORE
   * and an unknown is not a yes.
   */
  readonly form3115FiledForChange: boolean | null;

  /**
   * STANDING RULE 8: THE SWITCH.
   *
   * The last fiscal year for which §280E still restricts this taxpayer. Once
   * rescheduling or repeal happens, set this to that final year and every
   * consequence below follows automatically. `null` means §280E is still in
   * force indefinitely, which is the position today.
   */
  readonly section280ERepealEffectiveForYearsAfter: number | null;
};

/** One computed line of Form 1125-A. */
export type FormLine = {
  readonly line: string;
  readonly caption: string;
  readonly amountCents: number;
};

/** A complete Form 1125-A computation under ONE position. */
export type Form1125A = {
  readonly position: CogsPosition;
  readonly lines: readonly FormLine[];
  /** Line 8. Cost of goods sold. Flows to Form 1120-S, page 1, line 2. */
  readonly costOfGoodsSoldCents: number;
};

// ---------------------------------------------------------------------------
// 6) VALIDATION
// ---------------------------------------------------------------------------

/**
 * Check the inputs before computing anything.
 *
 * Every refusal here names the authority that makes the missing fact matter and
 * says what to go and find. A refusal without a remedy is a dead end.
 */
export function validateCogsInput(input: CogsYearInput): readonly CogsRefusal[] {
  const out: CogsRefusal[] = [];

  if (
    !Number.isInteger(input.fiscalYear) ||
    input.fiscalYear < SYSTEM_START_YEAR ||
    input.fiscalYear > LAST_SUPPORTED_YEAR
  ) {
    out.push({
      code: "FISCAL_YEAR_OUT_OF_RANGE",
      message:
        `Fiscal year ${input.fiscalYear} is outside the supported range ` +
        `${SYSTEM_START_YEAR}-${LAST_SUPPORTED_YEAR}.`,
      // books-21 rewrote this remedy. It used to say "Greenway's S election
      // takes effect in 2026; earlier years were filed by the LLC under
      // different rules". Both halves were false \u2014 the election is a decade
      // older, and the earlier years were filed on Forms 1120-S under these
      // same rules. What is true is only a statement about this software.
      whatToDo:
        `${SYSTEM_START_YEAR} is where these books start, so it is the earliest year this engine ` +
        `computes. Earlier years were filed already and are not recomputed here.`,
      authorityIds: [],
    });
    // Everything below is year-dependent. Stop rather than emit noise.
    return out;
  }

  const moneyFields: Array<[string, number]> = [
    ["beginning inventory", input.beginningInventoryCents],
    ["purchases", input.purchasesCents],
    ["additional §263A costs", input.additionalSection263ACostsCents],
    ["ending inventory", input.endingInventoryCents],
  ];
  for (const [label, value] of moneyFields) {
    if (!Number.isInteger(value)) {
      out.push({
        code: "NOT_INTEGER_CENTS",
        message: `${label} is ${value}, which is not a whole number of cents.`,
        whatToDo:
          "Money in this system is integer cents. A fraction here means a float was introduced " +
          "upstream and every comparison after this point is unreliable.",
        authorityIds: [],
      });
    } else if (value < 0) {
      out.push({
        code: "NEGATIVE_AMOUNT",
        message: `${label} is ${formatCents(value)}. None of the Form 1125-A inputs can be negative.`,
        whatToDo:
          "Find the entry that made this negative. A credit posted to the wrong side will do it, and " +
          "so will a return recorded as a negative purchase instead of a reduction.",
        authorityIds: ["REG_1_471_1_A_INVENTORIES_REQUIRED"],
      });
    }
  }

  for (const b of input.costBuckets) {
    if (!Number.isInteger(b.amountCents)) {
      out.push({
        code: "NOT_INTEGER_CENTS",
        message: `Cost bucket "${b.label}" is ${b.amountCents}, which is not a whole number of cents.`,
        whatToDo: "Money in this system is integer cents.",
        authorityIds: [],
      });
      continue;
    }
    if (b.amountCents < 0) {
      out.push({
        code: "NEGATIVE_AMOUNT",
        message: `Cost bucket "${b.label}" is ${formatCents(b.amountCents)}.`,
        whatToDo: "A cost bucket cannot be negative. Find the posting that reversed it.",
        authorityIds: [],
      });
    }
    if (b.character === "allocable" && (b.allocationBasis ?? "").trim().length === 0) {
      out.push({
        code: "COST_ALLOCATION_UNEXPLAINED",
        message:
          `Cost bucket "${b.label}" (${formatCents(b.amountCents)}) is being allocated into cost of ` +
          `goods sold, but no basis for the allocation is recorded.`,
        whatToDo:
          "State how the amount was arrived at — hours, square footage, headcount, or whatever was " +
          "actually used. An allocation nobody can explain is indistinguishable from a made-up number, " +
          "and this is precisely the kind of figure an examiner asks about first.",
        authorityIds: ["ALTERMAN_COGS_FORMULA", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
      });
    }
  }

  const role = determineTaxpayerRole(input.licences);
  if (role.role === "unknown") {
    out.push({
      code: input.licences.holdsRetailLicence
        ? "PRODUCER_CLAIM_CONTRADICTS_STATE_LICENCE"
        : "TAXPAYER_ROLE_UNKNOWN",
      message: role.because,
      whatToDo:
        "Record which Washington cannabis licences this entity actually holds. Everything in this " +
        "computation depends on whether §1.471-3(b) or §1.471-3(c) applies, and that is decided by " +
        "the licence, not by preference.",
      authorityIds: ["RCW_69_50_328_NO_CROSS_OWNERSHIP", "REG_1_471_3_B_RESELLER"],
    });
  }

  if (input.endingInventoryWasCounted !== true) {
    out.push({
      code: "INVENTORY_NOT_COUNTED",
      message:
        input.endingInventoryWasCounted === null
          ? "Nobody has said whether ending inventory was established by a physical count."
          : "Ending inventory was not established by a physical count.",
      whatToDo:
        "Count it. Ending inventory is subtracted on line 7 and therefore reduces cost of goods sold " +
        "dollar for dollar — an ending inventory that is too high understates COGS and overstates " +
        "income, and one that is too low does the reverse. A figure carried from the system without a " +
        "count is an estimate wearing a number's clothing.",
      authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT", "REG_1_471_1_A_INVENTORIES_REQUIRED"],
    });
  }

  if (input.valuationMethod === null) {
    out.push({
      code: "VALUATION_METHOD_MISSING",
      message: "Form 1125-A line 9a asks which method was used to value closing inventory, and it is unanswered.",
      whatToDo:
        "Choose the method actually used — for Greenway this is normally cost. The form requires a " +
        "box to be ticked, and the answer must match what the books actually do rather than what " +
        "sounds best.",
      authorityIds: ["REG_1_471_2_A_TWO_TESTS"],
    });
  }

  if (input.section263AApplies === null) {
    out.push({
      code: "SECTION_263A_ANSWER_MISSING",
      message: "Form 1125-A line 9e asks whether the §263A uniform capitalization rules apply, and it is unanswered.",
      whatToDo:
        "Answer it. The question is on the form and leaving it blank is itself a filing defect, " +
        "separate from whatever the right answer turns out to be.",
      authorityIds: ["REG_1_471_3_F_DISALLOWED"],
    });
  }

  if (input.changeInQuantitiesCostOrValuations === null) {
    out.push({
      code: "QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED",
      message:
        "Form 1125-A line 9f asks whether there was any change in determining quantities, cost, or " +
        "valuations between opening and closing inventory, and it is unanswered.",
      whatToDo:
        "Answer yes or no. This line matters far more than its size suggests: a change here is often " +
        "a change in method of accounting, which needs consent under §446(e) before it is used.",
      authorityIds: ["REG_1_446_1_E_2_II_A_INVENTORY_VALUATION", "IRC_446_E_CONSENT_REQUIRED"],
    });
  } else if (
    input.changeInQuantitiesCostOrValuations &&
    (input.changeExplanation ?? "").trim().length === 0
  ) {
    out.push({
      code: "QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED",
      message:
        "Line 9f is answered yes, but no explanation is attached. The form says: \"If 'Yes,' attach " +
        "explanation.\"",
      whatToDo:
        "Write the explanation. Then, before filing, check whether what changed is a change in method " +
        "of accounting rather than a change in facts — §1.446-1(e)(2)(ii)(a) lists a change in the " +
        "basis used in valuing inventories as a method change, and a method change needs consent FIRST.",
      authorityIds: [
        "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
        "IRC_446_E_CONSENT_REQUIRED",
        "REG_1_446_1_E_2_I_PROPER_OR_NOT",
      ],
    });
  }

  // Line 7 is subtracted from line 6. If closing inventory exceeds everything
  // that was available to sell, cost of goods sold goes NEGATIVE \u2014 which is
  // not a low number, it is an impossible one. It means the company sold goods
  // at a negative cost, and it always signals a real-world error: a count that
  // swept in consigned or customer-owned goods, a double-counted vault, an
  // opening balance that was never entered, or purchases posted to the wrong
  // year.
  //
  // The test uses the CONSERVATIVE cost pool deliberately. That pool is the
  // smaller of the two, so it is the binding constraint: if closing inventory
  // exceeds even the as-filed pool the conservative test has already fired,
  // and using the larger pool would let an impossible conservative figure
  // through whenever the allocable buckets happened to paper over it.
  {
    const conservativePool =
      input.beginningInventoryCents +
      input.purchasesCents +
      input.costBuckets
        .filter((b) => b.character === "direct")
        .reduce((n, b) => n + b.amountCents, 0) +
      input.additionalSection263ACostsCents;

    if (input.endingInventoryCents > conservativePool) {
      out.push({
        code: "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
        message:
          `Closing inventory of ${formatCents(input.endingInventoryCents)} is larger than everything ` +
          `available to sell during ${input.fiscalYear}, which on the conservative computation is ` +
          `${formatCents(conservativePool)}. That would make cost of goods sold negative, and a ` +
          `negative cost of goods sold is not a small number \u2014 it is an impossible one.`,
        whatToDo:
          "Do not adjust a number to make this go away. One of the inputs is wrong, and it is worth " +
          "finding out which: the usual causes are a physical count that included goods Greenway does " +
          "not own, a vault counted twice, an opening inventory that was never entered, or purchases " +
          "posted into the wrong year. Fix the input that is actually wrong, then run this again.",
        authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT", "REG_1_471_1_A_INVENTORIES_REQUIRED"],
      });
    }
  }

  // \u00a7446(e): consent BEFORE computing income under the new method.
  //
  // Note carefully which direction this fires in. It fires on ANY change of
  // position, including the change TOWARDS the conservative treatment. That is
  // not the system being obstructive about doing the right thing \u2014 it is the
  // system making sure the right thing is done the right way. Simply starting
  // to do it correctly next year, with no Form 3115, is itself a violation of
  // \u00a7446(e), it forfeits the audit protection of Rev. Proc. 2015-13 \u00a78.01
  // that is available on a voluntary change, and it leaves the \u00a7481(a)
  // adjustment for the earlier years unaddressed.
  if (
    input.positionElection !== null &&
    input.priorYearPosition !== null &&
    input.positionElection.position !== input.priorYearPosition &&
    input.form3115FiledForChange !== true
  ) {
    const toward =
      input.positionElection.position === "conservative"
        ? "toward the conservative computation"
        : "away from the conservative computation";
    out.push({
      code: "METHOD_CHANGE_WITHOUT_CONSENT",
      message:
        `Last year's return used the ${input.priorYearPosition === "as_filed" ? "historical" : "conservative"} ` +
        `treatment and this year's election moves ${toward}. Changing which costs go into inventory is a ` +
        `change in method of accounting, and \u00a7446(e) requires the Secretary's consent BEFORE income is ` +
        `computed under the new method. No Form 3115 is recorded` +
        `${input.form3115FiledForChange === null ? " and it is not known whether one was filed" : ""}.`,
      whatToDo:
        "Do not simply file the new number. Even when the change is towards the more conservative " +
        "treatment \u2014 especially then \u2014 it must go on a Form 3115 with a \u00a7481(a) adjustment for the " +
        "earlier years. Filed voluntarily, before the IRS raises the issue, that form also carries the " +
        "audit protection of Rev. Proc. 2015-13 \u00a78.01 for every earlier year. Start it correctly and " +
        "the old years are closed; start it quietly and they stay open.",
      authorityIds: [
        "IRC_446_E_CONSENT_REQUIRED",
        "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
        "IRC_481_A_ADJUSTMENT",
        "REVPROC_2015_13_AUDIT_PROTECTION",
      ],
    });
  }

  out.push(...validatePositionElection(input.positionElection, input.fiscalYear));

  return out;
}

// ---------------------------------------------------------------------------
// 7) COMPUTING THE FORM, BOTH WAYS
// ---------------------------------------------------------------------------

/**
 * Which cost buckets ride into COGS under a given position.
 *
 * Under `conservative`, only `direct` buckets do, because §1.471-3(b) names the
 * invoice price and the charges of acquiring possession and names nothing else.
 * Under `as_filed`, the allocable buckets ride too.
 *
 * WHAT THE §280E SUNSET DOES *NOT* DO, AND WHY THIS FUNCTION IGNORES IT.
 *
 * An earlier version of this function returned every bucket once §280E no
 * longer applied, on the theory that the two computations should converge. That
 * was wrong, and it was wrong in the most dangerous possible direction: it
 * quietly changed the CONSERVATIVE number — the one that is supposed to be the
 * honest §1.471-3(b) answer — into something §1.471-3(b) does not permit. The
 * gap went to zero not because the exposure had gone away but because the
 * yardstick had been bent.
 *
 * The two provisions are independent, and the sources say so plainly. §280E
 * denies "deduction or credit" and says nothing whatever about inventories.
 * §1.471-3 never mentions §280E. So repealing §280E does not make a budtender's
 * wages inventoriable; it makes them DEDUCTIBLE under §162 instead of
 * disallowed. What is or is not a cost of goods sold is decided by §471 before
 * §280E is ever reached, and it stays decided afterwards.
 *
 * The sunset therefore belongs where its consequence actually lands — in what
 * the gap MEANS, which is `comparePositions` — not in what the law allows into
 * inventory, which is here and does not move.
 */
export function bucketsForPosition(
  input: CogsYearInput,
  position: CogsPosition,
): readonly CostBucket[] {
  if (position === "as_filed") return input.costBuckets;
  return input.costBuckets.filter((b) => b.character === "direct");
}

/** Whether §280E still bites for this input's year. The switch, read. */
export function section280EAppliesTo(input: CogsYearInput): boolean {
  const sunset = input.section280ERepealEffectiveForYearsAfter;
  if (sunset === null) return true;
  return input.fiscalYear <= sunset;
}

/**
 * Build Form 1125-A under one position.
 *
 * Line structure is Form 1125-A (Rev. November 2024):
 *   1  Inventory at beginning of year
 *   2  Purchases
 *   3  Cost of labor
 *   4  Additional section 263A costs
 *   5  Other costs
 *   6  Total: add lines 1 through 5
 *   7  Inventory at end of year
 *   8  Cost of goods sold: line 6 less line 7
 */
export function computeForm1125A(input: CogsYearInput, position: CogsPosition): Form1125A {
  const buckets = bucketsForPosition(input, position);

  const isLabor = (b: CostBucket): boolean => /labor|labour|wage|payroll|salar/i.test(b.label);

  const laborCents = buckets.filter(isLabor).reduce((s, b) => s + b.amountCents, 0);
  const otherCents = buckets.filter((b) => !isLabor(b)).reduce((s, b) => s + b.amountCents, 0);

  const line1 = input.beginningInventoryCents;
  const line2 = input.purchasesCents;
  const line3 = laborCents;
  const line4 = input.additionalSection263ACostsCents;
  const line5 = otherCents;
  const line6 = line1 + line2 + line3 + line4 + line5;
  const line7 = input.endingInventoryCents;
  const line8 = line6 - line7;

  assertCogsCents(line6, "Form 1125-A line 6");
  assertCogsCents(line8, "Form 1125-A line 8");

  return {
    position,
    lines: [
      { line: "1", caption: "Inventory at beginning of year", amountCents: line1 },
      { line: "2", caption: "Purchases", amountCents: line2 },
      { line: "3", caption: "Cost of labor", amountCents: line3 },
      { line: "4", caption: "Additional section 263A costs", amountCents: line4 },
      { line: "5", caption: "Other costs", amountCents: line5 },
      { line: "6", caption: "Total. Add lines 1 through 5", amountCents: line6 },
      { line: "7", caption: "Inventory at end of year", amountCents: line7 },
      { line: "8", caption: "Cost of goods sold. Subtract line 7 from line 6", amountCents: line8 },
    ],
    costOfGoodsSoldCents: line8,
  };
}

// ---------------------------------------------------------------------------
// 8) THE GAP — THE NUMBER MICHAEL ACTUALLY NEEDS TO SEE
// ---------------------------------------------------------------------------

/** What the chosen position costs or saves versus the conservative one. */
export type PositionComparison = {
  readonly conservative: Form1125A;
  readonly asFiled: Form1125A;
  /** As-filed COGS minus conservative COGS. Positive = more COGS claimed. */
  readonly additionalCogsClaimedCents: number;
  /** The allocable dollars driving the gap, itemised. */
  readonly contestedBuckets: readonly CostBucket[];
  /** Whether §280E still makes the gap consequential in this year. */
  readonly section280EApplies: boolean;
  /** Plain-English statement of what the gap means. Never omitted. */
  readonly plainEnglish: string;
};

/**
 * Compare the two computations and say, in dollars, what is at stake.
 *
 * This function is the reason the slice exists. It never returns only the
 * chosen number: both are always present, and so is the difference. Michael can
 * decide whatever he likes, but he cannot accidentally not know.
 */
export function comparePositions(input: CogsYearInput): PositionComparison {
  const conservative = computeForm1125A(input, "conservative");
  const asFiled = computeForm1125A(input, "as_filed");
  const gap = asFiled.costOfGoodsSoldCents - conservative.costOfGoodsSoldCents;
  const contested = input.costBuckets.filter((b) => b.character === "allocable");
  const applies = section280EAppliesTo(input);

  let plainEnglish: string;
  if (!applies) {
    plainEnglish =
      `§280E no longer applies for ${input.fiscalYear}, and that changes what this gap MEANS without ` +
      `changing the gap itself. The two computations still differ by ${formatCents(Math.abs(gap))}, ` +
      `because §1.471-3(b) still says what a reseller may put into inventory and repealing §280E did ` +
      `not amend it. What has changed is the consequence. Those contested dollars are no longer at ` +
      `risk of disappearing: if they do not belong in cost of goods sold, they are now deductible as ` +
      `ordinary and necessary business expenses under §162 instead. So this has stopped being a ` +
      `question of WHETHER the money counts and become a question of WHEN — inventory waits until the ` +
      `goods are sold, a deduction does not. That is a real difference, and worth getting right, but ` +
      `it is a timing difference rather than a permanent loss. Note also that moving those costs out ` +
      `of inventory now would itself be a change in method of accounting, so it goes through §446(e) ` +
      `and Form 3115 like any other.`;
  } else if (gap === 0) {
    plainEnglish =
      `Both computations give the same cost of goods sold for ${input.fiscalYear}: ` +
      `${formatCents(conservative.costOfGoodsSoldCents)}. There are no contested dollars this year, ` +
      `so there is nothing at risk on this issue.`;
  } else {
    plainEnglish =
      `For ${input.fiscalYear} the return as you intend to file it claims ` +
      `${formatCents(asFiled.costOfGoodsSoldCents)} of cost of goods sold. A reseller applying ` +
      `§1.471-3(b) strictly would claim ${formatCents(conservative.costOfGoodsSoldCents)}. The ` +
      `difference is ${formatCents(Math.abs(gap))}, made up of ${contested.length} cost ` +
      `${contested.length === 1 ? "bucket" : "buckets"} that the strict reading would leave out. ` +
      `Because §280E is in force, that difference is not merely a timing question: if the treatment ` +
      `were successfully challenged, those dollars would not move to a later year, they would ` +
      `disappear as deductions entirely, and tax would be owed on them plus interest and possibly ` +
      `penalties. That is the exposure, stated in dollars, so it can be weighed instead of guessed at.`;
  }

  return {
    conservative,
    asFiled,
    additionalCogsClaimedCents: gap,
    contestedBuckets: contested,
    section280EApplies: applies,
    plainEnglish,
  };
}

// ---------------------------------------------------------------------------
// 9) HOW TO DO IT PROPERLY — THE PART HE ASKED FOR BY NAME
// ---------------------------------------------------------------------------

/** Facts needed before advising on a method change. Unknowns are not guessed. */
export type MethodChangeFacts = {
  /** Years the current treatment has been used consistently. */
  readonly yearsTreatmentUsedConsistently: number;
  /** Is the taxpayer currently under IRS examination? Null = unknown. */
  readonly underExamination: boolean | null;
  /** Has the COGS treatment been raised by the IRS as an issue? Null = unknown. */
  readonly cogsRaisedByIrs: boolean | null;
  /**
   * Cumulative difference between the treatment used and the correct one,
   * in cents, positive meaning taxable income would INCREASE on correction.
   * Null when it has not been computed yet.
   */
  readonly cumulativeDifferenceCents: number | null;
};

/** One step of the correction path, with the authority that requires it. */
export type MethodChangeStep = {
  readonly step: number;
  readonly what: string;
  readonly why: string;
  readonly authorityIds: readonly string[];
};

export type MethodChangeAdvice = {
  /** Is this a METHOD (Form 3115) or an ERROR (just fix it)? */
  readonly isMethodNotError: boolean;
  /** Would audit protection for prior years be available today? */
  readonly auditProtectionLikelyAvailable: boolean | null;
  /** Adjustment period in years, or null if the amount is unknown. */
  readonly adjustmentPeriodYears: number | null;
  /** Is the one-year de minimis election available? */
  readonly deMinimisElectionAvailable: boolean | null;
  readonly steps: readonly MethodChangeStep[];
  /** The argument for correcting, in plain English. Deliberately forceful. */
  readonly theCase: string;
  readonly authorityIds: readonly string[];
};

/**
 * Tell the owner how to move to the correct treatment, and why he should.
 *
 * MICHAEL ASKED FOR THIS EXPLICITLY: "I do still want verbatim text that
 * strongly suggests I follow proper code conduct, and tells me why and how to
 * do it properly by law." This is the how. The why is in `theCase`, and it is
 * argued from his own interest rather than from principle, because an argument
 * from principle has already been made and has already been considered.
 *
 * The single most important thing this function knows is that the intuition is
 * backwards. Filing Form 3115 is not raising a hand and inviting scrutiny of
 * the past — Rev. Proc. 2015-13 §8.01 is an undertaking by the IRS NOT to
 * reach back on that item. Silence is the exposed position, not the safe one.
 */
export function adviseOnMethodChange(facts: MethodChangeFacts): MethodChangeAdvice {
  // §1.446-1(e)(2)(ii)(a): consistent treatment of a material item is what
  // makes something a method rather than an error. Two years is the threshold
  // §481(b)(1) itself uses when it talks about a method having been "used".
  const isMethodNotError = facts.yearsTreatmentUsedConsistently >= 2;

  // §8.01 gives protection; §8.02(1) removes it for a taxpayer under
  // examination; §8.02(7) removes it where the item is already an issue under
  // consideration. Unknown facts produce null, never a cheerful guess.
  const auditProtectionLikelyAvailable =
    facts.underExamination === null || facts.cogsRaisedByIrs === null
      ? null
      : !facts.underExamination && !facts.cogsRaisedByIrs;

  // §7.03(1): four years for a positive adjustment, one for a negative.
  // §7.03(3)(c): one year available by election if a positive adjustment is
  // less than $50,000.
  const DE_MINIMIS_CEILING_CENTS = 50_000_00;
  const diff = facts.cumulativeDifferenceCents;
  const deMinimisElectionAvailable =
    diff === null ? null : diff > 0 && diff < DE_MINIMIS_CEILING_CENTS;
  const adjustmentPeriodYears = diff === null ? null : diff <= 0 ? 1 : 4;

  const steps: MethodChangeStep[] = [
    {
      step: 1,
      what:
        "Establish that this is a change in method of accounting, not the correction of an error. " +
        (isMethodNotError
          ? `It is: the treatment has been applied consistently for ` +
            `${facts.yearsTreatmentUsedConsistently} years, and consistent treatment of a material ` +
            `item is exactly what the regulation calls a method.`
          : `On the facts given it may not be — only ` +
            `${facts.yearsTreatmentUsedConsistently} year(s) of consistent use is recorded, and a ` +
            `single year's treatment may still be an error that can simply be corrected.`),
      why:
        "The two paths are completely different. An error is corrected and the story ends. A method " +
        "can only be left through §446(e) consent, and leaving one without consent is a separate " +
        "problem on top of the original one.",
      authorityIds: ["REG_1_446_1_E_2_II_A_IS_A_METHOD", "REG_1_446_1_E_2_II_B_NOT_A_METHOD"],
    },
    {
      step: 2,
      what:
        "Do NOT simply start doing it correctly next year. Consent must be secured BEFORE income is " +
        "computed on the new method.",
      why:
        "§446(e) says 'before'. And §1.446-1(e)(2)(i) closes the obvious escape hatch: consent is " +
        "required whether or not the old method was proper. Being wrong does not release you from the " +
        "procedure — it is the reason you are in it.",
      authorityIds: ["IRC_446_E_CONSENT_REQUIRED", "REG_1_446_1_E_2_I_PROPER_OR_NOT"],
    },
    {
      step: 3,
      what:
        "Compute the §481(a) adjustment: the single cumulative number that reconciles every prior " +
        "year, so that no dollar is counted twice and none is missed.",
      why:
        "This is the step that usually removes the fear. You do not amend twelve years of returns. " +
        "You compute one number and report it in the year of change.",
      authorityIds: ["IRC_481_A_ADJUSTMENT"],
    },
    {
      step: 4,
      what:
        "File Form 3115 with a timely filed return for the year of change, and check whether the " +
        "specific change appears in the current List of Automatic Changes.",
      why:
        "Most changes are automatic, which means consent is granted by the revenue procedure itself " +
        "rather than by a private ruling. But §8.02(2) warns that some published changes carry no " +
        "audit protection, and the only way to know is to read the description of the change in force " +
        "when you file.",
      authorityIds: ["REVPROC_2015_13_AUDIT_PROTECTION", "REVPROC_2015_13_PROTECTION_NOT_UNIVERSAL"],
    },
    {
      step: 5,
      what:
        adjustmentPeriodYears === null
          ? "Decide how to take the adjustment into account once its size is known."
          : adjustmentPeriodYears === 1
            ? "Take the whole adjustment into account in the year of change."
            : `Spread the adjustment over ${adjustmentPeriodYears} years` +
              (deMinimisElectionAvailable
                ? ", or elect the one-year de minimis treatment since it is under $50,000."
                : "."),
      why:
        "A negative adjustment — one in your favour — is taken in a single year. A positive one is " +
        "spread over four, which exists precisely so that correcting yourself does not create a cash " +
        "crisis. Under $50,000 you may elect to finish it in one year instead.",
      authorityIds: ["REVPROC_2015_13_ADJUSTMENT_PERIOD", "REVPROC_2015_13_DE_MINIMIS"],
    },
  ];

  const protectionSentence =
    auditProtectionLikelyAvailable === null
      ? "Whether prior-year audit protection is available cannot be assessed until two facts are " +
        "recorded: whether the company is currently under examination, and whether the IRS has ever " +
        "raised the cost of goods sold treatment as an issue. Both matter enormously and neither is " +
        "guessed at here."
      : auditProtectionLikelyAvailable
        ? "On the facts recorded, prior-year audit protection appears to be AVAILABLE today. That is " +
          "the whole argument in one line: filing the form is what makes the IRS agree not to reopen " +
          "this item in your earlier years. It is available because no examination is open and the " +
          "issue has never been raised — and it is exactly that condition which can vanish with a " +
          "single letter, on a day you do not choose."
        : "On the facts recorded, prior-year audit protection is NOT available, because an " +
          "examination is open or the issue has already been raised. The window described in §8.01 " +
          "has closed. Correcting the method is still the right thing to do, but it no longer comes " +
          "with the shield it would have carried earlier, and this is precisely the cost of waiting.";

  const theCase =
    "THE CASE FOR DOING THIS PROPERLY, ARGUED FROM YOUR OWN INTEREST RATHER THAN FROM PRINCIPLE.\n\n" +
    "You have said you would rather beg forgiveness than ask permission, and that twelve years have " +
    "passed without the issue being raised. Both of those are fair observations and neither is being " +
    "dismissed. But there are four things in the actual text of the law that change the arithmetic, " +
    "and you should have them in front of you.\n\n" +
    "FIRST, AND MOST IMPORTANTLY, THE INTUITION IS BACKWARDS. " +
    protectionSentence +
    "\n\nSECOND, TIME IS NOT NEUTRAL. Every additional year of consistent treatment makes this more " +
    "firmly a method of accounting rather than a mistake, which narrows the options for leaving it. " +
    "Waiting does not preserve flexibility; it spends it.\n\n" +
    "THIRD, THE 'I NEVER ASKED' ARGUMENT WAS CLOSED BY CONGRESS IN 1984. §446(f) says that not " +
    "filing a request cannot be used to prevent a penalty or even to reduce one. The absence of " +
    "consent is not a defence. That subsection exists solely because taxpayers tried it.\n\n" +
    "FOURTH, THE CORRECTION IS CHEAPER THAN IT LOOKS. There are no amended returns. There is one " +
    "cumulative number under §481(a), reported in the year of change, spread over four years if it " +
    "goes against you and taken immediately if it goes in your favour — and available in a single " +
    "year by election if it is under $50,000.\n\n" +
    "You have every right to make this call, and this system will keep computing whatever you " +
    "decide, accurately and without argument, and will keep a clean record of what you chose and " +
    "why. But you asked to be told plainly, so: the legal path is not only the correct one, on these " +
    "facts it is very likely the SAFER one, and the protection that makes it safer is the one thing " +
    "here you can lose without doing anything at all.\n\n" +
    "One last thing, since you expect §280E to end soon. When it does, this stops being about " +
    "whether the money counts and becomes only about WHEN it counts — which is a far smaller " +
    "question. Going into that change with a clean, consented method is worth a great deal, because " +
    "the businesses that struggle in a transition are the ones carrying an unresolved position into " +
    "it. This system is built so that the day it happens, one field changes and the rest follows.";

  return {
    isMethodNotError,
    auditProtectionLikelyAvailable,
    adjustmentPeriodYears,
    deMinimisElectionAvailable,
    steps,
    theCase,
    authorityIds: [
      "IRC_446_E_CONSENT_REQUIRED",
      "IRC_446_F_NO_SHELTER",
      "REG_1_446_1_E_2_I_PROPER_OR_NOT",
      "REG_1_446_1_E_2_II_A_IS_A_METHOD",
      "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
      "IRC_481_A_ADJUSTMENT",
      "REVPROC_2015_13_AUDIT_PROTECTION",
      "REVPROC_2015_13_PROTECTION_LOST_IF_UNDER_EXAM",
      "REVPROC_2015_13_PROTECTION_NOT_UNIVERSAL",
      "REVPROC_2015_13_ADJUSTMENT_PERIOD",
      "REVPROC_2015_13_DE_MINIMIS",
    ],
  };
}

// ---------------------------------------------------------------------------
// 10) THE TOP-LEVEL ENTRY POINT
// ---------------------------------------------------------------------------

export type CogsPositionResult =
  | { readonly ok: false; readonly refusals: readonly CogsRefusal[] }
  | {
      readonly ok: true;
      readonly fiscalYear: number;
      readonly role: TaxpayerRole;
      readonly roleBecause: string;
      readonly comparison: PositionComparison;
      /** The form that actually goes on the return, per the owner's election. */
      readonly filed: Form1125A;
      readonly advice: MethodChangeAdvice;
    };

/**
 * Compute Form 1125-A, both positions, the gap, and the advice — or refuse.
 *
 * Refusals come first and completely: if anything needed is missing, nothing is
 * computed, because a number produced from incomplete facts is worse than no
 * number. It looks like an answer.
 */
export function computeCogsPosition(
  input: CogsYearInput,
  methodFacts: MethodChangeFacts,
): CogsPositionResult {
  const refusals = validateCogsInput(input);
  if (refusals.length > 0) return { ok: false, refusals };

  // Non-null after validation: POSITION_NOT_ELECTED would have refused above.
  const election = input.positionElection as PositionElection;
  const role = determineTaxpayerRole(input.licences);
  const comparison = comparePositions(input);
  const filed =
    election.position === "as_filed" ? comparison.asFiled : comparison.conservative;

  return {
    ok: true,
    fiscalYear: input.fiscalYear,
    role: role.role,
    roleBecause: role.because,
    comparison,
    filed,
    advice: adviseOnMethodChange(methodFacts),
  };
}
