/**
 * src/lib/accounting/internal-control-authorities.ts   (books-28)
 *
 * COSO, VERBATIM, PLUS THE PUBLIC-DOMAIN FRAMEWORK THAT ADOPTS IT.
 *
 * Michael asked for this directly:
 *
 *   "also, I do want you to update the cpa cfo mentor to have verbatim coso. I
 *    did research on this and I dont think there is a way for me to get you the
 *    full text verbatim. but they have free executive summaries available for
 *    free and in pdf form, use them and then find any other free way to cite
 *    coso. be clever to get the info you need. I want a system that follows the
 *    authoritative source documents precisely so we stay compliant, save money,
 *    and report accurately."
 *
 * He was RIGHT that the full 2013 Framework is not freely available. It is sold
 * by the AICPA and there is no lawful free copy of the complete text. So this
 * slice does exactly what he asked, by two routes, and is explicit about which
 * words came from where.
 *
 * ROUTE 1 - COSO'S OWN EXECUTIVE SUMMARY. COSO publishes the Executive Summary
 * of "Internal Control - Integrated Framework" (May 2013) free of charge on
 * coso.org. It contains, in COSO's own words, the DEFINITION of internal
 * control, the five components, and ALL SEVENTEEN PRINCIPLES. That is the
 * spine of the framework, and it is the part a business actually applies.
 * Mirrored at docs/authorities/coso/.
 *
 * ROUTE 2 - THE GAO GREEN BOOK, WHICH IS PUBLIC DOMAIN. "Standards for
 * Internal Control in the Federal Government" (GAO-25-107721, 2025;
 * GAO-14-704G, 2014) is a work of the United States Government and therefore
 * carries no copyright (17 U.S.C. section 105). It ADOPTS COSO's five
 * components and seventeen principles by name and says so in its own text -
 * see `green-book-2025-adopts-coso` below. Where COSO's free summary is terse,
 * the Green Book expands the same principle into full paragraphs that CAN be
 * quoted without limit. That is the "other free way to cite coso" Michael
 * asked me to find: not a workaround, but the U.S. Comptroller General's
 * formal restatement of the same framework.
 *
 * WHAT THIS IS NOT. It is not a claim that Greenway is subject to COSO. Michael
 * is a private S-corporation with no external audit requirement and no
 * Sarbanes-Oxley obligation. COSO is quoted here because it is the clearest
 * written description in existence of how a small organisation keeps itself
 * honest - and because a one-person accounting department has the single worst
 * segregation-of-duties problem there is, which is precisely what principles 3,
 * 5 and 10 are about. See INTERNAL_CONTROL_APPLICABILITY_DISCLAIMER.
 *
 * SOURCE DISCIPLINE (standing rules 24 and 35). Every quote below is an EXACT
 * substring of a primary source mirrored on disk under `docs/authorities/`,
 * and `scripts/verify-verbatim-quotes.ts` proves it by machine on every run.
 * All thirty-seven were verified mechanically BEFORE this file was written, not
 * after - three drafts FAILED that check and were corrected against the source
 * rather than shipped:
 *
 *   - "A major deficiency represents an internal control deficiency or
 *     combination of deficiencies that severely reduces the likelihood..." was
 *     INVENTED WORDING. COSO actually writes "When a major deficiency EXISTS
 *     with respect to the presence and functioning of...". Corrected.
 *   - The Green Book's effectiveness test was drafted as one flowing sentence.
 *     It is really two bullets, the first ending "...implemented, and operating
 *     and". Corrected, and quoted as ordered segments.
 *   - COSO's Principle 1 could not be quoted from COSO AT ALL. See the note on
 *     `GREEN_BOOK_PRINCIPLE_1_INTEGRITY`.
 *
 * COPYRIGHT. The COSO Executive Summary is (c) 2013 COSO, all rights reserved,
 * distributed free by COSO for exactly this kind of reference. It is quoted
 * here - short passages, attributed, in a private repository - not
 * redistributed. The Green Book material is a work of the United States
 * Government and is not subject to copyright.
 *
 * PURE DATA. No I/O, no clock, no randomness, no server-only imports.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

/**
 * Shown wherever one of these authorities appears on a screen.
 *
 * Michael has a Master's in accounting, so he knows what COSO is. He does NOT
 * need to be frightened into thinking a framework written for audited public
 * companies is a compliance obligation of a Port Orchard retail shop. Saying so
 * plainly is the difference between teaching him and alarming him - the same
 * reasoning as AUDITING_STANDARD_DISCLAIMER in books-guidance-core.
 */
