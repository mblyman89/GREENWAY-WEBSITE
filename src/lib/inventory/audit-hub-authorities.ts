/**
 * src/lib/inventory/audit-hub-authorities.ts   (slice books-12)
 *
 * THE METHOD AUTHORITIES — the written source for HOW a professional counts
 * inventory, as opposed to WHETHER the number is right.
 *
 * Michael asked, in his own words:
 *
 *   "What does the audit department from Deloitte use to audit inventory?
 *    I want our PhD level cpa/ cfo to mentor and guide me as all the other
 *    features do. I want to shadow this genius expert so I can become an
 *    expert too."
 *
 * The honest answer, and the reason this file exists: a Big Four inventory
 * observation is not a secret proprietary method. It is a standard, published,
 * boring procedure that every firm runs the same way, because the standard
 * tells them to. What Deloitte, PwC, EY and KPMG each have is an internal
 * methodology (Deloitte's is branded "Omnia"; EY's "EY Canvas"; KPMG's "Clara")
 * — but those are WORKFLOW TOOLS wrapped around the same public requirements.
 * The requirements themselves are quoted below, verbatim, from the primary text.
 *
 * So rather than name-dropping a methodology nobody outside those firms can
 * read, this module quotes the standard those methodologies implement. That is
 * the difference between telling Michael what the pros do and letting him read
 * it for himself.
 *
 * ---------------------------------------------------------------------------
 * WHICH STANDARD, AND WHY NOT THE ONE YOU MIGHT EXPECT
 * ---------------------------------------------------------------------------
 * Greenway is a private company. It is NOT an SEC issuer. So:
 *
 *   - PCAOB AS 2510 governs audits of PUBLIC companies. It does not apply to
 *     Greenway. The repo already quotes AS 2510.11 and .12 anyway, for the
 *     reason stated in AUDITING_STANDARD_DISCLAIMER: it is the clearest written
 *     description of the reasoning, and it is free to read.
 *
 *   - AICPA AU-C section 501 is the standard that WOULD apply to an audit of
 *     Greenway. Its text is behind the AICPA's paywall/licence, and this slice
 *     could not retrieve it from a primary source.
 *
 *     STANDING RULE: never guess and never assume. So AU-C 501 IS NOT QUOTED
 *     HERE. Not one word of it. Quoting a paywalled standard from memory is
 *     precisely how a system ends up teaching confident nonsense.
 *
 *   - ISA 501 (IAASB) is the international standard that AU-C 501 is converged
 *     with, and it IS freely published. It is quoted below, cited honestly as
 *     ISA 501, with its status stated plainly in every `soWhat`.
 *
 * ---------------------------------------------------------------------------
 * A FABRICATED SOURCE WAS CAUGHT DURING THIS SLICE. RECORDED SO IT STAYS DEAD.
 * ---------------------------------------------------------------------------
 * A secondary article published as a "complete guide" to AS 2510 was found to
 * invent paragraph numbers and invent quoted text — labelling, for instance,
 * ".04 — Cycle Counts" and ".11 — Using a Specialist".
 *
 * Checked against the authoritative text at pcaobus.org, the real AS 2510 runs
 * .01–.02 (observation is a generally accepted auditing procedure), .03–.08
 * [Paragraphs deleted.], .09–.13 (Inventories), .14 (Public Warehouses),
 * .15 (Effect on the Auditor's Report). The real .11 is the statistical
 * sampling / cycle count paragraph; the real .12 is "tests of the accounting
 * records alone will not be sufficient".
 *
 * The repo's existing AS_2510_11_CYCLE_COUNT_BASIS and AS_2510_12_RECORDS_ALONE
 * were re-verified against the primary text and are CORRECT.
 *
 * `FABRICATION_WATCH` below records the incident, and a self-test asserts that
 * no authority in this module ever carries the fabricated numbering. This is
 * kept as DATA rather than a comment so the UI can show Michael the story: the
 * lesson ("check the primary source, a confident secondary source can be
 * fiction") is worth more to him than the citation itself.
 *
 * ---------------------------------------------------------------------------
 * TRANSCRIPTION PROVENANCE
 * ---------------------------------------------------------------------------
 * Every quote below was extracted mechanically with `pdftotext -layout` from:
 *   ISA 501, 2013 IAASB Handbook
 *   https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf
 * and cross-checked against the XRB (New Zealand) compilation of ISA (NZ) 501
 * and the FRC (UK & Ireland) 501 requirements text. Line breaks and hyphenation
 * introduced by the PDF layout were removed; NO wording was changed.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

/**
 * The ids this slice introduces. Mirrors the shape used by
 * inventory-audit-authorities.ts so the permitted-id gate works the same way.
 */
