/**
 * src/lib/accounting/gl-refusal-core.ts   (slice F5-K)
 *
 * TURNING A DATABASE REFUSAL INTO A SENTENCE A HUMAN CAN ACT ON.
 *
 * PURE: no I/O, no `server-only`, no Supabase. Every function here is a
 * decision or a string transformation, so all of it is testable without a
 * database or a browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The general ledger refuses things. That is the entire point of it: the
 * migrations 0172-0177 are mostly refusals, and each one is deliberate. But a
 * refusal is only useful if the person reading it knows what to DO next.
 *
 * What Postgres actually sends to the browser looks like this:
 *
 *     TB_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01. A
 *     backwards range returns nothing, which looks identical to "no activity".
 *
 * That is a good error — it was written carefully — but it arrives wrapped in
 * a `PostgrestError`, sometimes with a `code`, sometimes with the message
 * buried in `details` or `hint`, and it puts a machine token (`TB_RANGE_
 * BACKWARDS:`) in front of a human sentence.
 *
 * The owner has a master's in accounting and has not opened an accounting book
 * in thirteen years. He should never have to learn what `TB_` means, and he
 * should never see a raw stack trace where an instruction belongs.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE ENFORCES, AND IT IS NOT NEGOTIABLE
 * ---------------------------------------------------------------------------
 * An unrecognised error is NEVER dressed up as a friendly message.
 *
 * The tempting implementation is a lookup table with a cheerful fallback like
 * "Something went wrong, please try again." That is the single worst thing
 * this file could do. It converts an UNKNOWN failure — which might be a
 * connection drop halfway through a report, a permissions change, or a genuine
 * defect — into a reassuring sentence that invites the reader to shrug and
 * retry. Applied to a set of books, that is how a wrong number gets believed.
 *
 * So: recognised refusals get a plain-English explanation AND keep their
 * technical code for the record. Unrecognised failures are labelled clearly as
 * unexpected, are marked `recognised: false`, and the raw text is preserved
 * verbatim so it can be reported rather than guessed at.
 */

/** The machine-readable token a GL refusal starts with, e.g. `TB_FORBIDDEN`. */
export type GlRefusalCode = string;

export type GlRefusal = {
  /**
   * TRUE only when this exact refusal is one we deliberately wrote and can
   * explain. False means "we do not know what this is" and the UI must say so.
   */
  recognised: boolean;
  /** The token, e.g. "TB_RANGE_BACKWARDS". Empty string when not present. */
  code: GlRefusalCode;
  /** One sentence: what happened, in plain English. */
  title: string;
  /** What to do about it. Empty when we genuinely do not know. */
  whatToDo: string;
  /**
   * THE SPECIFICS, straight from the database, with the machine token stripped
   * off the front. This is where the ACTUAL NUMBERS, ACCOUNT CODES AND DATES
   * live: "journal 41 is out of balance by 2500 cents", "the range starts
   * 2026-12-31 and ends 2026-01-01", "account 12100 (Inventory - Cannabis)".
   *
   * WHY THIS FIELD EXISTS (defect D3, found 2026-08-16): this value was
   * previously computed and then thrown away by a ternary whose two branches
   * were identical, so a recognised refusal showed the generic explanation and
   * NOTHING ELSE. The owner was told "that entry does not balance" but never
   * told BY HOW MUCH, and the raw text was only rendered for UNRECOGNISED
   * failures. The better a refusal was understood, the less it told him. That
   * is exactly backwards, so the specifics are now a first-class field.
   *
   * Empty string when the database sent a bare code with no sentence after it.
   */
  detail: string;
  /**
   * The original message, always preserved. Never shown as the primary text
   * for a recognised refusal, but always available so nothing is hidden.
   */
  raw: string;
  /**
   * TRUE when this is a permission refusal. The UI treats these differently:
   * they are not errors to be fixed, they are the system working correctly.
   */
  isPermission: boolean;
};

/**
 * Every refusal this application deliberately raises, with the plain-English
 * translation.
 *
 * WHY THE CODES ARE LISTED EXPLICITLY rather than pattern-matched on a prefix:
 * a prefix rule (`starts with TB_`) would silently "recognise" a refusal added
 * years from now that this file has never heard of, and would then print a
 * confident, WRONG explanation for it. Being explicit means a new refusal
 * shows up as unrecognised — visibly, honestly — until someone writes its
 * translation. Failing loudly is the feature.
 */
const REFUSALS: Record<
  string,
  { title: string; whatToDo: string; isPermission?: boolean }
