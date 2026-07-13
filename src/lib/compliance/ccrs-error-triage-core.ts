/**
 * src/lib/compliance/ccrs-error-triage-core.ts  (Task W)
 *
 * PURE triage for CCRS error emails. CCRS has no API and no real-time
 * validation — after a manual CSV upload, the LCB reports problems BY EMAIL to
 * the account that uploaded. The owner pastes that email into the Command
 * Center and this core classifies each recognized error with plain-language
 * fix steps, grounded in the WA LCB CCRS Upload User Guide + FAQ (see
 * docs/CCRS_COMMAND_CENTER_RESEARCH.md §5–§6). Unrecognized errors route to
 * the examiner@lcb.wa.gov escalation path with a DRAFTS-ONLY email builder.
 *
 * No I/O. Self-tests registered in both harnesses.
 */

export type TriageSeverity = "benign" | "fixable" | "escalate";

export type TriageFinding = {
  /** Stable id for the rule that matched. */
  ruleId: string;
  severity: TriageSeverity;
  /** The error text (or fragment) that matched. */
  matched: string;
  /** Plain-language: what this error means. */
  meaning: string;
  /** Ordered, concrete fix steps (empty for benign). */
  fixSteps: string[];
};

export type TriageResult = {
  findings: TriageFinding[];
  /** Lines that looked like errors but matched no known rule. */
  unrecognized: string[];
  /** True when at least one finding (or unrecognized line) needs action. */
  needsAction: boolean;
  /** True when the examiner escalation path is recommended. */
  suggestEscalation: boolean;
  /** One-paragraph plain-language summary of the whole email. */
  summary: string;
};

type Rule = {
  id: string;
  /** Lower-cased substrings; a line matches when it contains ANY of them. */
  needles: string[];
  severity: TriageSeverity;
  meaning: string;
  fixSteps: string[];
};

/**
 * Known CCRS error signatures (Upload User Guide + FAQ, verified in the Task W
 * research doc). Order matters: first match wins per line.
 */