export const INTERNAL_CONTROL_APPLICABILITY_DISCLAIMER =
  "No law requires Greenway to follow COSO. You are a private S-corporation with no external audit and no " +
  "Sarbanes-Oxley obligation, and nobody will ever ask you for a COSO assessment. It is quoted here because " +
  "it is the best written description anywhere of how a small business keeps itself honest, and because a " +
  "one-person accounting department has the worst separation-of-duties problem that exists - which is exactly " +
  "what these principles are about. Use it as a checklist for catching your own mistakes, not as a rulebook " +
  "someone is grading you against.";

// ---------------------------------------------------------------------------
// 1) THE DEFINITION, AND WHAT THE FRAMEWORK CLAIMS FOR ITSELF
// ---------------------------------------------------------------------------

/**
 * The sentence the whole framework rests on. Note what it does NOT promise:
 * certainty. "Reasonable assurance" is doing deliberate work in that sentence,
 * and the two limitation records below are COSO admitting it.
 */
export const COSO_DEFINITION_OF_INTERNAL_CONTROL: GuidanceAuthority = {
  id: "coso-2013-definition-of-internal-control",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Definition",
  quote:
    "Internal control is a process, effected by an entity's board of directors, management, and other " +
    "personnel, designed to provide reasonable assurance regarding the achievement of objectives relating " +
    "to operations, reporting, and compliance.",
  soWhat:
    "Three words matter for you. 'Process' means internal control is something you DO repeatedly, not a " +
    "document you write once. 'Reasonable assurance' means the goal was never perfection - it is being " +
    "wrong rarely and catching it fast. And 'other personnel' means your budtenders are part of your " +
    "control system whether anyone told them so or not, because they are the ones touching cash and " +
    "product all day.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_SEVENTEEN_PRINCIPLES: GuidanceAuthority = {
  id: "coso-2013-seventeen-principles",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Components and Principles",
  quote:
    "The Framework sets out seventeen principles representing the fundamental concepts associated with " +
    "each component.",
  soWhat:
    "Seventeen is a finite, checkable list, which is why this system stores them as data rather than prose. " +
    "You are not expected to memorise them. You are expected to be able to answer each one honestly once a " +
    "year, and to notice which answers you would rather not give.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_ALL_PRINCIPLES_APPLY: GuidanceAuthority = {
  id: "coso-2013-all-principles-apply",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Components and Principles",
  quote: "All principles apply to operations, reporting, and compliance objectives.",
  soWhat:
    "There is no small-business exemption inside the framework itself. What changes with size is HOW a " +
    "principle is satisfied, not WHETHER it applies. You cannot segregate duties across ten people you do " +
    "not employ - so for you the answer to principle 10 is compensating controls and an owner who actually " +
    "looks, and the framework expects you to say that out loud rather than skip the question.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_EFFECTIVE_SYSTEM_REQUIREMENTS: GuidanceAuthority = {
  id: "coso-2013-effective-system-requirements",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Effective Internal Control",
  quote: "The Framework sets forth the requirements for an effective system of internal control.",
  soWhat:
    "'Requirements', not suggestions - inside the framework's own terms. This matters when you are deciding " +
    "whether to skip a control because it is inconvenient: the framework does not offer a partial credit " +
    "option, it offers a conclusion of effective or not effective.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_REASONABLE_ASSURANCE: GuidanceAuthority = {
  id: "coso-2013-reasonable-assurance",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Effective Internal Control",
  quote:
    "An effective system provides reasonable assurance regarding achievement of an entity's objectives.",
  soWhat:
    "This is the sentence to remember on the day you find a mistake. A control system that produced one " +
    "error is not a failed control system. A control system that produced an error NOBODY CAUGHT is a " +
    "different matter, and that is the distinction this whole application is built to make visible.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRESENT_AND_FUNCTIONING: GuidanceAuthority = {
  id: "coso-2013-present-and-functioning",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Effective Internal Control",
  quote: "Each of the five components and relevant principles is present and functioning.",
  soWhat:
    "Two separate tests, and the second is the one that fails quietly. 'Present' means the control exists - " +
    "you have a month-end checklist. 'Functioning' means it actually runs - somebody completed it in " +
    "September. A checklist nobody filled in is present and not functioning, which the framework counts as " +
    "a deficiency, not as partial credit.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_COMPONENTS_OPERATE_TOGETHER: GuidanceAuthority = {
  id: "coso-2013-components-operate-together",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Effective Internal Control",
  quote: "The five components operate together in an integrated manner.",
  soWhat:
    "You can pass every individual test and still fail this one. Perfect records that nobody reviews, or a " +
    "sharp-eyed owner with no records to review, are both single-component successes and system failures. " +
    "The components have to feed each other.",
  source: "https://www.coso.org/guidance-on-ic",
};

/**
 * WHAT A FAILURE ACTUALLY MEANS, in COSO's own words.
 *
 * FIRST DRAFT OF THIS QUOTE WAS INVENTED and the verbatim gate caught it. I had
 * written "A major deficiency represents an internal control deficiency or
 * combination of deficiencies that severely reduces the likelihood that the
 * entity can achieve its objectives" - which reads plausibly, sounds like COSO,
 * and does not appear anywhere in the document. The real sentence is below.
 * This is precisely the failure mode standing rule 35 exists to catch, and it
 * caught it in milliseconds on a quote I would have sworn was right.
 */