> = {
  // --- permission (0175, 0176, 0177) -----------------------------------
  TB_FORBIDDEN: {
    title: "The books are admin-only.",
    whatToDo:
      "Staff operate the till; the general ledger is not part of that job. Sign in as the owner or an admin to view this.",
    isPermission: true,
  },
  GL_FORBIDDEN: {
    title: "The books are admin-only.",
    whatToDo:
      "Staff operate the till; the general ledger is not part of that job. Sign in as the owner or an admin to view this.",
    isPermission: true,
  },
  GL_NOT_OWNER: {
    title: "Posting to the books is yours alone \u2014 not an admin's.",
    whatToDo:
      "This is a narrower gate than GL_FORBIDDEN, and the difference is deliberate. An admin CAN still do the day job: enter a vendor bill, schedule it, and pay it. What an admin cannot do is write that bill into the general ledger, because the ledger is the thing your tax return is built from and only you sign that return. Sign in as the owner to post it. If you were expecting an admin to be able to do this, they should hand you the bill for posting instead \u2014 nothing is lost, the bill keeps waiting.",
    isPermission: true,
  },
  // NOTE: there is no separate GL_OB_FORBIDDEN. The opening balance worksheet,
  // the blessing function and the Opening Balance Equity close all raise plain
  // GL_FORBIDDEN (0176 lines 289, 364, 526). A GL_OB_FORBIDDEN entry existed
  // here for months and could never fire. See the drift test.

  // --- the report asked for something impossible (0175) ----------------
  TB_NO_ENTITY: {
    title: "A trial balance is always for exactly one set of books.",
    whatToDo:
      "Choose one of the four: the retail store, the ATM business, the landholding company, or personal. They file different tax returns, so a combined figure belongs on no return.",
  },
  GL_NO_ENTITY: {
    title: "A general ledger report is always for exactly one set of books.",
    whatToDo: "Choose which set of books you want to look at.",
  },
  TB_UNKNOWN_ENTITY: {
    title: "There is no set of books by that name.",
    whatToDo:
      "The four sets of books are: greenway (retail), atm, landholding, and personal.",
  },
  GL_UNKNOWN_ENTITY: {
    title: "There is no set of books by that name.",
    whatToDo:
      "The four sets of books are: greenway (retail), atm, landholding, and personal.",
  },
  TB_RANGE_BACKWARDS: {
    title: "The date range runs backwards.",
    whatToDo:
      "The start date is after the end date, which would return nothing at all — and an empty report looks exactly like a quiet month. Swap the dates.",
  },
  GL_RANGE_BACKWARDS: {
    title: "The date range runs backwards.",
    whatToDo: "The start date is after the end date. Swap them.",
  },

  // --- the books themselves are saying no (0174, 0176, 0177) ------------
  GL_OUT_OF_BALANCE: {
    title: "That entry does not balance.",
    whatToDo:
      "Debits and credits must come to the same number. Nothing was recorded — the entry is still a draft, and you can correct it.",
  },
  GL_APPROVAL_REQUIRED: {
    title: "This entry has not been approved yet.",
    whatToDo:
      "Entries at or above the review threshold have to be approved before they reach the ledger. Approve it first, then post it.",
  },
  GL_SELF_APPROVAL_REFUSED: {
    title: "The person who wrote this entry cannot also approve it.",
    whatToDo:
      "Either have someone else approve it, or switch on the owner override — which is allowed, and is recorded every time it is used.",
  },
  GL_NO_APPROVER_IDENTITY: {
    title: "An approval has to be signed by a person.",
    whatToDo:
      "You appear to be signed out. Sign in again — an approval that names nobody is not an approval.",
  },
  GL_NO_ACTOR: {
    title: "This change has to be made by a signed-in person.",
    whatToDo: "Sign in again, so the record can name who decided it.",
  },
  GL_BEFORE_LINE_IN_THE_SAND: {
    title: "That date is before the cut-over.",
    whatToDo:
      "The books start on 1 January 2026. Anything earlier belongs to the old records, which are kept as history and never edited.",
  },
  GL_ALREADY_POSTED: {
    title: "This entry has already been posted.",
    whatToDo:
      "Posted entries are permanent by design. To change it, reverse it — the reversal and the original both stay on the record.",
  },
  GL_POST_CONFLICT: {
    title: "Something changed while this was being posted.",
    whatToDo:
      "Nothing was recorded. Reload the page and check the current state before trying again.",
  },
  GL_NO_APPROVAL_POLICY: {
    title: "This set of books has no approval policy yet.",
    whatToDo:
      "Nothing can be approved until a review threshold is set for these books.",
  },

  // --- opening balances (0176) -----------------------------------------
  GL_OB_FROZEN: {
    title: "The opening balances have already been finalised.",
    whatToDo:
      "The cut-over has been posted, so the worksheet is closed for good. If something is wrong, correct it with a normal journal entry dated on or after 1 January 2026.",
  },
  GL_OB_EMPTY: {
    title: "There is nothing on the opening balance worksheet.",
    whatToDo:
      "Add the balances from the closing trial balance first. Posting an empty cut-over would quietly produce a set of books with nothing in them.",
  },
  // NOTE: there is no GL_OB_OUT_OF_BALANCE either. An unbalanced opening
  // balance sheet is caught by gl_post_journal and comes back as the ordinary
  // GL_OUT_OF_BALANCE, which is already explained above.
  GL_OB_INACTIVE_ACCOUNT: {
    title: "One of these accounts has been retired.",
    whatToDo:
      "A retired account cannot take an opening balance. Either reactivate it or move the figure to the account that replaced it.",
  },
  GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: {
    title: "That account belongs to a different set of books.",
    whatToDo:
      "Each account belongs to one entity. Check you are on the right set of books.",
  },
  GL_OB_UNKNOWN_ACCOUNT: {
    title: "There is no account with that number.",
    whatToDo:
      "Check the account number against the chart of accounts. If the old books used a number this chart does not have, map it to its replacement rather than inventing an account.",
  },
  GL_OB_NOT_BALANCE_SHEET: {
    title: "Opening balances are for balance-sheet accounts only.",
    whatToDo:
      "Income and expense accounts start every year at zero, so they cannot carry an opening balance. Last year's profit belongs in Retained Earnings (40300).",
  },
  GL_OB_PARENT_ACCOUNT: {
    title: "That account is a heading, not a place to put money.",
    whatToDo:
      "It has accounts underneath it. Put the balance on the specific account beneath the heading, so it lands where reports expect it.",
  },
  GL_OB_NO_ACTOR: {
    title: "Finalising the opening balances has to be done by a signed-in person.",
    whatToDo:
      "You appear to be signed out. Sign in again — the entry every other number depends on cannot be anonymous.",
  },
  GL_OB_NO_EVIDENCE: {
    title: "Every opening balance needs to say where it came from.",
    whatToDo:
      "Name the statement, return, or schedule this figure was taken from. This is the first thing an examiner asks for.",
  },

  // --- the override (0177) ---------------------------------------------
  GL_OVERRIDE_REASON_REQUIRED: {
    title: "Switching on the override needs a written reason.",
    whatToDo:
      "Write at least a sentence explaining why. It is the first thing an examiner will read, so write it for them.",
  },
  GL_OVERRIDE_LOG_APPEND_ONLY: {
    title: "The override record cannot be edited or deleted.",
    whatToDo:
      "That is deliberate — a record that can be tidied up afterwards is worth nothing. If an override was a mistake, reverse the entry; that correction becomes part of the record too.",
  },

  // -------------------------------------------------------------------------
  // ADDED 2026-08-16 (defect D2). Fifty-seven refusals that the migrations
  // genuinely raise had no translation at all, so every one of them reached
  // the screen as "Unexpected problem — this is not one of the checks we
  // wrote", followed by raw Postgres text. Each refusal below was written by
  // reading the actual `raise exception` line in supabase/migrations, not from
  // memory. The drift test in tests/compliance/gl-refusal-core.test.ts now
  // fails the build if a new refusal is added to SQL without a translation.
  // -------------------------------------------------------------------------

  // --- the entry itself is malformed ------------------------------------
  GL_TOO_FEW_LINES: {
    title: "An entry needs at least two lines.",
    whatToDo:
      "Every entry moves money from somewhere to somewhere else, so it takes a minimum of two lines. Add the other side of it.",
  },
  GL_BAD_AMOUNT: {
    title: "One of the amounts is not a whole number of cents.",
    whatToDo:
      "Money is kept in whole cents so nothing can drift by a fraction of a penny. Round the figure to the nearest cent.",
  },
  GL_UNKNOWN_ACCOUNT: {
    title: "One of the account numbers is not in the chart of accounts.",
    whatToDo:
      "Check the number. If the account genuinely should exist, add it to the chart first — an entry pointing at a made-up account would never appear on a report.",
  },
  GL_INACTIVE_ACCOUNT: {
    title: "One of these accounts has been retired.",
    whatToDo:
      "Retired accounts stay for history but take no new entries. Use the account that replaced it, or reactivate it if retiring it was a mistake.",
  },
  GL_ENTITY_MISMATCH: {
    title: "One of the lines belongs to a different set of books.",
    whatToDo:
      "Every line of an entry has to be on the same set of books as the entry itself. If you are moving money between businesses, record it as an intercompany transfer instead.",
  },
  GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: {
    title: "That account is not available on this set of books.",
    whatToDo:
      "Some accounts belong to one business only. Check you are on the right set of books, or pick the equivalent account for this one.",
  },
  GL_CONTROL_ACCOUNT: {
    title: "That account is maintained automatically and cannot be typed into.",
    whatToDo:
      "Accounts like Accounts Payable and Inventory are totals kept in step with their detail. Record the underlying transaction — the bill, the payment, the receipt — and this account updates itself. Typing directly into it is how a total stops agreeing with the detail behind it.",
  },
  GL_INVENTORY_MANUAL: {
    title: "Inventory cannot be changed by a typed journal entry.",
    whatToDo:
      "Inventory moves when goods move. Post the receipt, the sale, or a counted adjustment so the number has evidence behind it. This matters more here than anywhere else: inventory is what makes cost of goods sold deductible under 280E.",
  },
  GL_COST_CLASS_REQUIRED: {
    title: "This line needs to say how it is treated for tax.",
    whatToDo:
      "Every expense on the cannabis books has to be marked as cost of goods sold or as non-deductible under 280E. Unmarked expenses are how a deduction gets claimed that cannot be defended.",
  },
  GL_COST_CLASS_NOT_ALLOWED: {
    title: "A balance-sheet line must not carry a 280E tax treatment.",
    whatToDo:
      "Cash, inventory and loans are not expenses, so they are neither deductible nor non-deductible. Clear the tax treatment on this line.",
  },
  GL_NORMAL_BALANCE: {
    title: "That account is set up the wrong way round.",
    whatToDo:
      "Each account has a natural side — assets and expenses sit on the debit side, liabilities, equity and income on the credit side. This one disagrees with its own type, which would make every report using it read backwards.",
  },

  // --- period and timing -------------------------------------------------
  GL_NO_PERIOD: {
    title: "There is no accounting period open for that date.",
    whatToDo:
      "Months have to exist before anything can be recorded in them. Open the fiscal year (or the month) first, then post this.",
  },
  GL_PERIOD_CLOSED: {
    title: "That month is closed.",
    whatToDo:
      "Closed months do not accept new entries, which is what makes a closed month mean something. If this genuinely belongs there, reopen the month with a written reason; otherwise date it in the current month.",
  },
  GL_PERIOD_LOCKED: {
    title: "That month is locked because a tax return was filed on it.",
    whatToDo:
      "This one cannot be reopened at all. A filed return has to keep matching the books it came from. Record the correction in the current month instead — that is how amendments are handled.",
  },
  GL_PERIOD_NOT_CLOSED: {
    title: "That month is not closed yet.",
    whatToDo: "It has to be closed before this step can happen.",
  },
  GL_PERIOD_NOT_OPEN: {
    title: "That month is not open.",
    whatToDo: "It is already closed or locked, so this step does not apply to it.",
  },
  GL_OPEN_DRAFTS: {
    title: "There are unfinished entries in that month.",
    whatToDo:
      "Closing a month with drafts still in it would leave real transactions stranded outside the books. Post them or delete them, then close.",
  },
  GL_BAD_FISCAL_YEAR: {
    title: "That is not a year these books cover.",
    whatToDo: "The books begin in 2026. Anything earlier belongs to the old records.",
  },

  // --- posting, reversal and permanence ---------------------------------
  GL_IMMUTABLE: {
    title: "Posted entries cannot be changed or deleted.",
    whatToDo:
      "This is the single most important rule in the system and it is not going to bend. To correct a posted entry, reverse it and post the right one — both stay on the record, which is exactly what an examiner expects to see.",
  },
  GL_APPEND_ONLY: {
    title: "That record is permanent and cannot be edited or deleted.",
    whatToDo:
      "It is a history log. A history that can be rewritten afterwards proves nothing, so it only ever grows.",
  },
  GL_NOT_POSTED: {
    title: "Only a posted entry can be reversed.",
    whatToDo:
      "This one is still a draft, so there is nothing on the books to undo. Edit it or delete it directly.",
  },
  GL_ALREADY_REVERSED: {
    title: "This entry has already been reversed.",
    whatToDo:
      "Reversing it twice would put the money back a second time. Look at the reversal that already exists before doing anything else.",
  },
  GL_NOT_FOUND: {
    title: "That entry no longer exists.",
    whatToDo:
      "It may have been deleted while this page was open. Reload and check the current state.",
  },
  GL_REASON_REQUIRED: {
    title: "This needs a written reason.",
    whatToDo:
      "Reversing a posted entry and reopening a closed month both change history, so both have to say why in your own words. Write the sentence you would want to read a year from now.",
  },
  GL_NO_IDEMPOTENCY_KEY: {
    title: "An automatic entry has to be traceable to its source.",
    whatToDo:
      "Without a stable reference back to the sale, bill or bank line it came from, a retry would post the same money twice. This is a defect to report rather than something to work around.",
  },

  GL_NO_SOURCE_REF: {
    title: "That bill has no reference tying it to the invoice it came from.",
    whatToDo:
      "The reference is what stops the same bill being posted twice. If the button is pressed again, or the network drops after the entry is written but before the screen updates, the reference is the only thing that lets the books recognise \u201Cthis one is already in\u201D. Without it, a retry quietly doubles a purchase \u2014 which overstates inventory now and overstates cost of goods sold later, on the one number \u00a7280E lets you subtract. Post the bill from the vendor bill screen rather than by hand, so the invoice number travels with it.",
  },

  // --- payroll and the employee-as-COGS question (0188) -------------------
  //
  // These five are the most expensive refusals in the whole catalogue, because
  // the mistake they prevent is the one that FEELS safest: every cannabis
  // operator has heard that "you can put payroll in COGS." For a grower that is
  // often true. For a retailer it is mostly false, and the difference is worth
  // real money on the return.
  GL_PAYROLL_SELLING_LABOR_TO_COGS: {
    title: "That wage cannot be cost of goods sold — and this is the expensive one.",
    whatToDo:
      "Greenway buys finished product and resells it, so the tax rules treat it as a RESELLER. The reseller inventory rule, Reg. §1.471-3(b), lets you add only “transportation or other necessary charges incurred in acquiring possession of the goods” to inventory — it has no direct-labor clause at all. The clause everybody quotes, Reg. §1.471-3(c), is the PRODUCER rule, and even that one excludes “any cost of selling.” Harborside argued this exact point and lost (Patients Mutual, 151 T.C. 176). So budtender, marketing, manager, security, compliance and inventory-counting wages are disallowed by §280E, full stop. HERE IS WHAT DOES WORK: time your people spend RECEIVING deliveries and DRIVING to collect product is spent acquiring possession, and that time can ride into inventory. Split their hours by task on the payroll screen, and the receiving share goes to account 61000 legitimately.",
  },
  GL_PAYROLL_UNKNOWN_ROLE: {
    title: "There is no labor role by that name.",
    whatToDo:
      "The list of roles is deliberately closed, because an open-ended list of job titles is exactly how “warehouse associate” quietly becomes a cost-of-goods account that nobody can explain three years later in an audit. If a genuinely new kind of work exists, add it to the taxonomy first with its §280E treatment and the authority behind it, then use it.",
  },
  GL_PAYROLL_NO_TASK_DETAIL: {
    title: "Clock-in and clock-out is not enough to put wages into inventory.",
    whatToDo:
      "To claim receiving time as cost of goods sold you need records showing WHAT the person was doing, not just that they were here. §6001 requires records sufficient to establish the amount, and a percentage typed into a box after the fact is a guess wearing a record’s clothes. The fix is ordinary: have staff tag their punches with what they were doing. After about a month of tagged punches the claim supports itself, and the number stops being an estimate.",
  },
  GL_PAYROLL_NOT_TIED_TO_DELIVERIES: {
    title: "Receiving time has to point at actual deliveries.",
    whatToDo:
      "The reason receiving labor survives §280E is that it is spent “acquiring possession of the goods.” That is a claim about specific goods, so it has to be tied to specific deliveries. Link the receiving punches to the manifests they were spent on. Then the claim is not “about 10% of payroll” — it is “these 42 punches, each tied to a numbered manifest,” which is a completely different conversation with an examiner.",
  },
  GL_PAYROLL_NO_COST_CLASS: {
    title: "That payroll entry is missing its §280E labels.",
    whatToDo:
      "This one is worth understanding, because it is the failure that hides. Every §280E report reads the COST CLASS on each line, not the account number. A payroll entry posted without those labels balances perfectly, looks completely normal, and quietly drops the wages out of the disallowed column and the receiving labor out of cost of goods sold. Nothing appears broken — the only symptom is a wrong tax return months later. Post payroll from the payroll screen, which attaches the labels automatically.",
  },
  GL_PAYROLL_COGS_CLASS_MISMATCH: {
    title: "That line goes into a cost-of-goods account but is not labelled as one.",
    whatToDo:
      "A cost that rides into inventory has to say so on the line itself, because that label is what an examiner reads and what the §280E reports total. The account number alone is not enough. If this really is receiving labor, label it as an allocable cost of goods; if it is not, it belongs in wages instead.",
  },
  GL_PAYROLL_DIRECT_LABOR_CLAIMED: {
    title: "A reseller has no “direct labor” to claim.",
    whatToDo:
      "This is a fine distinction that matters enormously. “Direct labor” is a PRODUCER concept from Reg. §1.471-3(c) — the paragraph for people who grow or manufacture. Greenway buys finished product and resells it, so the reseller rule, Reg. §1.471-3(b), governs instead, and it has no direct-labor clause at all. What it does have is “necessary charges incurred in acquiring possession of the goods,” which is an ALLOCABLE cost, not a direct one. Label it as allocable and it is a defensible position; label it as direct labor and it invites the examiner to ask why a retailer is using a grower’s rule.",
  },
  GL_PAYROLL_UNCLASSIFIED_EXPENSE: {
    title: "Those wages were posted without saying what §280E does to them.",
    whatToDo:
      "Wages are never simply “unclassified.” They are one of three things: disallowed by §280E (the usual answer for a cannabis retailer), belonging to a separate business like the ATM or the rental property (fully deductible over there), or an allocable cost of acquiring goods (receiving and driver-collection time). Leaving the label off does not make the question go away — it just moves the wrong answer onto the tax return where nobody will notice it. Pick which of the three this is.",
  },
  GL_PAYROLL_RUN_CHANGED: {
    title: "This payroll was already posted, and the numbers have changed since.",
    whatToDo:
      "Nothing is lost and nothing is wrong — the books are just refusing to quietly overwrite a payroll that is already in them, because overwriting is how a quarter of withholding disappears without a trace. Post a correcting entry instead: the original stays where it is, the correction sits next to it, and the pair of them shows exactly what changed and why. That is what a reviewer wants to see anyway.",
  },

  // --- intercompany -------------------------------------------------------
  GL_INTERCOMPANY_SAME_ENTITY: {
    title: "A transfer between businesses needs two different businesses.",
    whatToDo:
      "Both sides of this name the same set of books. If you are moving money inside one business, that is an ordinary entry, not a transfer.",
  },
  GL_INTERCOMPANY_NO_REF: {
    title: "Both halves of a transfer must share a reference.",
    whatToDo:
      "The two sides live on different sets of books, so a shared reference is the only thing tying them back together. Without it, one side can be found and the other cannot.",
  },
  GL_OWNERSHIP: {
    title: "The ownership percentages do not add up to 100%.",
    whatToDo:
      "Anything allocated by ownership would be silently over- or under-allocated. Fix the percentages so they total exactly 100%.",
  },

  // --- automatic posting --------------------------------------------------
  GL_AUTOPOST_NOT_ELIGIBLE: {
    title: "That kind of entry is never posted automatically.",
    whatToDo:
      "Estimates, allocations and judgment calls always get a human look before they reach the books. Review it and post it yourself.",
  },
  GL_AUTOPOST_NO_TEMPLATE: {
    title: "Nothing posts itself without a rule approved in advance.",
    whatToDo:
      "Set up and approve a posting template first. The rule has to be agreed before it runs, not after.",
  },
  GL_AUTOPOST_TEMPLATE_UNAPPROVED: {
    title: "That automatic posting rule has never been approved.",
    whatToDo: "Review the rule and approve it before it is allowed to post anything.",
  },
  GL_AUTOPOST_TEMPLATE_INACTIVE: {
    title: "That automatic posting rule is switched off.",
    whatToDo: "Switch it back on if it should be running, or post this entry by hand.",
  },
  GL_AUTOPOST_TEMPLATE_EXPIRED: {
    title: "That automatic posting rule has expired.",
    whatToDo:
      "Rules carry an end date on purpose, so an old arrangement cannot keep posting quietly after it ended. Extend it or replace it.",
  },
  GL_AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE: {
    title: "That automatic posting rule has not started yet.",
    whatToDo:
      "It takes effect on a later date. Either wait for it, or change its start date if it should already be running.",
  },
  GL_AUTOPOST_WRONG_ENTITY: {
    title: "That posting rule belongs to a different set of books.",
    whatToDo: "Use the rule set up for this business.",
  },
  GL_AUTOPOST_WRONG_SOURCE_KIND: {
    title: "That posting rule is for a different kind of transaction.",
    whatToDo:
      "A rule written for sales cannot post a bill. Use the right rule, or write one for this kind of transaction.",
  },
  GL_AUTOPOST_OVER_LIMIT: {
    title: "This is larger than the ceiling set on that rule.",
    whatToDo:
      "Automatic rules carry a size limit so an unusual amount always gets a human look. Post it yourself after checking it, or raise the ceiling deliberately.",
  },
  GL_AUTOPOST_OUT_OF_TOLERANCE: {
    title: "The amount does not match what was expected closely enough.",
    whatToDo:
      "The difference is outside the tolerance on that rule, which is the system telling you something is off. Compare the bill to the order before posting anything.",
  },
  GL_AUTOPOST_NO_THREE_WAY_MATCH: {
    title: "A bill posts itself only when three documents agree.",
    whatToDo:
      "The purchase order, the record of what actually arrived, and the invoice all have to line up. One of them does not. Check what was ordered against what came in and what you were billed.",
  },
  GL_TEMPLATE_NEEDS_REASON: {
    title: "Changing an automatic posting rule needs a written reason.",
    whatToDo:
      "A rule that posts money by itself is exactly the thing that has to explain why it changed. Write it in your own words.",
  },

  // --- chart of accounts --------------------------------------------------
  GL_ACCOUNT_EXISTS: {
    title: "There is already an account with that number.",
    whatToDo: "Pick a different number — two accounts cannot share one.",
  },
  GL_ACCOUNT_IMMUTABLE: {
    title: "That account cannot be renumbered or deleted.",
    whatToDo:
      "It either has history behind it or it is one the system depends on. Retire it and create a new account instead; the history stays where the reports expect it.",
  },
  GL_ACCOUNT_IN_USE: {
    title: "That account has entries in it and cannot be deleted.",
    whatToDo:
      "Deleting it would take real history with it. Mark it inactive instead — it stops appearing for new entries but its past stays intact.",
  },
  GL_ACCOUNT_BLOCK: {
    title: "That number is in the wrong range for that kind of account.",
    whatToDo:
      "The numbering ranges decide what an account is: assets, liabilities, equity, income, expenses. Pick a number from the right range so every report groups it correctly.",
  },
  GL_ACCOUNT_PARENT: {
    title: "That account cannot sit under that heading.",
    whatToDo:
      "An account has to live inside its own heading, and it cannot be its own parent. Choose a heading of the same type.",
  },
  GL_ENTITY_UNKNOWN: {
    title: "That account is restricted to a business that does not exist.",
    whatToDo:
      "Usually a typo in the business code. A mistyped code silently removes the account from every filtered report, so it is refused outright. Leave it blank to mean \u201Cany business\u201D.",
  },
  GL_NOT_APPROVED: {
    title: "That has to be approved first.",
    whatToDo:
      "A proposed account or a suggested classification only takes effect once you have approved it.",
  },
  GL_DECISION_REQUIRED: {
    title: "A decision has to record who made it.",
    whatToDo:
      "Approving or rejecting a suggestion has to be attributable to a person. Sign in again if you have been signed out.",
  },
  GL_MAPPING_INCOMPLETE: {
    title: "That old account has nowhere to go.",
    whatToDo:
      "Every old account being carried over needs a destination in the new chart. Say where this balance should land.",
  },
  GL_MAPPING_INVALID: {
    title: "That account cannot carry a balance forward.",
    whatToDo:
      "Income and expense accounts start each year at zero, so their balances do not carry over. Last year's result belongs in Retained Earnings.",
  },
  GL_MAP_TARGET: {
    title: "That balance is mapped to an account that does not exist.",
    whatToDo:
      "The balance would vanish at the cut-over — the worst kind of error, because nothing would look wrong afterwards. Point it at a real account in the new chart.",
  },

  // --- slice books-05: bank matching and reconciliation ---------------------
  //
  // Why this block is longer and gentler than the others: every OTHER refusal in
  // this file stops something that is visibly broken. These stop things that
  // look perfect. A wrongly matched bank transaction still balances — flip the
  // sign and both lines flip together, so debits still equal credits and no
  // screen turns red. There is nothing to notice. That means the explanation has
  // to do the work the missing error message cannot, which is why each of these
  // says what went wrong, why it is invisible, and exactly what to do instead.

  GL_BANK_PENDING_ROW: {
    title: "That line is still pending at the bank.",
    whatToDo:
      "A pending charge is the bank's best guess, not a fact yet. Both the amount and the date can still change before it settles, and some pending lines disappear entirely. If it were recorded now, the books would state a number the bank later contradicts, and the correction would have to be found by hand. Give it one to three days; once it settles it appears here ready to match, and nothing is lost in the meantime.",
  },
  GL_BANK_REMOVED_ROW: {
    title: "The bank withdrew that line, so there is nothing to record.",
    whatToDo:
      "Plaid marks a transaction as removed when the bank reverses or cancels it — a duplicate charge pulled back, an authorisation that never completed. The correct entry for an event that did not happen is no entry at all. The row is kept on file rather than deleted so the audit trail still shows it was seen and considered, which is exactly what WAC 314-55-087(2)(b) asks for.",
  },
  GL_BANK_SIGN_DISAGREES: {
    title: "The bank and the entry disagree about which way the money moved.",
    whatToDo:
      "This is the single most important block in the whole bank screen, and it is worth knowing why. Your bank feed records a positive number when money LEAVES; the ledger records a positive number when an account is DEBITED. Those two conventions are exact opposites, so one crossing has to happen and it has to happen in exactly one place. When a sign gets flipped, both lines of the entry flip together — the journal still balances, debits still equal credits, and absolutely nothing looks wrong. That is what happened with the backwards card signs in the old books, and it went unnoticed for a long time for precisely this reason. The rule to hold on to: money arriving in the bank DEBITS the bank account; money leaving CREDITS it.",
  },
  GL_BANK_AMOUNT_MISMATCH: {
    title: "The bank amount and the entry amount are not the same.",
    whatToDo:
      "A near-miss almost always has a real cause worth finding: a merchant fee netted out of a deposit, two days of takings banked together, or a partial payment on a bill. Do not stretch either number to make them meet. Either correct the entry to what the bank actually did, or split the deposit so each piece matches its own bank line. A forced match is a wrong number that will never be questioned again, because it looks settled.",
  },
  GL_BANK_ALREADY_MATCHED: {
    title: "That bank line is already matched to an entry.",
    whatToDo:
      "One line at the bank is one event in the world, so it gets exactly one entry. Matching it twice records the same money twice — and because both entries balance, the books look completely healthy while the income or the expense is doubled. If the first match was wrong, undo it: the old match is kept on file as superseded rather than deleted, so the trail still shows what happened and why it changed.",
  },
  GL_BANK_JOURNAL_ALREADY_MATCHED: {
    title: "That entry is already matched to a different bank line.",
    whatToDo:
      "The mirror image of the block above, and it matters just as much. If one entry could absorb two bank lines, one of those lines would never get its own record and the money it represents would simply be missing from the books. Undo the earlier match if it was wrong, or create the second entry this bank line actually needs.",
  },
  GL_BANK_DATE_TOO_FAR: {
    title: "Those two are too far apart to be the same event.",
    whatToDo:
      "Cash genuinely lags: takings counted at close on Friday may not reach the bank until Wednesday, and that is normal. Months apart is not lag, it is coincidence — two unrelated transactions that happen to share an amount look identical to any matcher. If this really is the same event, then the date on one of them is wrong, and that is the thing to fix.",
  },
  GL_BANK_ENTITY_MISMATCH: {
    title: "That entry belongs to a different set of books.",
    whatToDo:
      "You keep four separate sets of books — the shop, the ATM business, the land, and you personally — and keeping them genuinely separate is what protects the tax treatment of each one. Money that crosses between them is a loan or a distribution, never a shared entry. Post it in the entity that actually owns the bank account, then record the movement between entities deliberately, so both sides show it.",
  },
  GL_BANK_TRANSFER_AS_INCOME: {
    title: "A transfer between your own accounts needs both sides identified.",
    whatToDo:
      "Moving your own money is not income and it is not an expense — it is the same dollar in a different pocket. If only one side gets recorded, the deposit looks like revenue you never earned and the withdrawal looks like a cost you never paid, and both are wrong at the same time. The IRS says this directly in IRM 4.10.4.2.3.7(3)(b): “Nontaxable funds, transfers-in, and returned deposits need to be subtracted from total deposits to get ‘Taxable Deposits.’” Point at the matching line in the other account and it posts cleanly through the in-transit account, with both halves visible.",
  },
  GL_BANK_DOUBLE_COUNT_RISK: {
    title: "Creating a new entry here risks recording the same money twice.",
    whatToDo:
      "Your sales already post from the point of sale, and your bills already post from the purchasing screen. By the time the deposit reaches the bank, the income is on the books — the bank line is the proof it landed, not a second sale. Match it to the entry that already exists. Only create something new when nothing on the books explains the money, and then say what it was so it lands in the right account with the right tax label.",
  },
  GL_BANK_LOAN_SINGLE_LINE: {
    title: "A loan payment cannot be recorded as one number.",
    whatToDo:
      "One payment leaves the bank, but three separate things happen, and only one of them is an expense. The interest is deductible under IRC §163(a). The principal is not an expense at all — it reduces what you owe, which increases what you own. The escrow is still your money, just held by the servicer to pay taxes and insurance later. Coding the whole payment to an expense account overstates the deduction and understates your equity, every single month, invisibly. Take the three figures straight off the servicer's statement rather than working them out — the statement is the evidence an examiner asks for, and the three must add up to the payment exactly.",
  },
  GL_BANK_NO_COST_CLASS: {
    title: "That new entry has no §280E label.",
    whatToDo:
      "Every §280E report reads the cost class on the line, never the account number. A line posted without one balances perfectly and looks entirely normal on screen, while quietly dropping out of the disallowed column. Nothing appears broken and nothing ever will — the only symptom shows up on a tax return months later. Say what the cost was and the label follows automatically.",
  },
  GL_BANK_UNCLASSIFIED: {
    title: "That line has not been identified yet.",
    whatToDo:
      "This block is deliberate, and it is the one people find most annoying until they see the alternative. A guess that lands in the wrong account is far more expensive than a line that sits and waits for you, because the guess looks finished — nobody ever goes back to check it. An unlabelled line you review is safer than a labelled one you trust. Tell it what this was and it remembers the pattern for next time.",
  },
  GL_BANK_NON_INTEGER_CENTS: {
    title: "That bank amount is not a whole number of cents.",
    whatToDo:
      "Money in this system is always a whole number of cents, because fractions of a cent are how rounding errors get in and then compound quietly. A fraction here means something upstream did floating-point arithmetic on money. Do not round it away at this point — whatever produced the fraction is producing it everywhere else too, and this is the visible edge of it.",
  },
  GL_BANK_PRE_CUTOVER: {
    title: "That bank line is dated before these books begin.",
    whatToDo:
      "Anything before the cut-over belongs to the Sage books and to years your accountant has already closed and filed. Posting it here would create a second, contradictory record of a period that is already settled — and if the two ever get compared, neither one can be trusted. If it genuinely belongs in the current year, the date is wrong at the source and that is where to correct it.",
  },
  GL_BANK_INVALID_DATE: {
    title: "That date cannot be read as a calendar date.",
    whatToDo:
      "Every entry has to land in a period, because periods are what tax returns are made of, and a date that cannot be read cannot be placed in one. This nearly always means the bank feed sent something unexpected rather than that you did anything wrong. The raw payload is kept on file so the original can be checked.",
  },
  GL_BANK_COMMINGLED: {
    title: "That is a personal cost inside a business set of books.",
    whatToDo:
      "If the company paid for something personal, that is not an expense of the company — it is money taken out of it, which is an owner draw. Recording it as an expense understates the profit the company actually made, overstates its costs, and in an S corporation it quietly changes your basis as well, so it is wrong in three places at once. Post it as a draw and all three land correctly together. If it truly was a business cost, give it the business label instead. The IRS looks for exactly this: IRM 4.10.4.2.3.4(4)(j) lists “Significant commingling of business and personal funds” as a sign of weak controls.",
  },
  GL_BANK_MATCH_NOT_FOUND: {
    title: "That bank line or that entry no longer exists.",
    whatToDo:
      "Something referenced by this match has been removed or replaced since the screen was loaded — often because a sync ran in between. Reload the bank screen and the current picture will be there. Nothing was posted, so nothing needs undoing.",
  },
  GL_BANK_ACCOUNT_NOT_CASH: {
    title: "That is not a cash account.",
    whatToDo:
      "A bank match has to land on an account that represents actual money at a bank — the operating account, the ATM vault account, undeposited funds, or cash in transit. Pointing it at anything else would mean the reconciliation could never tie, because the balance being proved would not be the balance the bank reports.",
  },

  // --- signing off a month: TIES is not the same as DONE --------------------
  //
  // These three guard the last step, and the first of them guards the subtlest
  // failure in the whole system. A reconciliation has two different kinds of
  // reconciling item and they are NOT interchangeable:
  //
  //   TIMING DIFFERENCES  (an uncashed cheque, a deposit still in transit)
  //     The books are already RIGHT. The bank simply has not caught up. These
  //     clear themselves. No entry is needed, and posting one would be wrong.
  //
  //   UNRECORDED ITEMS    (a bank fee, interest, an NSF, a forgotten auto-debit)
  //     The books are WRONG until an entry is posted. These never clear
  //     themselves, because nothing is coming to clear them.
  //
  // The trap: an unrecorded bank line is ALREADY inside the bank's closing
  // balance, so when the reconciliation adds it to the ledger side it cancels
  // itself out and the difference comes to exactly zero. The month appears to
  // tie perfectly while an expense is missing from the books entirely.

  GL_BANK_UNRECORDED_ITEMS: {
    title: "This month balances, but it is not finished.",
    whatToDo:
      "This is the one worth reading twice, because it is the failure that looks like success. Some bank lines this month have no entry against them — a service charge, interest, an NSF, an auto-debit nobody recorded. Here is why that still showed a difference of zero: an unrecorded charge is ALREADY inside the closing balance the bank reported, so when the reconciliation adds it to your side too, it cancels itself out. The arithmetic closes perfectly while the expense is missing from the books completely. Nothing turns red, and the only symptom appears on a tax return months later, as a deduction you were entitled to and never took. Balancing and being finished are two different questions, so this asks them separately. Post an entry for each listed line, run the reconciliation again, then sign off. Washington's own audit manual puts it plainly (BARS §3.1.9.15(4)): \"Identifying transactions from the bank accounts need to be recorded in the accounting records. For example, some of these items could include interest earned, bank fees or charges, NSF checks, and unrecorded deposits ... Accounting records should be updated for all such transactions identified in the bank statements.\"",
  },
  GL_BANK_DOES_NOT_TIE: {
    title: "This month is out by an amount nobody has explained.",
    whatToDo:
      "You are allowed to sign this off — but only with a note saying what the difference is and what you are doing about it, and that note is the whole point. An unexplained gap is a question, and a question you write down is one you can still answer next month. What must never happen is the other route: creating an entry that simply forces the two sides to agree. That entry is a plug, and a plug is a lie that balances. It is exactly the $4,624,697.31 inventory adjustment in the old books — one number invented to make a page tie, sitting there for years looking completely ordinary because nothing about it was ever out of balance. Find the cause first: a transposed figure, a duplicate deposit, a cheque cut but never sent, an entry in the wrong month. If you genuinely cannot find it, say so in the note and sign off honestly. Washington's audit manual expects the difference to be resolved rather than absorbed (BARS §3.1.9.15(5)): \"After adjusting for reconciling items, there should be no further differences between bank statements and accounting records.\"",
  },
  GL_BANK_ALREADY_SIGNED_OFF: {
    title: "That month has already been signed off.",
    whatToDo:
      "A sign-off is a statement, with your name and a timestamp on it, that you personally reviewed this month and accepted it — which is precisely the evidence an examiner asks for and the reason it cannot be quietly re-signed. If something has since come to light, do not overwrite the old signature: run the reconciliation again. Re-running deliberately clears the signature so the month can be reviewed and signed afresh, and both the original sign-off and the new one remain on the record. That trail is worth more than a tidy one, because it shows a mistake being caught and corrected rather than a period that was simply never wrong.",
  },

  // --- fixed assets --------------------------------------------------------
  GL_LAND_NOT_DEPRECIABLE: {
    title: "Land and construction in progress are never depreciated.",
    whatToDo:
      "Land does not wear out, so its cost comes back on sale rather than over time (IRS Pub. 946). If you are depreciating a building, put the depreciation against Buildings and leave the land alone. If you are selling the property, that is allowed — but a sale unwinds accumulated depreciation in the opposite direction from this entry, so record the final depreciation first and the sale second.",
  },
};