export const AUDIT_HUB_AUTHORITY_IDS = [
  "ISA_501_4_EXISTENCE_AND_CONDITION",
  "ISA_501_A7_TWO_WAY_TEST_COUNTS",
  "ISA_501_A4_COUNT_CONTROLS",
  "ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL",
  "ISA_501_A12_INCONVENIENCE_IS_NOT_A_REASON",
  "ISA_501_A5_CUTOFF_MOVEMENT",
] as const;

export type AuditHubAuthorityId = (typeof AUDIT_HUB_AUTHORITY_IDS)[number];

/**
 * Authorities owned by other modules that the hub RELIES ON but does not
 * redefine. Asserted resolvable by the self-tests, so a rename elsewhere fails
 * loudly here instead of quietly citing a ghost.
 */
export const AUDIT_HUB_BORROWED_AUTHORITY_IDS = [
  "AS_2510_11_CYCLE_COUNT_BASIS",
  "AS_2510_12_RECORDS_ALONE",
  "AS_1105_11_EXISTENCE",
  "WAC_314_55_089_4_C_DEEMED_SALES",
  "WAC_314_55_089_4_A_MONTHLY_LOST",
  "WAC_314_55_087_ADP_AUDIT_TRAIL",
  "REG_1_471_2_D_VERIFY_BY_COUNT",
  "REG_1_471_2_E_BURDEN_OF_PROOF",
] as const;

/**
 * The fabrication incident, kept as data so the UI can teach it.
 *
 * This is deliberately NOT a `GuidanceAuthority` — it is not an authority, it
 * is a WARNING ABOUT one. Giving it the same shape would file fiction in the
 * same drawer as law, which is the exact mistake it exists to warn about.
 */
export const FABRICATION_WATCH = {
  what: "A published “complete guide” to PCAOB AS 2510 invented paragraph numbers and quoted text.",
  examples: [
    "Labelled “.04 — Cycle Counts”. In the real standard, .03 through .08 are deleted paragraphs.",
    "Labelled “.11 — Using a Specialist”. The real .11 is the statistical-sampling / cycle-count paragraph.",
  ],
  howItWasCaught:
    "The primary text was fetched from pcaobus.org and compared line by line against the article. " +
    "The article's structure did not survive first contact with the actual standard.",
  lesson:
    "A secondary source can be fluent, confident, well designed, and completely made up. The only " +
    "defence is opening the primary document yourself. Every quote in this application links to the " +
    "primary source for exactly that reason — so you can check us the same way we checked them.",
  primarySource: "https://pcaobus.org/oversight/standards/auditing-standards/details/AS2510",
} as const;