const RULES: Rule[] = [
  {
    id: "duplicate_strain",
    needles: ["duplicate strain"],
    severity: "benign",
    meaning:
      "The strain already exists in CCRS for this license. The LCB FAQ says this needs NO corrective action — the rest of the file still processes.",
    fixSteps: [],
  },
  {
    id: "duplicate_transfer",
    needles: ["duplicate inventorytransfer"],
    severity: "benign",
    meaning:
      "This transfer receipt was already recorded in CCRS (transfers are unique on insert). If the quantities matched what you meant to report, nothing further is needed.",
    fixSteps: [],
  },
  {
    id: "strain_not_linked",
    needles: ["strain name reported is not linked to the license"],
    severity: "fixable",
    meaning:
      "An Inventory row references a strain CCRS doesn't have on file for license. Either the Strain.csv wasn't uploaded first (Group 1 before Group 2, ≥10 minutes apart) or the spelling/format differs from the previously submitted strain.",
    fixSteps: [
      "Check the strain spelling in Inventory.csv against Strain.csv — it must match character-for-character.",
      "If the strain was never submitted, upload Strain.csv, wait 10+ minutes, then re-upload the corrected Inventory.csv.",
      "Regenerate the batch here so NumberRecords matches the corrected row count.",
    ],
  },
  {
    id: "name_required",
    needles: ["name is required"],
    severity: "fixable",
    meaning: "A required Name field (e.g. Area.Name) was blank in one or more rows.",
    fixSteps: [
      "Open the flagged file and fill in the missing Name value(s).",
      "Re-upload the corrected file with the SAME external identifiers and a matching NumberRecords header.",
    ],
  },
  {
    id: "bad_category_type",
    needles: ["invalid inventorycategory", "invalid inventory category", "inventorytype combination"],
    severity: "fixable",
    meaning:
      "A Product row pairs an InventoryCategory with an InventoryType that isn't allowed (Table 2 of the Upload User Guide — e.g. EndProduct must use types like Usable Cannabis, Solid Edible, Liquid Edible…).",
    fixSteps: [
      "Fix the InventoryCategory/InventoryType pair on the flagged Product row(s) per Table 2.",
      "Re-upload Product.csv, wait 10+ minutes, then re-upload any dependent Inventory.csv rows.",
    ],
  },
  {
    id: "from_inventory_invalid",
    needles: ["invalid frominventoryexternalidentifier", "frominventoryexternalidentifier"],
    severity: "fixable",
    meaning:
      "A transfer receipt references the SELLER's inventory identifier, but CCRS can't find it — usually the supplier hasn't filed their own Inventory/Sale report yet.",
    fixSteps: [
      "Verify the FromInventoryExternalIdentifier against the seller's manifest/paperwork.",
      "Contact the supplier and ask when they filed their CCRS report; re-upload the transfer AFTER they have.",
      "If the supplier confirms they filed and it still fails, escalate to examiner@lcb.wa.gov with the CSV + the error email.",
    ],
  },
  {
    id: "duplicate_sale",
    needles: ["duplicate sale for licensee", "duplicate sale"],
    severity: "fixable",
    meaning:
      "Rows share a SaleExternalIdentifier without unique SaleDetailExternalIdentifiers (or the ticket was already reported). One ticket = one SaleExternalIdentifier; every line needs its own detail identifier and the same SaleType + SaleDate.",
    fixSteps: [
      "Check whether this sale was already reported in a previous week — if so, no re-upload is needed.",
      "Otherwise make every line's SaleDetailExternalIdentifier unique (keep the shared SaleExternalIdentifier) and re-upload.",
    ],
  },
  {
    id: "excise_zero_nonmedical",
    needles: ["only medical sales can be 0", "only medical sales can be $0"],
    severity: "fixable",
    meaning:
      "A non-medical sale row reported $0 cannabis excise tax. Excise must equal 37% of unit price for every retail sale; ONLY SaleType=RecreationalMedical rows (DOH-verified patients, medically compliant product) may be $0.",
    fixSteps: [
      "If the sale was NOT a verified medical exemption: correct the excise to 37% of the unit price and re-upload.",
      "If it WAS a valid medical sale: set SaleType=RecreationalMedical (both tax columns $0.00) and confirm the inventory row was reported IsMedical=TRUE.",
    ],
  },
  {
    id: "number_records_mismatch",
    needles: ["numberrecords", "number of records"],
    severity: "fixable",
    meaning:
      "The NumberRecords value in the file's header doesn't equal the actual data-row count, so CCRS rejected the whole file.",
    fixSteps: [
      "Regenerate the file from the Command Center — the generator always writes a matching NumberRecords — rather than hand-editing.",
      "If you hand-edited the CSV, recount the data rows (exclude the 3 header rows) and fix the header, then re-upload.",
    ],
  },
  {
    id: "quarantine",
    needles: ["quarantine"],
    severity: "fixable",
    meaning:
      "A sale references inventory sitting in a quarantine area. Cannabis products should never be in quarantine areas (IsQuarantine=TRUE is only for imported CBD awaiting testing).",
    fixSteps: [
      "Move the lot to a non-quarantine Area (Area.csv IsQuarantine=FALSE) and re-upload Inventory, wait 10+ minutes, then re-upload the Sale rows.",
    ],
  },
];

const ERROR_HINT = /error|invalid|required|duplicate|reject|fail|mismatch|cannot|not linked|can be 0/i;