/**
 * Pull the leading `SOME_CODE:` token off a database message.
 *
 * Returns an empty string when there isn't one, which is the common case for
 * genuine infrastructure failures ("fetch failed", "canceling statement due to
 * statement timeout") — and those must NOT be mistaken for deliberate
 * refusals.
 */
export function extractRefusalCode(message: string): GlRefusalCode {
  if (typeof message !== "string") return "";
  // A real code is UPPER_SNAKE, at least two characters, and is followed by a
  // colon. Anchored to the start so a code mentioned mid-sentence (for example
  // inside a quoted hint) is not mistaken for the actual refusal.
  const m = /^\s*([A-Z][A-Z0-9_]{1,63}):/.exec(message);
  return m ? m[1] : "";
}

/**
 * Strip the machine token off the front of a message, leaving the sentence.
 * Used to preserve the carefully-written detail (which often contains the
 * ACTUAL NUMBERS, e.g. "the range starts X and ends Y") after the token is
 * removed.
 */
export function stripRefusalCode(message: string): string {
  if (typeof message !== "string") return "";
  return message.replace(/^\s*[A-Z][A-Z0-9_]{1,63}:\s*/, "").trim();
}

/** Anything shaped like an error we might get back from Supabase or fetch. */
export type ErrorLike =
  | string
  | {
      message?: string | null;
      details?: string | null;
      hint?: string | null;
      code?: string | null;
    }
  | null
  | undefined;