export const COSO_MAJOR_DEFICIENCY: GuidanceAuthority = {
  id: "coso-2013-major-deficiency",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Effective Internal Control",
  quote:
    "When a major deficiency exists with respect to the presence and functioning of a component or relevant " +
    "principle, or with respect to the components operating together in an integrated manner, the " +
    "organization cannot conclude that it has met the requirements for an effective system of internal " +
    "control.",
  soWhat:
    "One serious hole sinks the whole conclusion - the framework does not average your score. Practically: " +
    "if nobody but you can detect a cash shortage, you do not have 'mostly effective' controls over cash. " +
    "You have a major deficiency with a good outcome so far.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_LIMITATIONS_EXIST: GuidanceAuthority = {
  id: "coso-2013-limitations-exist",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Limitations",
  quote:
    "The Framework recognizes that while internal control provides reasonable assurance of achieving the " +
    "entity's objectives, limitations do exist.",
  soWhat:
    "COSO admitting its own ceiling, which is why this is quoted rather than hidden. No arrangement of " +
    "controls survives two people deciding together to steal, and no checklist substitutes for judgement. " +
    "Anyone who sells you a system that eliminates risk is selling you something COSO itself says does not " +
    "exist.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_CANNOT_PREVENT_BAD_JUDGMENT: GuidanceAuthority = {
  id: "coso-2013-cannot-prevent-bad-judgment",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Limitations",
  quote:
    "Internal control cannot prevent bad judgment or decisions, or external events that can cause an " +
    "organization to fail to achieve its operational goals.",
  soWhat:
    "Worth reading twice before you blame your bookkeeping for a bad year. Controls tell you the truth " +
    "about what happened; they do not decide what to buy, what to charge, or whether the market moved. " +
    "Their job is to make sure you learn the truth early enough to act on it.",
  source: "https://www.coso.org/guidance-on-ic",
};

// ---------------------------------------------------------------------------
// 2) THE SEVENTEEN PRINCIPLES, VERBATIM
//
// Principles 2-17 are quoted from COSO's own free Executive Summary.
//
// PRINCIPLE 1 IS DELIBERATELY ABSENT FROM THIS BLOCK and is supplied from the
// Green Book instead. The reason is mechanical, not editorial: in the COSO PDF
// the words are printed as
//
//     1. The organization2
//     demonstrates a commitment to integrity and ethical values.
//
// where the "2" is a footnote marker glued to "organization" by the typesetter.
// `normalise` in the verbatim checker strips a footnote digit only when it
// follows a FULL STOP, so this one survives into the haystack and no honest
// transcription of the sentence can match it. The three available options were:
//
//   (a) quote "The organization2 demonstrates..." - transcribing a typesetting
//       artefact into an authority record, which is worse than useless because
//       it teaches the reader a footnote marker is part of the standard;
//   (b) widen the shared `normalise` footnote rule - touching the function that
//       every ASC, CFR and Green Book quote in the repository already depends
//       on, to fix one sentence. Standing rule 40 says a load-bearing rule
//       gets tested, and this change could not be made load-bearing without
//       risking silent damage elsewhere;
//   (c) cite the SAME principle from the Green Book, where it is printed as one
//       clean sentence, and say so plainly.
//
// (c) chosen. The wording differs because the Green Book is written for
// government ("oversight body and management" rather than "the organization"),
// and that difference is disclosed in the record's own comment rather than
// papered over. Nothing is lost: the principle is identical in substance and
// the reader can see both framings.
// ---------------------------------------------------------------------------

