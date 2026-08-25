#!/usr/bin/env python3
"""
Apply the nineteen hand-decided quotation extensions.

Not a fixer. Every replacement below was read off the corpus by hand, one at a
time, and is written out here in full so the diff can be checked against the
authority. The script's only job is to splice exact strings and refuse if
anything does not match, which is more reliable than nineteen manual edits and
carries none of the discretion that made the deleted automatic fixer unsafe.

Every NEW string is checked byte for byte against the corpus named by that
quotation's own sourcePath before anything is written.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent / "repo"

C941 = "docs/authorities/federal/irs-instructions-941-2026.txt"
CW2 = "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt"
CWA = "docs/authorities/state-wa/rcw-50A.10.030.txt"

F941 = "src/lib/payroll/form-box-lessons-941.ts"
FW2 = "src/lib/payroll/form-box-lessons-w2.ts"
FWA = "src/lib/payroll/form-box-lessons-wa.ts"

# (lesson file, corpus, note, old decoded quote, new decoded quote)
#
# By default a job may only APPEND: the new text must start with the old text,
# so the change cannot quietly alter what was already being quoted. Exactly one
# job needs to PREPEND as well, and it must say so by name in PREPEND_ALLOWED
# below, with the reason. An undeclared prepend is refused.
PREPEND_ALLOWED = {
    # 'Enter all wages,' is sixteen characters and occurs TWICE in the 941
    # instructions - once at line 5c and once at line 5d. The lesson cites 5c,
    # but the gate locates a quotation with lastIndexOf, so this fragment was
    # being matched against the 5d passage and its 'source continues' text was
    # read from the wrong line of the form. Appending alone would therefore have
    # extended it with 5d's words under a 5c citation. The sentence's own
    # subject - '5c. Taxable Medicare wages & tips.' - is prepended so the
    # quotation is unambiguous in the corpus and matches the line it cites.
    "line 5c",
}
JOBS = [
    # ── Form 941 ────────────────────────────────────────────────────────────
    (
        F941, C941, "line 5c",
        "Enter all wages,",
        "5c. Taxable Medicare wages & tips. Enter all wages,\ntips, sick pay, and taxable fringe benefits that are subject\nto Medicare tax.",
    ),
    (
        F941, C941, "line 4",
        "If no wages, tips, and other compensation on line 2 are\nsubject to social security or Medicare tax, check the box\non line 4. If this question doesn\u2019t apply to you, leave the\nbox blank. For more information about exempt wages, see",
        "If no wages, tips, and other compensation on line 2 are\nsubject to social security or Medicare tax, check the box\non line 4. If this question doesn\u2019t apply to you, leave the\nbox blank. For more information about exempt wages, see\nsection 15 of Pub. 15. For religious exemptions, see\nsection 4 of Pub. 15-A.",
    ),
    (
        F941, C941, "line 5b",
        "5b. Taxable social security tips. Enter all tips your\nemployees reported to you during the quarter until the\ntotal of the tips and taxable wages, including wages\nreported on line 5a, for an employee reaches $184,500 for\nthe year. Include all tips your employee reported to you",
        "5b. Taxable social security tips. Enter all tips your\nemployees reported to you during the quarter until the\ntotal of the tips and taxable wages, including wages\nreported on line 5a, for an employee reaches $184,500 for\nthe year. Include all tips your employee reported to you\neven if you were unable to withhold the employee tax of\n6.2%.",
    ),
    (
        F941, C941, "line 5d - the meaning-inverting one",
        "withholding Additional Medicare Tax in the pay period in\nwhich you pay wages in excess of $200,000 to an\nemployee and continue to withhold it each pay period until\nthe end of the calendar year. Additional Medicare Tax is\nonly imposed on the employee. There is no employer",
        "withholding Additional Medicare Tax in the pay period in\nwhich you pay wages in excess of $200,000 to an\nemployee and continue to withhold it each pay period until\nthe end of the calendar year. Additional Medicare Tax is\nonly imposed on the employee. There is no employer\nshare of Additional Medicare Tax.",
    ),
    (
        F941, C941, "line 5d, second quotation",
        "only imposed on the employee. There is no employer\nshare of Additional Medicare Tax. All wages that are\nsubject to Medicare tax are subject to Additional Medicare",
        "only imposed on the employee. There is no employer\nshare of Additional Medicare Tax. All wages that are\nsubject to Medicare tax are subject to Additional Medicare\nTax withholding if paid in excess of the $200,000\nwithholding threshold.",
    ),
    (
        F941, C941, "line 5f",
        "Demand on line 5f. The IRS issues a Section 3121(q)\nNotice and Demand to advise an employer of the amount\nof tips received by employees who failed to report or\nunderreported tips to the employer. An employer isn\u2019t\nliable for the employer share of the social security and",
        "Demand on line 5f. The IRS issues a Section 3121(q)\nNotice and Demand to advise an employer of the amount\nof tips received by employees who failed to report or\nunderreported tips to the employer. An employer isn\u2019t\nliable for the employer share of the social security and\nMedicare taxes on unreported tips until notice and\ndemand for the taxes is made to the employer by the IRS\nin a Section 3121(q) Notice and Demand.",
    ),
    (
        F941, C941, "line 5f, second quotation",
        "liable for the employer share of the social security and\nMedicare taxes on unreported tips until notice and\ndemand for the taxes is made to the employer by the IRS\nin a Section 3121(q) Notice and Demand. The tax due",
        "liable for the employer share of the social security and\nMedicare taxes on unreported tips until notice and\ndemand for the taxes is made to the employer by the IRS\nin a Section 3121(q) Notice and Demand. The tax due\nmay have been determined from tips reported to the IRS\non employees\u2019 Forms 4137, Social Security and Medicare\nTax on Unreported Tip Income, or other tips that weren\u2019t\nreported to their employer as determined by the IRS\nduring an examination.",
    ),
    (
        F941, C941, "line 8",
        "8. Current quarter\u2019s adjustment for sick pay. If your\nthird-party payer of sick pay that isn\u2019t your agent (for\nexample, an insurance company) transfers the liability for\nthe employer share of the social security and Medicare\ntaxes to you, enter a negative adjustment on line 8 for the\nemployee share of social security and Medicare taxes that\nwere withheld and deposited by your third-party sick pay",
        "8. Current quarter\u2019s adjustment for sick pay. If your\nthird-party payer of sick pay that isn\u2019t your agent (for\nexample, an insurance company) transfers the liability for\nthe employer share of the social security and Medicare\ntaxes to you, enter a negative adjustment on line 8 for the\nemployee share of social security and Medicare taxes that\nwere withheld and deposited by your third-party sick pay\npayer on the sick pay.",
    ),
    (
        F941, C941, "line 8, second quotation",
        "employer. The sick pay should be included on line 5a,\nline 5c, and, if the withholding threshold is met, line 5d.\nNo adjustment is reported on line 8 for sick pay that is",
        "employer. The sick pay should be included on line 5a,\nline 5c, and, if the withholding threshold is met, line 5d.\nNo adjustment is reported on line 8 for sick pay that is\npaid through a third party as an employer\u2019s agent.",
    ),
    (
        F941, C941, "line 16",
        "on Schedule B (Form 941).\nCaution: The amounts entered on line 16 are a summary\nof your monthly tax liability, not a summary of deposits you\nmade. If you don\u2019t properly report your liabilities when\nrequired or if you\u2019re a semiweekly schedule depositor and\nenter your liabilities on line 16 instead of on Schedule B\n(Form 941), you may be assessed an \u201caveraged\u201d FTD",
        "on Schedule B (Form 941).\nCaution: The amounts entered on line 16 are a summary\nof your monthly tax liability, not a summary of deposits you\nmade. If you don\u2019t properly report your liabilities when\nrequired or if you\u2019re a semiweekly schedule depositor and\nenter your liabilities on line 16 instead of on Schedule B\n(Form 941), you may be assessed an \u201caveraged\u201d FTD\npenalty.",
    ),
    (
        F941, C941, "line 17",
        "If you go out of business or stop paying wages, you must\nfile a final return. To tell the IRS that a particular Form 941\nis your final return, check the box on line 17 and enter the\nfinal date you paid wages in the space provided. For\nadditional filing requirements, including information about",
        "If you go out of business or stop paying wages, you must\nfile a final return. To tell the IRS that a particular Form 941\nis your final return, check the box on line 17 and enter the\nfinal date you paid wages in the space provided. For\nadditional filing requirements, including information about\nattaching a statement to your final return, see If Your\nBusiness Has Closed, earlier.",
    ),
    (
        F941, C941, "line 18",
        "If you hire employees seasonally\u2014such as for summer or\nwinter only\u2014check the box on line 18. Checking the box\ntells the IRS not to expect four Forms 941 from you\nthroughout the year because you haven\u2019t paid wages\nregularly.\nGenerally, we won\u2019t ask about unfiled returns if at least",
        "If you hire employees seasonally\u2014such as for summer or\nwinter only\u2014check the box on line 18. Checking the box\ntells the IRS not to expect four Forms 941 from you\nthroughout the year because you haven\u2019t paid wages\nregularly.\nGenerally, we won\u2019t ask about unfiled returns if at least\none taxable return is filed each year.",
    ),
    (
        F941, C941, "lost refund caution, line 15c",
        "Caution: The IRS isn\u2019t responsible for a lost refund if you\nenter the wrong account information. Check with your\nfinancial institution to get the correct routing and account\nnumbers and to make sure your direct deposit will be",
        "Caution: The IRS isn\u2019t responsible for a lost refund if you\nenter the wrong account information. Check with your\nfinancial institution to get the correct routing and account\nnumbers and to make sure your direct deposit will be\naccepted.",
    ),
    # ── Form W-2 ────────────────────────────────────────────────────────────
    (
        FW2, CW2, "Box 10",
        "Box 10\u2014Dependent care benefits (not applicable to\nForms W-2AS, W-2CM, W-2GU, or W-2VI). Show the\ntotal dependent care benefits under a dependent care\nassistance program (section 129) paid or incurred by you",
        "Box 10\u2014Dependent care benefits (not applicable to\nForms W-2AS, W-2CM, W-2GU, or W-2VI). Show the\ntotal dependent care benefits under a dependent care\nassistance program (section 129) paid or incurred by you\nfor your employee.",
    ),
    (
        FW2, CW2, "Box 12",
        "Box 12\u2014Codes. Complete and code this box for all\nitems described below. Note that the codes do not relate\nto where they should be entered in boxes 12a through 12d\non Form W-2. For example, if you are only required to\nreport code D in box 12, you can enter code D and the\namount in box 12a of Form W-2. Report in box 12 any\nitems that are listed as codes A through II. Do not report in\nbox 12 section 414(h)(2) contributions (relating to certain",
        "Box 12\u2014Codes. Complete and code this box for all\nitems described below. Note that the codes do not relate\nto where they should be entered in boxes 12a through 12d\non Form W-2. For example, if you are only required to\nreport code D in box 12, you can enter code D and the\namount in box 12a of Form W-2. Report in box 12 any\nitems that are listed as codes A through II. Do not report in\nbox 12 section 414(h)(2) contributions (relating to certain\nstate or local government plans).",
    ),
    (
        FW2, CW2, "Box 13",
        "Box 13\u2014Checkboxes. Check all boxes that apply.\nStatutory employee. Check this box for statutory\nemployees whose earnings are subject to social security\nand Medicare taxes but not subject to federal income tax\nwithholding. Do not check this box for common-law\nemployees. There are workers who are independent\ncontractors under the common-law rules but are treated\nby statute as employees. They are called \u201cstatutory",
        "Box 13\u2014Checkboxes. Check all boxes that apply.\nStatutory employee. Check this box for statutory\nemployees whose earnings are subject to social security\nand Medicare taxes but not subject to federal income tax\nwithholding. Do not check this box for common-law\nemployees. There are workers who are independent\ncontractors under the common-law rules but are treated\nby statute as employees. They are called \u201cstatutory\nemployees.\u201d",
    ),
    (
        FW2, CW2, "Box 14a",
        "Box 14a\u2014Other. If you included 100% of a vehicle\u2019s\nannual lease value in the employee\u2019s income, it must also\nbe reported here or on a separate statement to your\nemployee.\nYou may also use this box for any other information that",
        "Box 14a\u2014Other. If you included 100% of a vehicle\u2019s\nannual lease value in the employee\u2019s income, it must also\nbe reported here or on a separate statement to your\nemployee.\nYou may also use this box for any other information that\nyou want to give to your employee.",
    ),
    (
        FW2, CW2, "Box 14a, examples",
        "you want to give to your employee. Label each item.\nExamples include state disability insurance taxes\nwithheld, union dues, uniform payments, health insurance\npremiums deducted, nontaxable income, educational\nassistance payments, or a minister\u2019s parsonage allowance\nand utilities. In addition, you may enter the following",
        "you want to give to your employee. Label each item.\nExamples include state disability insurance taxes\nwithheld, union dues, uniform payments, health insurance\npremiums deducted, nontaxable income, educational\nassistance payments, or a minister\u2019s parsonage allowance\nand utilities. In addition, you may enter the following\ncontributions to a pension plan: (a) nonelective employer\ncontributions made on behalf of an employee, (b)\nvoluntary after-tax contributions (but not designated Roth\ncontributions) that are deducted from an employee\u2019s pay,\n(c) required employee contributions, and (d) employer\nmatching contributions.",
    ),
    # ── Washington ──────────────────────────────────────────────────────────
    (
        FWA, CWA, "RCW 50A.10.030(7)(c) - stored on one unwrapped line, "
        "house convention for mirrored RCW/WAC",
        "On September 30th of each year, the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters to determine the size of the employer for the next calendar year",
        "On September 30th of each year, the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters to determine the size of the employer for the next calendar year for the purposes of this section, RCW 50A.24.010, and 50A.24.030.",
    ),
]


def main() -> int:
    corpora = {}
    for rel in {C941, CW2, CWA}:
        corpora[rel] = (REPO / rel).read_text(encoding="utf-8")

    # ── Refuse before writing anything if any single job is unsound ────────
    problems = []
    for i, (frel, crel, note, old, new) in enumerate(JOBS, 1):
        if not new.startswith(old):
            if note not in PREPEND_ALLOWED:
                problems.append(
                    f"job {i} ({note}): the new quote does not EXTEND the old one, and this job "
                    "is not in PREPEND_ALLOWED with a stated reason"
                )
            elif old not in new:
                problems.append(
                    f"job {i} ({note}): declares a prepend but the old text is not contained in "
                    "the new text at all, so this is a rewrite and not an extension"
                )
        if new not in corpora[crel]:
            problems.append(f"job {i} ({note}): the extended quote is NOT byte-for-byte in {crel}")
        src = (REPO / frel).read_text(encoding="utf-8")
        lit = json.dumps(old, ensure_ascii=True)
        if src.count(lit) != 1:
            problems.append(f"job {i} ({note}): old literal appears {src.count(lit)}x in {frel}, want exactly 1")
    if problems:
        print("REFUSING - nothing written:")
        for p in problems:
            print("  " + p)
        return 1

    added_total = 0
    for frel in {j[0] for j in JOBS}:
        src = (REPO / frel).read_text(encoding="utf-8")
        n = 0
        for jf, crel, note, old, new in JOBS:
            if jf != frel:
                continue
            src = src.replace(json.dumps(old, ensure_ascii=True), json.dumps(new, ensure_ascii=True), 1)
            n += 1
            added_total += len(new) - len(old)
            print(f"  {frel}: +{len(new)-len(old):4d} chars  ({note})")
        (REPO / frel).write_text(src, encoding="utf-8")
        print(f"{frel}: {n} quotation(s) extended")

    print(f"\n{len(JOBS)} quotations extended, {added_total} characters added, 0 removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