export const AUDIT_HUB_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // THE FOUR THINGS AN AUDITOR PHYSICALLY DOES
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "ISA_501_4_EXISTENCE_AND_CONDITION",
    kind: "auditing_standard",
    cite: "ISA 501.4 (Audit Evidence—Specific Considerations for Selected Items)",
    quote:
      "If inventory is material to the financial statements, the auditor shall obtain sufficient " +
      "appropriate audit evidence regarding the existence and condition of inventory by: (a) Attendance " +
      "at physical inventory counting, unless impracticable, to: (i) Evaluate management's instructions " +
      "and procedures for recording and controlling the results of the entity's physical inventory " +
      "counting; (ii) Observe the performance of management's count procedures; (iii) Inspect the " +
      "inventory; and (iv) Perform test counts; and (b) Performing audit procedures over the entity's " +
      "final inventory records to determine whether they accurately reflect actual inventory count results.",
    soWhat:
      "This is the whole job on one page, and it is the answer to \"what does a Big Four audit team " +
      "actually do when they turn up to count inventory?\" Four things: read the instructions, watch " +
      "people count, put hands on the product, and count some of it themselves. Then a fifth thing that " +
      "happens back at a desk — check that the final records match what was actually counted. Notice " +
      "what is NOT on the list: reading a report. This standard is the AICPA's international twin of " +
      "AU-C 501, which is the standard that would apply if Greenway were ever audited. We quote the " +
      "international one because it is published free and we can show you the real words.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph 4. " +
      "IAASB Handbook. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
  {
    id: "ISA_501_A7_TWO_WAY_TEST_COUNTS",
    kind: "auditing_standard",
    cite: "ISA 501.A7 (Perform Test Counts)",
    quote:
      "Performing test counts, for example, by tracing items selected from management's count records " +
      "to the physical inventory and tracing items selected from the physical inventory to management's " +
      "count records, provides audit evidence about the completeness and the accuracy of those records.",
    soWhat:
      "If you learn one thing from this whole screen, learn this one. A professional counts in BOTH " +
      "DIRECTIONS, and the two directions prove different things. Sheet to floor — pick a line off the " +
      "count sheet, go find it on the shelf — proves the things you wrote down are really there. Floor " +
      "to sheet — pick a package off the shelf, go find it on the count sheet — proves you did not MISS " +
      "anything. Only doing the first is the classic amateur mistake, because a count sheet that never " +
      "mentions the forgotten box in the back room will balance perfectly against itself all day long. " +
      "That is the mistake that lets product walk out of a store for a year without anyone noticing.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph A7. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
  {
    id: "ISA_501_A4_COUNT_CONTROLS",
    kind: "auditing_standard",
    cite: "ISA 501.A4 (Evaluate Management's Instructions and Procedures)",
    quote:
      "Matters relevant in evaluating management's instructions and procedures for recording and " +
      "controlling the physical inventory counting include whether they address, for example: The " +
      "application of appropriate control activities, for example, collection of used physical inventory " +
      "count records, accounting for unused physical inventory count records, and count and re-count " +
      "procedures. The accurate identification of the stage of completion of work in progress, of slow " +
      "moving, obsolete or damaged items and of inventory owned by a third party, for example, on " +
      "consignment. The procedures used to estimate physical quantities, where applicable, such as may " +
      "be needed in estimating the physical quantity of a coal pile. Control over the movement of " +
      "inventory between areas and the shipping and receipt of inventory before and after the cutoff date.",
    soWhat:
      "This is the checklist an auditor grades your count against before they even look at a number — " +
      "and you can grade yourself with it. \"Accounting for unused count records\" is the old paper " +
      "version of a control this system enforces for you: every lot in scope gets a line, and a line " +
      "left blank stops the count from finishing, so nobody can quietly drop a sheet they did not like. " +
      "\"Count and re-count procedures\" is why a big variance here demands a second count by a second " +
      "person instead of letting the first number through. \"Slow moving, obsolete or damaged\" is why " +
      "the count sheet asks you WHY, not just HOW MANY.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph A4. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
  {
    id: "ISA_501_A5_CUTOFF_MOVEMENT",
    kind: "auditing_standard",
    cite: "ISA 501.A5 (Observe the Performance of Management's Count Procedures)",
    quote:
      "Observing the performance of management's count procedures, for example those relating to control " +
      "over the movement of inventory before, during and after the count, assists the auditor in " +
      "obtaining audit evidence that management's instructions and count procedures are adequately " +
      "designed and implemented. In addition, the auditor may obtain copies of cutoff information, such " +
      "as details of the movement of inventory, to assist the auditor in performing audit procedures over " +
      "the accounting for such movements at a later date.",
    soWhat:
      "This is the paragraph about CUTOFF, and cutoff is the thing that will bite a retail shop hardest. " +
      "You are a store: you are selling while you count. If someone counts a shelf at 2:10pm and a " +
      "customer buys two of that item at 2:20pm, the count and the system now disagree by two — and " +
      "nothing is wrong. That is not shrinkage, that is timing. A count that ignores this manufactures " +
      "fake variances, and fake variances are worse than no count at all because they train you to " +
      "ignore real ones. This is why the hub tells you to count a product group in one sitting and warns " +
      "you when sales landed in the middle of it.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph A5. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
  {
    id: "ISA_501_A10_VARIANCE_IS_A_CONTROL_SIGNAL",
    kind: "auditing_standard",
    cite: "ISA 501.A10 (Counting at a Date Other than the Financial Statement Date)",
    quote:
      "Where a perpetual inventory system is maintained, management may perform physical counts or other " +
      "tests to ascertain the reliability of inventory quantity information included in the entity's " +
      "perpetual inventory records. In some cases, management or the auditor may identify differences " +
      "between the perpetual inventory records and actual physical inventory quantities on hand; this may " +
      "indicate that the controls over changes in inventory are not operating effectively.",
    soWhat:
      "Read the last clause twice. A variance is not primarily a number to correct — it is EVIDENCE " +
      "ABOUT YOUR CONTROLS. If a count comes up short, the shortage is the symptom; the disease is " +
      "whatever let it happen without anyone noticing. This is the difference between a bookkeeper and " +
      "a CFO. A bookkeeper posts the adjustment and moves on. A CFO asks why the system did not already " +
      "know, and fixes that. It is also the exact reason this hub reports GROSS variance alongside net: " +
      "a $600 overage and a $600 shortage net to a tidy zero while being two separate control failures.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph A10. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
  {
    id: "ISA_501_A12_INCONVENIENCE_IS_NOT_A_REASON",
    kind: "auditing_standard",
    cite: "ISA 501.A12 (Attendance at Physical Inventory Counting Is Impracticable)",
    quote:
      "In some cases, attendance at physical inventory counting may be impracticable. This may be due to " +
      "factors such as the nature and location of the inventory, for example, where inventory is held in " +
      "a location that may pose threats to the safety of the auditor. The matter of general inconvenience " +
      "to the auditor, however, is not sufficient to support a decision by the auditor that attendance is " +
      "impracticable.",
    soWhat:
      "\"General inconvenience is not sufficient.\" The standard anticipated the excuse and wrote it down " +
      "so it could be refused in advance. Busy Saturday, short-staffed, the counting is tedious — none of " +
      "those make a count optional; they make it inconvenient, which the profession has already ruled is " +
      "not the same thing. The bar for skipping is genuine impracticability, like inventory somewhere " +
      "physically unsafe to reach. This is the sentence to remember on the day you do not feel like " +
      "counting, and the reason the hub keeps showing you what is overdue rather than letting it fade.",
    source:
      "ISA 501, Audit Evidence—Specific Considerations for Selected Items, paragraph A12. " +
      "https://www.iaasb.org/_flysystem/azure-private/publications/files/A023+2013+IAASB+Handbook+ISA+501.pdf",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TESTS  (Rule 15: written so that breaking the behaviour breaks the test)
// ═══════════════════════════════════════════════════════════════════════════

export function __runAuditHubAuthoritiesTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`audit-hub-authorities self-test FAILED: ${msg}`);
  };

  const newIds = AUDIT_HUB_AUTHORITIES_NEW.map((a) => a.id);

  // 1) No duplicates inside the new set.
  ok(new Set(newIds).size === newIds.length, "the new authorities contain no duplicate ids");

  // 2) Declared id list and actual objects agree, in BOTH directions.
  const declared = new Set<string>(AUDIT_HUB_AUTHORITY_IDS);
  for (const id of newIds) {
    ok(declared.has(id), `authority ${id} appears in the declared id list`);
  }
  for (const id of declared) {
    ok(newIds.includes(id), `declared id ${id} is backed by a real authority object`);
  }

  // 3) A borrowed id is borrowed, never redefined here. Redefining an id another
  //    module owns is exactly the drift the shared registry exists to stop.
  const borrowed = new Set<string>(AUDIT_HUB_BORROWED_AUTHORITY_IDS);
  for (const id of borrowed) {
    ok(!newIds.includes(id), `borrowed id ${id} is reused, not redefined locally`);
  }

  // 4) Substance. An unverifiable citation is worse than none: it looks authoritative.
  for (const a of AUDIT_HUB_AUTHORITIES_NEW) {
    ok(a.cite.trim().length > 0, `${a.id} names the provision it comes from`);
    ok(a.quote.trim().length >= 40, `${a.id} quotes enough of the text to be meaningful`);
    ok(a.soWhat.trim().length >= 40, `${a.id} explains what it means for this shop`);
    ok(/https?:\/\//.test(a.source), `${a.id} links to a source that can actually be opened`);
    ok(a.kind === "auditing_standard", `${a.id} is labelled an auditing standard, not law`);
  }

  // 5) ══ THE ANTI-FABRICATION GATE ══════════════════════════════════════════
  //    A secondary source was caught inventing AS 2510 paragraph numbers during
  //    this slice. Two of its fabrications are pinned here BY NAME. If anyone
  //    ever pastes that article's content into this module, this test fails.
  //
  //    Note it checks `cite` AND `quote` AND `soWhat` — the fabricated text
  //    would most likely arrive as explanatory prose, not as a formal citation.
  const fabricated = [/AS\s*2510\.0[3-8]\b/, /\.11\s*[—-]\s*Using a Specialist/i];
  for (const a of AUDIT_HUB_AUTHORITIES_NEW) {
    for (const re of fabricated) {
      const haystack = `${a.cite} ${a.quote} ${a.soWhat}`;
      ok(!re.test(haystack), `${a.id} does not repeat the fabricated AS 2510 numbering (${re.source})`);
    }
  }

  // 6) AU-C 501 IS NOT QUOTED. Its text is paywalled and was never retrieved, so
  //    quoting it would be guessing — the one thing the standing rules forbid
  //    absolutely. This test is what stops a future well-meaning edit from
  //    "helpfully" adding it from memory.
  for (const a of AUDIT_HUB_AUTHORITIES_NEW) {
    ok(
      !/^AU-C/i.test(a.cite.trim()),
      `${a.id} does not present itself as AU-C text, which this slice could not verify`,
    );
  }

  // 7) The fabrication record must stay usable by the UI: real examples, a real
  //    lesson, and a link to the primary source that settled it.
  ok(FABRICATION_WATCH.examples.length >= 2, "the fabrication record keeps its concrete examples");
  ok(FABRICATION_WATCH.lesson.length >= 40, "the fabrication record states the lesson, not just the incident");
  ok(
    /https?:\/\/pcaobus\.org/.test(FABRICATION_WATCH.primarySource),
    "the fabrication record links to the primary source that settled it",
  );

  // 8) Plain English. Michael has not opened an accounting book in thirteen years.
  const jargon = [/\bde minimis\b/i, /\bceteris paribus\b/i, /\bprima facie\b/i];
  for (const a of AUDIT_HUB_AUTHORITIES_NEW) {
    for (const re of jargon) {
      ok(!re.test(a.soWhat), `${a.id} explains itself without jargon (${re.source})`);
    }
  }
}