export const COSO_PRINCIPLE_2_BOARD_INDEPENDENCE: GuidanceAuthority = {
  id: "coso-2013-principle-2-board-independence",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 2",
  quote:
    "The board of directors demonstrates independence from management and exercises oversight of the " +
    "development and performance of internal control.",
  soWhat:
    "You are the board and you are management, so independence is impossible and pretending otherwise " +
    "would be theatre. What you CAN do is buy oversight: your CPA reviewing the year, this system flagging " +
    "what you would rather not look at, and a written record that outlives your memory. Name the gap " +
    "honestly - an owner who knows he has no independent check behaves more carefully than one who thinks " +
    "he has one.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_3_STRUCTURES: GuidanceAuthority = {
  id: "coso-2013-principle-3-structures",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 3",
  quote:
    "Management establishes, with board oversight, structures, reporting lines, and appropriate authorities " +
    "and responsibilities in the pursuit of objectives.",
  soWhat:
    "In practice this is the question 'who is allowed to do what, and who finds out'. Who can void a sale, " +
    "who can adjust inventory, who can add an employee to payroll, who can move money. If the answer to " +
    "all four is 'anyone with the manager password', that is the finding.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_4_COMPETENT_INDIVIDUALS: GuidanceAuthority = {
  id: "coso-2013-principle-4-competent-individuals",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 4",
  quote:
    "The organization demonstrates a commitment to attract, develop, and retain competent individuals in " +
    "alignment with objectives.",
  soWhat:
    "Retention IS a control, which is not obvious until you have lived it. Turnover destroys institutional " +
    "memory: the person who knew why that inventory adjustment was made leaves, and the entry becomes " +
    "unexplainable. Every documented procedure in this system is partly insurance against that.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_5_ACCOUNTABILITY: GuidanceAuthority = {
  id: "coso-2013-principle-5-accountability",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 5",
  quote:
    "The organization holds individuals accountable for their internal control responsibilities in the " +
    "pursuit of objectives.",
  soWhat:
    "Accountability needs a name attached to a task, not a policy on a wall. 'Someone counts the drawer' " +
    "is not a control; 'Angela counts the drawer at close and initials it' is. This is also why the audit " +
    "trail in this system records WHO, not just what.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_6_SPECIFIES_OBJECTIVES: GuidanceAuthority = {
  id: "coso-2013-principle-6-specifies-objectives",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 6",
  quote:
    "The organization specifies objectives with sufficient clarity to enable the identification and " +
    "assessment of risks relating to objectives.",
  soWhat:
    "You cannot list your risks until you have said what you are trying to achieve. 'File accurate excise " +
    "returns on time' is specific enough to generate a risk list - late filing, wrong rate, missed sale. " +
    "'Stay compliant' generates nothing you can act on.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_7_IDENTIFIES_RISKS: GuidanceAuthority = {
  id: "coso-2013-principle-7-identifies-risks",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 7",
  quote:
    "The organization identifies risks to the achievement of its objectives across the entity and analyzes " +
    "risks as a basis for determining how the risks should be managed.",
  soWhat:
    "'Across the entity' is the part people skip. Your payroll risk, your excise risk, your inventory risk " +
    "and your cash risk are not four separate problems - a bad inventory count becomes a bad COGS figure " +
    "becomes a bad tax return. Follow each risk to where it lands.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_8_FRAUD_RISK: GuidanceAuthority = {
  id: "coso-2013-principle-8-fraud-risk",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 8",
  quote:
    "The organization considers the potential for fraud in assessing risks to the achievement of objectives.",
  soWhat:
    "'Considers the potential' - not 'suspects your staff'. It is a structural question: where in this " +
    "business could someone take something and not be caught quickly? In a cash-heavy cannabis retailer the " +
    "honest answer is several places, and knowing which ones is not paranoia, it is the job.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_9_CHANGES: GuidanceAuthority = {
  id: "coso-2013-principle-9-changes",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 9",
  quote:
    "The organization identifies and assesses changes that could significantly impact the system of " +
    "internal control.",
  soWhat:
    "This is the principle that applies to you RIGHT NOW. Moving off Sage onto this system in January 2027 " +
    "is exactly the 'significant change' this names. Controls that depended on Sage's behaviour have to be " +
    "re-established here deliberately, which is why the cutover is being built as a reconciliation rather " +
    "than a switch.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_10_CONTROL_ACTIVITIES: GuidanceAuthority = {
  id: "coso-2013-principle-10-control-activities",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 10",
  quote:
    "The organization selects and develops control activities that contribute to the mitigation of risks " +
    "to the achievement of objectives to acceptable levels.",
  soWhat:
    "'To acceptable levels', not to zero - the framework is telling you to stop when the control costs more " +
    "than the risk. A second person counting every drawer is not worth a salary; a daily variance report " +
    "you actually read costs nothing and catches the same thing later.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_11_TECHNOLOGY_CONTROLS: GuidanceAuthority = {
  id: "coso-2013-principle-11-technology-controls",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 11",
  quote:
    "The organization selects and develops general control activities over technology to support the " +
    "achievement of objectives.",
  soWhat:
    "Once your books live in software, the software IS a control - and so is who can log into it. Shared " +
    "passwords, an admin account everyone uses, or a database anyone can edit directly will undo every " +
    "other control on this list. That is why this system has row-level security and an audit trail rather " +
    "than trust.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_12_DEPLOYS_THROUGH_POLICIES: GuidanceAuthority = {
  id: "coso-2013-principle-12-deploys-through-policies",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 12",
  quote:
    "The organization deploys control activities through policies that establish what is expected and " +
    "procedures that put policies into action.",
  soWhat:
    "Policy says what; procedure says how, who and when. 'Cash is counted daily' with no named person, no " +
    "time and no place to record it is a policy with no procedure - which reliably becomes a policy with no " +
    "compliance.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_13_QUALITY_INFORMATION: GuidanceAuthority = {
  id: "coso-2013-principle-13-quality-information",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 13",
  quote:
    "The organization obtains or generates and uses relevant, quality information to support the " +
    "functioning of internal control.",
  soWhat:
    "The word 'uses' is the sharp one. A report that is produced and not read is not information, it is " +
    "paper. This is the principle behind every plain-English report in this system: a number you do not " +
    "understand cannot control anything.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_14_INTERNAL_COMMUNICATION: GuidanceAuthority = {
  id: "coso-2013-principle-14-internal-communication",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 14",
  quote:
    "The organization internally communicates information, including objectives and responsibilities for " +
    "internal control, necessary to support the functioning of internal control.",
  soWhat:
    "People cannot follow a control they were never told about. If your staff do not know WHY the drawer is " +
    "counted, they will treat it as a chore and eventually skip it. Telling them what the count protects - " +
    "them, as much as you - is the control.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_15_EXTERNAL_COMMUNICATION: GuidanceAuthority = {
  id: "coso-2013-principle-15-external-communication",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 15",
  quote:
    "The organization communicates with external parties regarding matters affecting the functioning of " +
    "internal control.",
  soWhat:
    "Your CPA, the LCB, the Department of Revenue, ESD and L&I are all external parties whose information " +
    "changes what you must do. A rate change nobody told the payroll system about is a control failure that " +
    "started outside the building.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_16_EVALUATIONS: GuidanceAuthority = {
  id: "coso-2013-principle-16-evaluations",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 16",
  quote:
    "The organization selects, develops, and performs ongoing and/or separate evaluations to ascertain " +
    "whether the components of internal control are present and functioning.",
  soWhat:
    "Two kinds, and you need both. 'Ongoing' is the daily reconciliation that fails loudly the same day. " +
    "'Separate' is standing back once a quarter to ask whether the controls still fit the business - which " +
    "is the one that gets skipped, because nothing breaks when you skip it.",
  source: "https://www.coso.org/guidance-on-ic",
};

