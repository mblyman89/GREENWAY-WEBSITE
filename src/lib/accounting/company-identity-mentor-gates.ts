/**
 * src/lib/accounting/company-identity-mentor-gates.ts   (books-33)
 *
 * THE RULE-26 COVERAGE GATES FOR THE COMPANY-IDENTITY MENTOR.
 *
 * Moved here verbatim from `company-identity-mentor.ts`. Nothing was relaxed:
 * the gate still reads `company-identity-core.ts` from disk, still fails when
 * it reads nothing (rule 39), still fails on an untaught function, and still
 * fails on an explanation that outlived its function.
 *
 * The move was forced by the browser. `CompanyInformationForm.tsx` is a client
 * component and imports the mentor's lessons, so the mentor must be bundlable
 * for a browser, and `node:fs` never can be. Vercel said so on every build
 * while CI said nothing, because CI does not run `next build`.
 *
 * Imported by tests only - verified by grep across `src/app` and
 * `src/components` before the move, and kept true afterwards by
 * `tests/compliance/client-bundle-purity.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMPANY_FIELD_LESSONS,
  COMPANY_SCREEN_LESSONS,
  explainFormNeeds,
} from "@/lib/accounting/company-identity-mentor";

/**
 * Every exported function of the core engine has to be taught somewhere.
 *
 * READS THE CORE MODULE FROM DISK. Standing rule 26's gate is only worth
 * anything if it inspects the real file rather than a list someone maintains by
 * hand, and rule 39 requires it to fail when it reads nothing.
 */
export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "company-identity-core.ts");
  const text = readFileSync(p, "utf8");
  const names = [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  return names;
}

/**
 * Which core functions the mentor explains.
 *
 * The mentor teaches FIELDS rather than functions, so this maps the engine's
 * public surface to the lesson material that covers it. It is written out
 * explicitly because the relationship is genuinely a judgement - unlike the
 * field coverage above, which is mechanical - and a wrong mapping here is
 * caught by the assertion that every listed function actually exists.
 */
export const CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  formatEin:
    "Taught by the EIN lesson, which explains that the hyphen is print formatting and the nine digits " +
    "are the data.",
  normaliseEinInput:
    "Taught by the EIN lesson's trap: a number pasted from a letter arrives with a hyphen and must be " +
    "reduced to digits without accepting anything that is not nine digits.",
  signerRuleFor:
    "Taught by the entity_type and signer_title lessons, which explain that the permitted signer depends " +
    "on federal tax classification.",
  fieldsForForm:
    "Taught by explainFormNeeds, which narrates the derived list for any form so Michael can see what a " +
    "given filing depends on.",
  formReadiness:
    "Taught by the screen lesson on why the same information appears on several forms - readiness is the " +
    "practical answer to 'can I file this yet'.",
  allFormReadiness: "Taught by the same lesson, applied to every form at once for the summary panel.",
  requireField:
    "Taught by the EIN lesson's consequence: a form builder that found nothing and substituted a blank " +
    "would produce a return that looks filed and is not, so this refuses instead.",
  assertEveryFieldAuthorityExists:
    "Taught by the screen lesson on citations - a citation with nothing behind it is worse than none.",
  assertNoFieldWithoutConsumers:
    "Taught by the screen lesson on why the same information appears on several forms: a field no form " +
    "consumes cannot be checked for readiness and must not pretend otherwise.",
  assertEveryFormHasFields:
    "Taught by the same lesson from the other side: a form that reads no fields would report itself " +
    "ready forever.",
  assertEverySignerRuleExists:
    "Taught by the entity_type and signer_title lessons. It proves that every federal tax " +
    "classification the company profile can store has a signer rule quoted from the Instructions for " +
    "Form 941, so the mentor can never go silent on who may legally sign a return.",
};

/**
 * The rule-26 gate: every exported core function is covered.
 *
 * Reads the file. Fails when it reads nothing. Fails when a function ships with
 * no explanation.
 */
export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const exported = exportedCoreFunctionNames(sourcePath);
  if (exported.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no exported functions from company-identity-core.ts. A coverage " +
        "gate that inspects nothing passes vacuously and protects nothing.",
    );
  }
  const uncovered = exported.filter((f) => !(f in CORE_FUNCTION_COVERAGE));
  if (uncovered.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these exported functions have no explanation: ${uncovered.join(", ")}. ` +
        `Standing rule 26 requires every exported function to be taught before it ships.`,
    );
  }
  const phantom = Object.keys(CORE_FUNCTION_COVERAGE).filter((k) => !exported.includes(k));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale coverage entry ` +
        `masks a real gap, because the count looks right while a live function goes untaught.`,
    );
  }
}
