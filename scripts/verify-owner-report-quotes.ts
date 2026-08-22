/**
 * Rule 24/35: the quote is sacred. The owner REPORT is not covered by
 * verify-verbatim-quotes.ts (that walks the registries, not docs/). So this
 * probe re-derives each quoted fragment from the registry record it claims to
 * come from and proves the report did not paraphrase while transcribing.
 *
 * A drift of four characters is exactly what the registry gate caught during
 * this slice. The report deserves the same treatment.
 */
import { readFileSync } from "node:fs";
import { NET_PAY_AUTHORITIES } from "../src/lib/payroll/net-pay-authorities";
import { YTD_AUTHORITIES } from "../src/lib/payroll/ytd-authorities";

const report = readFileSync(
  "docs/MICHAEL-books-37-net-pay-and-year-to-date.md",
  "utf8",
);

/** Normalise the markdown blockquote decoration away, not the words. */
function unquote(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const flat = unquote(report);

type Claim = { id: string; fragments: string[] };

const CLAIMS: Claim[] = [
  {
    id: "net-pay-usc-15-1672-base",
    fragments: [
      "The term 'disposable earnings' means that part of the earnings of any individual remaining after the deduction from those earnings of any amounts required by law to be withheld.",
    ],
  },
  {
    id: "net-pay-rcw-51-16-140-required",
    fragments: [
      "Every employer who is not a self-insurer shall deduct from the pay of each of his or her workers one-half of the amount he or she is required to pay, for medical benefits within each risk classification.",
      "It shall be unlawful for the employer, unless specifically authorized by this title, to deduct or obtain any part of the premium or other costs required to be by him or her paid from the wages or earnings of any of his or her workers, and the making of or attempt to make any such deduction shall be a gross misdemeanor.",
    ],
  },
  {
    id: "net-pay-fs30-legally-required",
    fragments: [
      "The amount of pay subject to garnishment is based on an employee's 'disposable earnings,' which is the amount of earnings left after legally required deductions are made. Examples of such deductions include federal, state, and local taxes, and the employee's share of Social Security, Medicare and State Unemployment Insurance tax. It also includes withholdings for employee retirement systems required by law.",
    ],
  },
  {
    id: "net-pay-fs30-voluntary-excluded",
    fragments: [
      "Deductions not required by law",
      "such as those for voluntary wage assignments, union dues, health and life insurance, contributions to charitable causes, purchases of savings bonds, retirement plan contributions (except those required by law) and payments to employers for payroll advances or purchases of merchandise",
      "may not be subtracted from gross earnings when calculating disposable earnings under the CCPA.",
    ],
  },
  {
    id: "net-pay-rcw-49-52-050-rebate",
    fragments: [
      "Any employer or officer, vice principal or agent of any employer",
      "Shall collect or receive from any employee a rebate of any part of wages theretofore paid",
      "Wilfully and with intent to deprive the employee of any part of his or her wages, shall pay any employee a lower wage than the wage such employer is obligated to pay",
      "Being an employer or a person charged with the duty of keeping any employer's books or records shall wilfully fail",
      "to show openly and clearly in due course in such employer's books and records any rebate of or deduction from any employee's wages",
      "Shall be guilty of a misdemeanor.",
    ],
  },
  {
    id: "net-pay-rcw-49-52-060-authorized",
    fragments: [
      "The provisions of RCW 49.52.050 shall not make it unlawful for an employer to withhold or divert any portion of an employee's wages",
      "when required or empowered so to do by state or federal law",
      "when a deduction has been expressly authorized in writing in advance by the employee",
      "for a lawful purpose accruing to the benefit of such employee",
      "PROVIDED, That the employer derives no financial benefit from such deduction and the same is openly, clearly and in due course recorded in the employer's books.",
    ],
  },
  {
    id: "w2-box3-wage-base-ceiling",
    fragments: [
      "The total of boxes 3 and 7 cannot exceed $184,500 (2026 maximum social security wage base).",
    ],
  },
  {
    id: "ssa-rejection-conditions",
    fragments: [
      "The SSA will reject Form W-2 electronic and paper wage reports under the following conditions.",
      "Medicare wages and tips are less than the sum of social security wages and social security tips.",
      "Social security tax is greater than zero; social security wages and social security tips are equal to zero.",
      "Medicare tax is greater than zero; Medicare wages and tips are equal to zero.",
    ],
  },
];

const byId = new Map<string, string>();
for (const a of NET_PAY_AUTHORITIES) byId.set(a.id, a.quote);
for (const a of YTD_AUTHORITIES) byId.set(a.id, a.quote);

let failures = 0;
let checked = 0;

// RULE 39: guard the vacuous pass. If CLAIMS were empty, or an id resolved to
// nothing, this script would print success while proving nothing.
if (CLAIMS.length < 8) {
  console.error("VACUOUS: fewer claims than authorities cited in the report.");
  process.exit(1);
}

for (const claim of CLAIMS) {
  const registryQuote = byId.get(claim.id);
  if (!registryQuote) {
    console.error(`  MISSING   ${claim.id} is not in any registry`);
    failures += 1;
    continue;
  }
  // The registry stores curly-free ASCII; the report renders typographic
  // quotes in places. Compare on a normalised axis that preserves WORDS.
  const norm = (s: string) =>
    s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2022]/g, "\u2022")
      .replace(/\s+/g, " ")
      .trim();

  const src = norm(registryQuote);
  const doc = norm(flat);

  for (const frag of claim.fragments) {
    checked += 1;
    const f = norm(frag);
    const inRegistry = src.includes(f) || src.replace(/"/g, "'").includes(f.replace(/"/g, "'"));
    const inReport = doc.includes(f) || doc.replace(/"/g, "'").includes(f.replace(/"/g, "'"));
    if (!inRegistry) {
      console.error(`  DRIFT     ${claim.id}: fragment NOT in registry quote:`);
      console.error(`            "${f.slice(0, 110)}..."`);
      failures += 1;
    } else if (!inReport) {
      console.error(`  MISSING   ${claim.id}: fragment not found in the report:`);
      console.error(`            "${f.slice(0, 110)}..."`);
      failures += 1;
    } else {
      console.log(`  OK        ${claim.id}  (${f.length} chars)`);
    }
  }
}

console.log(
  `\n${checked} quoted fragments checked against the registries, ${failures} problem(s).`,
);
if (failures > 0) {
  console.error("OWNER REPORT QUOTE CHECK FAILED.");
  process.exit(1);
}
console.log("OWNER REPORT QUOTE CHECK PASSED.");