export const COSO_PRINCIPLE_17_COMMUNICATES_DEFICIENCIES: GuidanceAuthority = {
  id: "coso-2013-principle-17-communicates-deficiencies",
  kind: "internal_control_framework",
  cite: "COSO, Internal Control - Integrated Framework, Executive Summary (May 2013), Principle 17",
  quote:
    "The organization evaluates and communicates internal control deficiencies in a timely manner to those " +
    "parties responsible for taking corrective action, including senior management and the board of " +
    "directors, as appropriate.",
  soWhat:
    "Finding a problem and not reporting it is its own deficiency. In your shop 'those parties responsible' " +
    "is usually you - so the practical form of this principle is that the system must be built to tell you " +
    "bad news promptly and in plain words, instead of burying it in a report nobody opens. That is a design " +
    "requirement for this application, not advice for you.",
  source: "https://www.coso.org/guidance-on-ic",
};

// ---------------------------------------------------------------------------
// 3) THE GREEN BOOK - PUBLIC DOMAIN, AND IT SAYS IT ADOPTS COSO
//
// These records are the answer to "find any other free way to cite coso".
// GAO-25-107721 is a work of the U.S. Government, so unlike the COSO Framework
// it can be quoted at any length. The first record below is the load-bearing
// one: it is the Green Book, in its own words, stating the relationship.
// ---------------------------------------------------------------------------