/**
 * Get the most informative text available from an error-shaped thing.
 *
 * WHY IT LOOKS IN `details` AND `hint` TOO: PostgREST does not always put the
 * `RAISE` message in `.message`. For some failures the useful sentence is in
 * `.details`, and `.message` is a generic wrapper. Reading only `.message`
 * produced blank refusals in testing — the reason was right there in the
 * payload, one field over.
 */
export function messageFrom(err: ErrorLike): string {
  if (err == null) return "";
  if (typeof err === "string") return err.trim();

  const parts = [err.message, err.details, err.hint]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);

  if (parts.length === 0) return "";

  // Prefer whichever part actually carries a refusal code; otherwise the first.
  const withCode = parts.find((p) => extractRefusalCode(p) !== "");
  return withCode ?? parts[0];
}

/**
 * THE MAIN ENTRY POINT. Translate any failure into something displayable,
 * being scrupulously honest about whether we actually recognise it.
 */
export function explainGlRefusal(err: ErrorLike): GlRefusal {
  const raw = messageFrom(err);

  if (raw === "") {
    return {
      recognised: false,
      code: "",
      title: "Something failed, and it did not say why.",
      whatToDo:
        "No message came back at all. Nothing was changed. Please report this — a silent failure is worth investigating.",
      detail: "",
      raw: "",
      isPermission: false,
    };
  }

  const code = extractRefusalCode(raw);
  const known = code ? REFUSALS[code] : undefined;

  if (!known) {
    // THE IMPORTANT BRANCH. We do NOT invent an explanation, and we do not
    // hide the original text. An unknown failure is reported as unknown.
    return {
      recognised: false,
      code,
      title: "Unexpected problem — this is not one of the checks we wrote.",
      whatToDo:
        "Nothing was changed by this. The exact message is shown below; please report it rather than retrying blindly.",
      // For an unrecognised failure the whole raw text is shown by the UI, so
      // repeating part of it here would only duplicate it on screen.
      detail: "",
      raw,
      isPermission: false,
    };
  }

  // Keep the detail sentence from the database, because it usually contains
  // the actual figures and dates involved.
  //
  // DEFECT D3 (fixed 2026-08-16): this value used to be computed and then
  // discarded by `detail && detail !== known.title ? `${known.whatToDo}` :
  // known.whatToDo` -- a ternary whose two branches were character-for-
  // character identical. The comment above claimed the detail was kept; it
  // was not. Now it is returned as its own field and the UI renders it, so
  // "that entry does not balance" is followed by BY HOW MUCH.
  const detail = stripRefusalCode(raw);

  return {
    recognised: true,
    code,
    title: known.title,
    whatToDo: known.whatToDo,
    // Never echo the generic title back as if it were specific detail.
    detail: detail === known.title ? "" : detail,
    raw,
    isPermission: known.isPermission === true,
  };
}