/** Triage a pasted CCRS error email. PURE + deterministic. */
export function triageCcrsErrorEmail(pasted: string): TriageResult {
  const findings: TriageFinding[] = [];
  const unrecognized: string[] = [];
  const seenRules = new Set<string>();

  const lines = pasted
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    const lower = line.toLowerCase();
    const rule = RULES.find((r) => r.needles.some((n) => lower.includes(n)));
    if (rule) {
      if (seenRules.has(rule.id)) continue; // one finding per rule
      seenRules.add(rule.id);
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        matched: line.slice(0, 200),
        meaning: rule.meaning,
        fixSteps: rule.fixSteps,
      });
    } else if (ERROR_HINT.test(line) && line.length >= 12) {
      unrecognized.push(line.slice(0, 200));
    }
  }

  const actionable = findings.filter((f) => f.severity !== "benign");
  const needsAction = actionable.length > 0 || unrecognized.length > 0;
  const suggestEscalation =
    unrecognized.length > 0 || findings.some((f) => f.severity === "escalate");

  let summary: string;
  if (findings.length === 0 && unrecognized.length === 0) {
    summary =
      "No CCRS error patterns were recognized in the pasted text. If the email clearly reports an error, use the examiner escalation draft below.";
  } else if (!needsAction) {
    summary =
      "Every recognized error is benign (already-on-file duplicates). Per the LCB FAQ no corrective action is required — you can mark this week's errors as resolved.";
  } else {
    const parts: string[] = [];
    if (actionable.length > 0) {
      parts.push(
        `${actionable.length} actionable error type(s) recognized — follow the fix steps, correct the original file(s), and re-upload with matching NumberRecords.`,
      );
    }
    const benign = findings.length - actionable.length;
    if (benign > 0) parts.push(`${benign} benign duplicate notice(s) need no action.`);
    if (unrecognized.length > 0) {
      parts.push(
        `${unrecognized.length} line(s) look like errors but match no known pattern — if you can't resolve them, send the escalation draft to examiner@lcb.wa.gov with the CSV attached and the error email forwarded.`,
      );
    }
    summary = parts.join(" ");
  }

  return { findings, unrecognized, needsAction, suggestEscalation, summary };
}

// ── Examiner escalation draft (DRAFTS-ONLY) ──────────────────────────────────

export const LCB_CONTACTS = {
  examiner: "examiner@lcb.wa.gov",
  serviceDesk: "servicedesk@lcb.wa.gov",
  taxes: "cannabistaxes@lcb.wa.gov",
  enforcement: "cannabisenf@lcb.wa.gov",
  endorsement: "cannabisendorsement@lcb.wa.gov",
} as const;

export type ExaminerDraft = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Build the examiner escalation email as a DRAFT (never sent automatically —
 * standing drafts-only rule). The owner attaches the CSV and forwards the
 * original CCRS error email per the LCB workflow.
 */
export function buildExaminerDraft(opts: {
  licenseNumber: string;
  licenseeName: string;
  weekStart: string; // ISO
  weekEnd: string; // ISO
  fileTypes: string[];
  errorExcerpt: string;
  contactEmail?: string;
}): ExaminerDraft {
  const files = opts.fileTypes.length > 0 ? opts.fileTypes.join(", ") : "(files not specified)";
  const excerpt = opts.errorExcerpt.trim().slice(0, 1500);
  const subject = `CCRS upload error assistance — license ${opts.licenseNumber} — week ${opts.weekStart} to ${opts.weekEnd}`;
  const body = [
    "Hello,",
    "",
    `We are ${opts.licenseeName} (license ${opts.licenseNumber}). We received an error notification after our weekly CCRS upload covering ${opts.weekStart} through ${opts.weekEnd} (files: ${files}) and were unable to resolve it using the Upload User Guide.`,
    "",
    "Error message received:",
    "----------------------------------------",
    excerpt || "(paste the CCRS error text here)",
    "----------------------------------------",
    "",
    "The original CSV file(s) are attached, and the CCRS error email is forwarded with this message. Could you please advise how to correct and resubmit?",
    "",
    "Thank you,",
    opts.licenseeName,
    opts.contactEmail ? opts.contactEmail : "",
  ]
    .join("\n")
    .trimEnd();
  return { to: LCB_CONTACTS.examiner, subject, body };
}