export const GREEN_BOOK_ADOPTS_COSO: GuidanceAuthority = {
  id: "green-book-2025-adopts-coso",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Overview, para. 1",
  quote:
    "The Committee of Sponsoring Organizations of the Treadway Commission (COSO) provides internal control " +
    "guidance in its Internal Control - Integrated Framework, which introduced the concept of principles " +
    "related to the five components of internal control.",
  soWhat:
    "This is the sentence that makes the rest of this legitimate. The Comptroller General of the United " +
    "States states in a public-domain document that the Green Book's components and principles come from " +
    "COSO. So where COSO's free summary is one terse line, the Green Book's fuller treatment of the same " +
    "principle can be quoted here without a licence - which is how you get COSO's substance verbatim " +
    "without buying the Framework.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_ADAPTS_FOR_GOVERNMENT: GuidanceAuthority = {
  id: "green-book-2025-adapts-for-government",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Overview, para. 1",
  quote: "The Green Book adapts these principles for a government environment.",
  soWhat:
    "Quoted so the seam is visible rather than hidden. The Green Book's wording says 'oversight body' where " +
    "COSO says 'board of directors', because it was written for agencies. The principle underneath is the " +
    "same, but you should know which book a sentence came from - so every record here names its source in " +
    "the citation.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

/**
 * PRINCIPLE 1, supplied from the Green Book for the mechanical reason explained
 * at the head of section 2: COSO's own printing glues a footnote marker to the
 * word "organization", so no honest transcription of COSO's Principle 1 can be
 * verified as verbatim. The Green Book prints the same principle as one clean
 * sentence. The substance is identical; the wording is the government's.
 */
export const GREEN_BOOK_PRINCIPLE_1_INTEGRITY: GuidanceAuthority = {
  id: "green-book-2025-principle-1-integrity",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 1 (para. 1.01)",
  quote:
    "The oversight body and management should demonstrate a commitment to integrity and ethical values.",
  soWhat:
    "The first principle is about you, not about your staff, and it is first for a reason: everything below " +
    "it is unenforceable if the owner does not mean it. If the person who sets the rules also decides when " +
    "they do not apply, there is no control system - only a preference.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_PRINCIPLE_3_STRUCTURE: GuidanceAuthority = {
  id: "green-book-2025-principle-3-structure",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 3 (para. 3.01)",
  quote:
    "Management should establish an organizational structure, assign responsibility, and delegate authority " +
    "to achieve the entity's objectives.",
  soWhat:
    "The government wording is blunter than COSO's and easier to act on: structure, responsibility, " +
    "authority. Three things to write down for Greenway, one line each, and you have satisfied a principle " +
    "that most small businesses leave implicit until a dispute makes it urgent.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_PRINCIPLE_5_ACCOUNTABILITY: GuidanceAuthority = {
  id: "green-book-2025-principle-5-accountability",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 5 (para. 5.01)",
  quote:
    "Management should evaluate performance and hold individuals accountable for their internal control " +
    "responsibilities.",
  soWhat:
    "Note that evaluating performance comes FIRST. You cannot hold anyone accountable for a control you " +
    "never checked - and if the count sheet is never reviewed, the person filling it in learns that quickly.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_CONTROL_ENVIRONMENT_FOUNDATION: GuidanceAuthority = {
  id: "green-book-2025-control-environment-foundation",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Control Environment, Overview",
  quote: "The control environment is the foundation for an effective internal control system.",
  soWhat:
    "Foundation, not first item on a list. Every other control rests on whether the owner is serious. This " +
    "is why the framework starts with tone rather than with procedures - good procedures on a bad " +
    "foundation are a filing system, not a control system.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_TONE_AT_THE_TOP: GuidanceAuthority = {
  id: "green-book-2025-tone-at-the-top",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), para. 1.02",
  quote:
    "The oversight body and management demonstrate the importance of integrity and ethical values through " +
    "their directives, attitudes, and behavior.",
  soWhat:
    "'Behavior' is the operative word - staff copy what you do, not what you posted. An owner who takes " +
    "cash from the drawer for lunch and squares it later has taught the whole shop that the drawer is " +
    "approximate. This is the cheapest control you own and the only one you cannot delegate.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

/**
 * THE PRINCIPLE THAT HURTS MOST IN A ONE-PERSON ACCOUNTING DEPARTMENT.
 * Quoted from the Green Book because COSO's free summary does not spell
 * segregation of duties out at this level of detail - a concrete example of
 * ROUTE 2 earning its place rather than duplicating ROUTE 1.
 */
export const GREEN_BOOK_SEGREGATION_OF_DUTIES: GuidanceAuthority = {
  id: "green-book-2025-segregation-of-duties",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 10",
  quote:
    "Management divides or segregates key duties and responsibilities among different people to reduce the " +
    "risk of error, misuse, or fraud.",
  soWhat:
    "You cannot fully satisfy this and you should stop trying to pretend otherwise. One person recording " +
    "sales, counting cash, paying bills and reconciling the bank is the textbook definition of the problem. " +
    "What you can do is name it, then compensate: the owner reviews what the owner did not enter, the bank " +
    "feed is matched against records nobody can silently edit, and this system keeps an audit trail that " +
    "makes a quiet change loud. Documented compensating controls are a defensible answer; silence is not.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_DOCUMENTATION_REQUIRED: GuidanceAuthority = {
  id: "green-book-2025-documentation-required",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 3",
  quote: "Management develops and maintains documentation of its internal control system.",
  soWhat:
    "An undocumented control cannot be reviewed, handed over, or defended. This is also the practical " +
    "answer to 'why does this application write so much down' - a control that exists only in your head " +
    "disappears the day you are unavailable, which is exactly the day someone needs it.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

/**
 * The two-part effectiveness test, quoted as ORDERED SEGMENTS because the
 * source prints it as a lead-in and two bullets.
 *
 * SECOND DRAFT. My first attempt ran the two bullets together into one smooth
 * sentence ("...effectively designed, implemented, and operating together in an
 * integrated manner"), which is a paraphrase that reads better than the
 * original and says something subtly different - it merges two independent
 * tests into one. The verbatim gate rejected it. The real first bullet ends
 * "...implemented, and operating and", which is ungainly precisely because it
 * is a bullet, and the ellipses below preserve that structure honestly.
 */
export const GREEN_BOOK_EFFECTIVE_SYSTEM_TWO_TESTS: GuidanceAuthority = {
  id: "green-book-2025-effective-system-two-tests",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), para. OV3.02",
  quote:
    "an effective internal control system has...each of the five components of internal control effectively " +
    "designed, implemented, and operating and...the five components operating together in an integrated " +
    "manner.",
  soWhat:
    "Two tests, and both must pass. Each component has to be designed right, put in place, and actually " +
    "running - and then they have to work as one system. This is the checklist behind the year-end internal " +
    "control review this application will produce for you.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

export const GREEN_BOOK_NOT_EFFECTIVE_WHEN: GuidanceAuthority = {
  id: "green-book-2025-not-effective-when",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), para. OV3.03",
  quote:
    "If a principle or component is not effective, or the components are not operating together in an " +
    "integrated manner, then an internal control system cannot be effective.",
  soWhat:
    "The same 'no averaging' rule as COSO's major-deficiency sentence, stated as a plain if-then. It is " +
    "worth keeping in view whenever you are tempted to accept a known weakness because everything else " +
    "looks tidy.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

/**
 * PRINCIPLE 8, IN BOTH EDITIONS, ON PURPOSE.
 *
 * These two records quote the SAME principle number from the TWO Green Book
 * editions on disk, and they say materially different things:
 *
 *   2014: "the potential for fraud"
 *   2025: "risks related to fraud, improper payments, and information security"
 *
 * They are here for two reasons. The first is substantive - the 2025 rewording
 * adds information security to the fraud conversation, which is the right frame
 * for a business whose books now live in a database rather than a filing
 * cabinet. The second is mechanical: this pair is the PROOF that resolving a
 * Green Book citation to its correct edition is load-bearing rather than
 * decorative. Neither sentence appears in the other edition's file, so mislabel
 * either one and the verbatim gate fails immediately. A test asserts exactly
 * that, because an earlier mutation of a DIFFERENT Green Book quote survived -
 * that sentence happens to be word-for-word identical in both editions, so it
 * was a control mutant and proved nothing about routing (standing rule 60).
 */
export const GREEN_BOOK_2014_PRINCIPLE_8_FRAUD: GuidanceAuthority = {
  id: "green-book-2014-principle-8-fraud",
  kind: "internal_control_framework",
  cite: "GAO-14-704G, Standards for Internal Control in the Federal Government (2014), Principle 8 (para. 8.01)",
  quote:
    "Management should consider the potential for fraud when identifying, analyzing, and responding to risks.",
  soWhat:
    "The 2014 wording, kept because it is the shorter and clearer statement of the duty: when you list what " +
    "could go wrong, fraud goes on the list. Not because you suspect anyone, but because a list that omits " +
    "it is not a risk assessment.",
  source: "https://www.gao.gov/products/gao-14-704g",
};

export const GREEN_BOOK_2025_PRINCIPLE_8_FRAUD: GuidanceAuthority = {
  id: "green-book-2025-principle-8-fraud",
  kind: "internal_control_framework",
  cite: "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 8 (para. 8.01)",
  quote:
    "Management should consider risks related to fraud, improper payments, and information security when " +
    "identifying, analyzing, and responding to risks.",
  soWhat:
    "The current wording, and the additions are the point. 'Improper payments' covers paying the wrong " +
    "vendor, paying twice, or paying an invoice for goods never received - which is a real risk in a shop " +
    "with one person approving bills. 'Information security' is now part of internal control, not an IT " +
    "problem: who can log into your books IS an accounting control.",
  source: "https://www.gao.gov/products/gao-25-107721",
};

/**
 * Every internal-control authority introduced by this slice, in reading order:
 * the definition, what the framework claims and admits, the seventeen
 * principles, then the Green Book material.
 *
 * WIRING NOTE - READ BEFORE ADDING A RECORD. Exporting this array is not
 * enough to make these citations reachable. It must ALSO be spread into
 * `taggedCandidates()` in books-guidance-core.ts under a tag listed in
 * `ALL_SOURCE_REGISTRIES`. PAYROLL_TAX_AUTHORITIES sat exported and unimported
 * for an entire slice, which made thirty-six authorities invisible to
 * `findGuidanceAuthority()` while looking completely fine in its own file. This
 * slice's tests assert the wiring rather than trusting it.
 */
export const INTERNAL_CONTROL_AUTHORITIES: readonly GuidanceAuthority[] = [
  // The definition and the framework's own claims and limits
  COSO_DEFINITION_OF_INTERNAL_CONTROL,
  COSO_SEVENTEEN_PRINCIPLES,
  COSO_ALL_PRINCIPLES_APPLY,
  COSO_EFFECTIVE_SYSTEM_REQUIREMENTS,
  COSO_REASONABLE_ASSURANCE,
  COSO_PRESENT_AND_FUNCTIONING,
  COSO_COMPONENTS_OPERATE_TOGETHER,
  COSO_MAJOR_DEFICIENCY,
  COSO_LIMITATIONS_EXIST,
  COSO_CANNOT_PREVENT_BAD_JUDGMENT,
  // Principle 1 comes from the Green Book - see section 2's header comment
  GREEN_BOOK_PRINCIPLE_1_INTEGRITY,
  // Principles 2-17, verbatim from COSO's own Executive Summary
  COSO_PRINCIPLE_2_BOARD_INDEPENDENCE,
  COSO_PRINCIPLE_3_STRUCTURES,
  COSO_PRINCIPLE_4_COMPETENT_INDIVIDUALS,
  COSO_PRINCIPLE_5_ACCOUNTABILITY,
  COSO_PRINCIPLE_6_SPECIFIES_OBJECTIVES,
  COSO_PRINCIPLE_7_IDENTIFIES_RISKS,
  COSO_PRINCIPLE_8_FRAUD_RISK,
  COSO_PRINCIPLE_9_CHANGES,
  COSO_PRINCIPLE_10_CONTROL_ACTIVITIES,
  COSO_PRINCIPLE_11_TECHNOLOGY_CONTROLS,
  COSO_PRINCIPLE_12_DEPLOYS_THROUGH_POLICIES,
  COSO_PRINCIPLE_13_QUALITY_INFORMATION,
  COSO_PRINCIPLE_14_INTERNAL_COMMUNICATION,
  COSO_PRINCIPLE_15_EXTERNAL_COMMUNICATION,
  COSO_PRINCIPLE_16_EVALUATIONS,
  COSO_PRINCIPLE_17_COMMUNICATES_DEFICIENCIES,
  // The Green Book: adoption, and the parts it says better than the summary
  GREEN_BOOK_ADOPTS_COSO,
  GREEN_BOOK_ADAPTS_FOR_GOVERNMENT,
  GREEN_BOOK_PRINCIPLE_3_STRUCTURE,
  GREEN_BOOK_PRINCIPLE_5_ACCOUNTABILITY,
  GREEN_BOOK_CONTROL_ENVIRONMENT_FOUNDATION,
  GREEN_BOOK_TONE_AT_THE_TOP,
  GREEN_BOOK_SEGREGATION_OF_DUTIES,
  GREEN_BOOK_DOCUMENTATION_REQUIRED,
  GREEN_BOOK_EFFECTIVE_SYSTEM_TWO_TESTS,
  GREEN_BOOK_NOT_EFFECTIVE_WHEN,
  // Principle 8 in both editions - substantive, and the edition-routing proof
  GREEN_BOOK_2014_PRINCIPLE_8_FRAUD,
  GREEN_BOOK_2025_PRINCIPLE_8_FRAUD,
] as const;

/** Look up one authority introduced by this slice. Undefined, never a throw. */
export function findInternalControlAuthority(id: string): GuidanceAuthority | undefined {
  return INTERNAL_CONTROL_AUTHORITIES.find((a) => a.id === id);
}

/**
 * The five components, each with the principles that support it.
 *
 * Stored as data because the year-end internal-control review has to walk them
 * in order, and because COSO's own text says the principles are "drawn directly
 * from the components" - so the mapping is part of the standard, not a
 * presentation choice. Principle numbers are COSO's.
 */
export const COSO_COMPONENTS: readonly {
  readonly component: string;
  readonly principleNumbers: readonly number[];
  readonly plainEnglish: string;
}[] = [
  {
    component: "Control Environment",
    principleNumbers: [1, 2, 3, 4, 5],
    plainEnglish:
      "Whether the person in charge actually means it. Tone, structure, who is responsible for what, and " +
      "whether anyone is ever held to it.",
  },
  {
    component: "Risk Assessment",
    principleNumbers: [6, 7, 8, 9],
    plainEnglish:
      "Knowing what you are trying to achieve, then naming what could stop you - including fraud, and " +
      "including changes like moving off Sage.",
  },
  {
    component: "Control Activities",
    principleNumbers: [10, 11, 12],
    plainEnglish:
      "The things you actually do: counts, reconciliations, approvals, who can log in, and the written " +
      "procedures that say how.",
  },
  {
    component: "Information and Communication",
    principleNumbers: [13, 14, 15],
    plainEnglish:
      "Getting real numbers to the people who need them, telling staff why a control exists, and listening " +
      "to outsiders like your CPA and the state.",
  },
  {
    component: "Monitoring Activities",
    principleNumbers: [16, 17],
    plainEnglish:
      "Checking that the controls still run and still fit - and reporting what you find instead of filing it.",
  },
] as const;