/** Convenience for the very common "is this just a permissions wall?" check. */
export function isPermissionRefusal(err: ErrorLike): boolean {
  return explainGlRefusal(err).isPermission;
}

/**
 * The list of refusal codes this file can explain. Exported ONLY so tests can
 * assert coverage against the migrations — see the mutation notes below.
 */
export function knownRefusalCodes(): string[] {
  return Object.keys(REFUSALS).sort();
}

// ---------------------------------------------------------------------------
// SELF-TESTS
//
// Run with:  npx tsx -e "require('./src/lib/accounting/gl-refusal-core').__runGlRefusalCoreTests()"
//
// Every assertion here was proven capable of FAILING (standing rule 15) by
// deliberately breaking the function it tests and confirming this suite goes
// red. Notes on the campaign are in f5-defects.md.
// ---------------------------------------------------------------------------
export function __runGlRefusalCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(
      JSON.stringify(a) === JSON.stringify(b),
      `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`,
    );

  // --- extractRefusalCode ---------------------------------------------
  eq(extractRefusalCode("TB_FORBIDDEN: nope"), "TB_FORBIDDEN", "plain code");
  eq(extractRefusalCode("  GL_OUT_OF_BALANCE: x"), "GL_OUT_OF_BALANCE", "leading space");
  eq(extractRefusalCode("fetch failed"), "", "no code in infra error");
  eq(extractRefusalCode("lowercase_thing: x"), "", "lowercase is not a code");
  // NEGATIVE CONTROL (rule 15b): a code mentioned mid-sentence is NOT the
  // refusal. Without the ^ anchor this returns a confident wrong answer.
  eq(
    extractRefusalCode('timeout while handling "TB_FORBIDDEN: ..."'),
    "",
    "mid-sentence code must not be extracted",
  );
  eq(extractRefusalCode(""), "", "empty string");
  // @ts-expect-error deliberately passing a non-string
  eq(extractRefusalCode(null), "", "null is tolerated");

  // --- stripRefusalCode ------------------------------------------------
  eq(
    stripRefusalCode("TB_RANGE_BACKWARDS: the range starts A and ends B."),
    "the range starts A and ends B.",
    "detail preserved",
  );
  eq(stripRefusalCode("no code here"), "no code here", "unchanged without a code");

  // --- messageFrom -----------------------------------------------------
  eq(messageFrom("plain string"), "plain string", "string passthrough");
  eq(messageFrom({ message: "m" }), "m", "message field");
  eq(messageFrom({ message: null, details: "d" }), "d", "falls back to details");
  eq(messageFrom({ message: null, details: null, hint: "h" }), "h", "falls back to hint");
  // THE ONE THAT MATTERED IN TESTING: the code is in details, not message.
  eq(
    messageFrom({ message: "server error", details: "GL_OB_FROZEN: closed" }),
    "GL_OB_FROZEN: closed",
    "prefers the part carrying a refusal code",
  );
  eq(messageFrom(null), "", "null");
  eq(messageFrom(undefined), "", "undefined");
  eq(messageFrom({}), "", "empty object");

  // --- explainGlRefusal: recognised ------------------------------------
  const forbidden = explainGlRefusal("TB_FORBIDDEN: the general ledger is admin-only.");
  ok(forbidden.recognised, "TB_FORBIDDEN is recognised");
  ok(forbidden.isPermission, "TB_FORBIDDEN is a permission refusal");
  eq(forbidden.code, "TB_FORBIDDEN", "code carried through");
  ok(forbidden.raw.length > 0, "raw preserved on recognised refusals");
  ok(!forbidden.title.includes("TB_"), "the machine token is not in the title");

  const backwards = explainGlRefusal(
    "TB_RANGE_BACKWARDS: the range starts 2026-12-31 and ends 2026-01-01.",
  );
  ok(backwards.recognised, "TB_RANGE_BACKWARDS recognised");
  ok(!backwards.isPermission, "a backwards range is not a permission problem");

  // --- DEFECT D3 REGRESSION --------------------------------------------
  // The database's own sentence carries the ACTUAL figures. It used to be
  // computed and thrown away by a ternary with two identical branches, so a
  // recognised refusal told the owner less than an unrecognised one did.
  ok(
    backwards.detail === "the range starts 2026-12-31 and ends 2026-01-01.",
    `the specifics survive onto .detail (got ${JSON.stringify(backwards.detail)})`,
  );
  const unbalanced = explainGlRefusal(
    "GL_OUT_OF_BALANCE: journal 41 is out of balance by 2500 cents (debits and credits must be equal)",
  );
  ok(unbalanced.detail.includes("2500"), "the owner is told BY HOW MUCH, not just that it fails");
  ok(unbalanced.detail.includes("journal 41"), "and WHICH journal");
  // The machine token must never survive into the human-facing detail.
  ok(!unbalanced.detail.includes("GL_OUT_OF_BALANCE"), "detail carries no machine token");
  // A bare code with no sentence must not fabricate detail.
  eq(explainGlRefusal("GL_OUT_OF_BALANCE:").detail, "", "a bare code produces no detail");
  // An unrecognised failure shows its raw text in full, so detail stays empty
  // rather than printing the same words twice on screen.
  eq(explainGlRefusal("fetch failed").detail, "", "unknown failures do not duplicate raw as detail");

  // --- explainGlRefusal: THE CRITICAL BRANCH ---------------------------
  // An unknown failure must NEVER be dressed up as understood.
  const unknown = explainGlRefusal("fetch failed");
  ok(!unknown.recognised, "an unknown error is NOT marked recognised");
  ok(!unknown.isPermission, "an unknown error is not a permission refusal");
  eq(unknown.raw, "fetch failed", "raw text preserved verbatim");
  ok(
    unknown.title.toLowerCase().includes("unexpected"),
    "unknown errors are labelled unexpected",
  );
  ok(
    !/try again|please retry/i.test(unknown.whatToDo),
    "we must NOT tell the user to blindly retry an unknown failure",
  );

  // A code-shaped failure we have never heard of is ALSO unrecognised.
  const futureCode = explainGlRefusal("GL_SOMETHING_NEW: invented later");
  ok(!futureCode.recognised, "an unlisted code is not silently 'recognised'");
  eq(futureCode.code, "GL_SOMETHING_NEW", "but its code is still reported");
  ok(futureCode.raw.includes("invented later"), "and its text is preserved");

  // Empty failure.
  const silent = explainGlRefusal(null);
  ok(!silent.recognised, "a silent failure is not recognised");
  ok(silent.title.length > 0, "a silent failure still says something");

  // --- isPermissionRefusal ---------------------------------------------
  ok(isPermissionRefusal("GL_FORBIDDEN: x"), "GL_FORBIDDEN is a permission wall");
  ok(!isPermissionRefusal("GL_OUT_OF_BALANCE: x"), "out of balance is not");
  ok(!isPermissionRefusal("fetch failed"), "unknown is not a permission wall");

  // --- DEFECT D1 REGRESSION --------------------------------------------
  // Four codes sat in this catalogue that NOTHING in the codebase ever raised
  // (GL_LINE_IN_THE_SAND, GL_OB_FORBIDDEN, GL_OB_OUT_OF_BALANCE,
  // GL_OB_WRONG_ENTITY). They looked like coverage and provided none, while
  // the REAL refusals fell through to "not one of the checks we wrote". The
  // authoritative spellings are asserted here; the drift test in
  // tests/compliance/gl-refusal-core.test.ts checks the whole set against the
  // migrations on every run.
  ok(
    explainGlRefusal("GL_BEFORE_LINE_IN_THE_SAND: dated 2025-12-31").recognised,
    "the real pre-cut-over code is the one that is explained",
  );
  ok(
    !knownRefusalCodes().includes("GL_LINE_IN_THE_SAND"),
    "the phantom GL_LINE_IN_THE_SAND spelling is gone",
  );
  ok(
    !knownRefusalCodes().includes("GL_OB_FORBIDDEN"),
    "GL_OB_FORBIDDEN never existed; the OB worksheet raises plain GL_FORBIDDEN",
  );
  ok(
    explainGlRefusal("GL_FORBIDDEN: the opening balance worksheet is admin-only.").isPermission,
    "the OB worksheet refusal is understood as a permission wall",
  );
  ok(
    explainGlRefusal(
      "GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: account 12100 (Inventory) may only be used by these books: greenway.",
    ).recognised,
    "the real OB wrong-entity code is explained",
  );

  // --- coverage --------------------------------------------------------
  const codes = knownRefusalCodes();
  ok(codes.length >= 70, `at least 70 refusals are explained (got ${codes.length})`);
  // Spot-check the ones that cost real money if they read as gibberish.
  for (const c of [
    "GL_IMMUTABLE",
    "GL_PERIOD_LOCKED",
    "GL_INVENTORY_MANUAL",
    "GL_COST_CLASS_REQUIRED",
    "GL_LAND_NOT_DEPRECIABLE",
    "GL_AUTOPOST_NO_THREE_WAY_MATCH",
  ]) {
    ok(codes.includes(c), `${c} is explained in plain English`);
  }
  ok(codes.includes("GL_APPROVAL_REQUIRED"), "the approval rule is explained");
  ok(codes.includes("GL_OVERRIDE_LOG_APPEND_ONLY"), "the override log rule is explained");
  // Every entry must actually have both halves filled in. A blank whatToDo
  // would render as an explanation with no instruction.
  for (const c of codes) {
    const r = REFUSALS[c];
    ok(r.title.trim().length > 0, `${c} has a title`);
    ok(r.whatToDo.trim().length > 0, `${c} says what to do`);
    ok(!r.title.includes(c), `${c} title does not leak the machine token`);
  }

  // --- SUBSTANCE, not merely non-emptiness ---------------------------------
  //
  // The three checks above were the whole guard, and a mutation campaign found
  // the hole: an explanation gutted down to a stub still passed, because
  // "TODO" and "Please try again." are both non-empty strings.
  //
  // Non-empty is the wrong bar. The entire purpose of this file is that the
  // owner is told what to DO, and "something went wrong" is precisely the
  // reassuring non-answer this file exists to prevent (see the header). The
  // real shortest instruction in the table is 38 characters, so 30 is a floor
  // no genuine explanation trips over and no stub can clear.
  const MIN_TITLE = 15;
  const MIN_INSTRUCTION = 30;
  for (const c of codes) {
    const r = REFUSALS[c];
    ok(
      r.title.trim().length >= MIN_TITLE,
      `${c} title is a real sentence, not a stub (got ${r.title.trim().length} chars)`,
    );
    ok(
      r.whatToDo.trim().length >= MIN_INSTRUCTION,
      `${c} instruction is a real instruction, not a stub (got ${r.whatToDo.trim().length} chars)`,
    );
  }
  // NEGATIVE CONTROL (rule 15b): prove those thresholds can actually reject
  // something. If they were set to 0 the loop above would be decorative.
  ok("TODO".length < MIN_INSTRUCTION, "a TODO stub would be rejected as an instruction");
  ok(
    "Something went wrong, please try again.".length >= MIN_INSTRUCTION,
    "length alone cannot catch a plausible-sounding non-answer",
  );
  // ...which is exactly why length is not the only guard. The banned-phrase
  // check below catches the plausible-sounding ones that are long enough.
  const NON_ANSWERS = [
    "please try again",
    "something went wrong",
    "an error occurred",
    "unknown error",
    "contact support",
    "todo",
    "tbd",
  ];
  for (const c of codes) {
    const w = REFUSALS[c].whatToDo.toLowerCase();
    for (const phrase of NON_ANSWERS) {
      ok(
        !w.includes(phrase),
        `${c} does not fall back on the non-answer "${phrase}"`,
      );
    }
  }
  // NEGATIVE CONTROL for the banned-phrase guard.
  ok(
    NON_ANSWERS.some((p) => "Something went wrong, please try again.".toLowerCase().includes(p)),
    "the non-answer guard genuinely detects a cheerful fallback",
  );

  // --- D9 REGRESSION: no LITERAL escape sequences in reader-facing prose ----
  //
  // A real defect, found in this file and fixed: 51 explanations contained a
  // DOUBLED backslash-u escape, e.g. "\\u00a7280E". In TypeScript source that
  // is a backslash followed by the letter u — not the character it names — so
  // the owner literally read "\u00a7280E report reads the cost class" on
  // screen instead of "§280E report reads the cost class".
  //
  // Nothing failed. It typechecked, every test passed, and the string was
  // non-empty, so every check above was perfectly happy. The only symptom was
  // gibberish in front of the one person these sentences exist for — in the
  // middle of the explanation of the most expensive rule in the business.
  //
  // This guard is the reason it cannot come back. Prose renders characters.
  const ESCAPE_IN_PROSE = /\\u[0-9a-fA-F]{4}/;
  for (const c of codes) {
    const r = REFUSALS[c];
    ok(
      !ESCAPE_IN_PROSE.test(r.title),
      `${c} title renders real characters, not a literal escape sequence`,
    );
    ok(
      !ESCAPE_IN_PROSE.test(r.whatToDo),
      `${c} instruction renders real characters, not a literal escape sequence`,
    );
  }
  // NEGATIVE CONTROL (rule 15b): prove the guard above can actually fail.
  // If this regex ever stops matching, the loop is decorative.
  ok(
    ESCAPE_IN_PROSE.test("Every \\u00a7280E report reads the cost class"),
    "the escape-sequence guard genuinely detects the D9 defect",
  );
  ok(
    !ESCAPE_IN_PROSE.test("Every §280E report reads the cost class"),
    "the escape-sequence guard does not fire on correct prose",
  );

  // --- the three sign-off refusals (slice books-05, defect D8) -------------
  //
  // These arrive from gl_sign_off_bank_reconciliation(). Before this block
  // they had no translation at all, so the owner would have been shown a raw
  // GL_ token at the exact moment the system was trying to stop him closing a
  // month that was not finished.
  for (const c of [
    "GL_BANK_UNRECORDED_ITEMS",
    "GL_BANK_DOES_NOT_TIE",
    "GL_BANK_ALREADY_SIGNED_OFF",
  ]) {
    ok(codes.includes(c), `${c} is explained in plain English`);
    ok(explainGlRefusal(`${c}: raw database detail`).recognised, `${c} is recognised`);
  }

  // The unrecorded-items explanation must teach the trap, not just report it.
  // "Ties" and "complete" are different questions and the wording has to say
  // so, because the whole defect was a month that tied and was not finished.
  {
    const r = REFUSALS.GL_BANK_UNRECORDED_ITEMS;
    ok(
      /cancels itself out/i.test(r.whatToDo),
      "the unrecorded-items explanation says WHY the difference came to zero",
    );
    ok(
      /3\.1\.9\.15\(4\)/.test(r.whatToDo),
      "the unrecorded-items explanation cites BARS 3.1.9.15(4) verbatim",
    );
    ok(
      /interest earned, bank fees or charges, NSF checks, and unrecorded deposits/.test(
        r.whatToDo,
      ),
      "the BARS quotation is reproduced exactly, not paraphrased",
    );
    ok(
      !/^Everything ties/i.test(r.title),
      "the title must never congratulate a month that is not finished",
    );
  }
  // The does-not-tie explanation must name the plug for what it is. The owner's
  // own $4,624,697.31 entry is the permanent teaching example (standing rule 19).
  {
    const r = REFUSALS.GL_BANK_DOES_NOT_TIE;
    ok(
      /4,624,697\.31/.test(r.whatToDo),
      "the does-not-tie explanation cites the owner's real plug entry",
    );
    ok(/plug/i.test(r.whatToDo), "the does-not-tie explanation names a plug a plug");
    ok(
      /3\.1\.9\.15\(5\)/.test(r.whatToDo),
      "the does-not-tie explanation cites BARS 3.1.9.15(5)",
    );
  }

  console.log(`gl-refusal-core: PASSED ${passed} assertions`);
}
