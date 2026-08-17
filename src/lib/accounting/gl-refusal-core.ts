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

  console.log(`gl-refusal-core: PASSED ${passed} assertions`);
}