// ── Self-tests (tsx / vitest) ─────────────────────────────────────────────────

export function __runCcrsErrorTriageTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // Benign duplicate strain → no action.
  {
    const r = triageCcrsErrorEmail("Error: Duplicate Strain for Licensee 123456\n");
    ok(r.findings.length === 1 && r.findings[0].ruleId === "duplicate_strain", "duplicate strain recognized");
    ok(r.findings[0].severity === "benign" && r.findings[0].fixSteps.length === 0, "duplicate strain is benign, no steps");
    ok(!r.needsAction && !r.suggestEscalation, "benign-only email needs no action");
    ok(r.summary.toLowerCase().includes("benign"), "summary says benign");
  }

  // Actionable: strain not linked + excise zero.
  {
    const r = triageCcrsErrorEmail(
      [
        "Row 12: Strain Name reported is not linked to the License Number",
        "Row 40: CannabisExciseTax invalid — Only Medical Sales can be 0",
      ].join("\n"),
    );
    ok(r.findings.length === 2, `two findings (got ${r.findings.length})`);
    ok(
      r.findings.some((f) => f.ruleId === "strain_not_linked" && f.severity === "fixable" && f.fixSteps.length > 0),
      "strain_not_linked fixable with steps",
    );
    ok(
      r.findings.some((f) => f.ruleId === "excise_zero_nonmedical"),
      "excise-zero rule recognized",
    );
    ok(r.needsAction && !r.suggestEscalation, "actionable but no escalation when all recognized");
  }

  // One finding per rule even when repeated.
  {
    const r = triageCcrsErrorEmail("Duplicate Sale for Licensee\nDuplicate Sale for Licensee\nDuplicate Sale for Licensee");
    ok(r.findings.length === 1 && r.findings[0].ruleId === "duplicate_sale", "repeat lines collapse to one finding");
  }

  // Unrecognized error line → escalation suggested.
  {
    const r = triageCcrsErrorEmail("ERROR: Flux capacitor mismatch on row 7");
    ok(r.findings.length === 0 && r.unrecognized.length === 1, "unknown error captured as unrecognized");
    ok(r.needsAction && r.suggestEscalation, "unknown error suggests examiner escalation");
  }

  // Non-error chatter is ignored.
  {
    const r = triageCcrsErrorEmail("Hello,\nThanks for your upload.\nHave a nice day.");
    ok(r.findings.length === 0 && r.unrecognized.length === 0, "chatter produces nothing");
    ok(!r.needsAction, "chatter needs no action");
  }

  // NumberRecords mismatch recognized.
  {
    const r = triageCcrsErrorEmail("File rejected: NumberRecords does not match record count");
    ok(r.findings[0]?.ruleId === "number_records_mismatch", "NumberRecords rule matches");
  }

  // Examiner draft (drafts-only).
  {
    const d = buildExaminerDraft({
      licenseNumber: "426533",
      licenseeName: "Greenway Marijuana",
      weekStart: "2026-01-04",
      weekEnd: "2026-01-10",
      fileTypes: ["Sale", "Inventory"],
      errorExcerpt: "Row 12: Strain Name reported is not linked",
      contactEmail: "owner@greenwaymarijuana.com",
    });
    ok(d.to === "examiner@lcb.wa.gov", "draft addressed to examiner");
    ok(d.subject.includes("426533") && d.subject.includes("2026-01-04"), "subject carries license + week");
    ok(d.body.includes("Sale, Inventory") && d.body.includes("Strain Name reported"), "body carries files + excerpt");
    ok(d.body.includes("attached") && d.body.includes("forwarded"), "body instructs attach CSV + forward error email");
  }

  if (failed === 0) console.log(`ccrs-error-triage-core: all ${passed} tests passed`);
  return { passed, failed };
}
