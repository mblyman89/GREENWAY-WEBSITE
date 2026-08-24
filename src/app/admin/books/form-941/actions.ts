"use server";

/**
 * src/app/admin/books/form-941/actions.ts   (slice books-48)
 *
 * THE SERVER ACTION FOR THE FILED-TOTALS CONFIRMATION STEP. Exactly one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `form-941-confirmation-store.ts` is marked `import "server-only"`. That
 * marking is what stops a browser bundle from ever containing the service-role
 * key, and it means the store CANNOT be called from the client component that
 * collects the typing. Something has to stand between them. This is that
 * something, and it is deliberately the thinnest possible thing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE GATE IS RE-CHECKED HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A server action is a PUBLIC HTTP ENDPOINT. Next.js gives it a URL, and that
 * URL can be posted to by anything on the internet - the client component that
 * normally calls it need never have loaded, so no check performed in that
 * component protects this path at all.
 *
 * Worse, the store uses the service role, which by design ignores the
 * owner-only RLS policies on `filed_form_941_totals`. So the database gate is
 * INERT here too. `requireBooksAccess()` is not one of several protections
 * layered together; on this path it is the ONLY one. It is called first, before
 * a single field is looked at, and it is not optional.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY NOTHING HERE VALIDATES ANYTHING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every judgement about what a filed figure may look like lives in
 * `validateFiledForm941Draft`, and the store calls it. If this file checked
 * even one field on its way past - a year, a blank note, anything - there
 * would be two answers to that question in the codebase, and the day they
 * disagreed the symptom would be a form that accepts a figure the store
 * refuses, or refuses one the store would have taken (rule 25).
 *
 * This file is WIRING. It authorises, forwards, translates the outcome into
 * something a form can render, and tells Next.js the page is stale. That is
 * the whole job.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY ERRORS ARE RETURNED AND NEVER THROWN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A thrown error in a server action renders an error boundary: a blank screen
 * where the guidance used to be, and no indication whether the write happened.
 * On THIS form that ambiguity is expensive in a specific way - if Michael
 * cannot tell whether Q1 saved, he will type it again, and while the store's
 * upsert makes a duplicate harmless, the screen would have taught him that
 * saving twice is normal. It is not, and on other screens it is not harmless.
 *
 * So: three distinct outcomes, never collapsed.
 *
 *   ok:true               - stored. Says whether it REPLACED an existing row,
 *                           because a silent overwrite is the one thing this
 *                           design refuses to perform, and carries any
 *                           warnings, which are information and not failure.
 *   ok:false + refusals   - the entry is wrong. Field-attached, fixable.
 *   ok:false + message    - the environment is wrong. NOT Michael's fault, and
 *                           the wording has to say so, because a person told
 *                           "invalid" hunts for a typo that does not exist.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY revalidatePath IS CALLED ONLY ON SUCCESS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The 941 screen reads the recorded quarters to build its comparison rows.
 * After a successful save that cached render is stale and MUST be discarded,
 * or Michael saves a figure and the check rows above the form carry on showing
 * "not recorded yet" - which reads exactly like the save failed.
 *
 * After a refusal nothing changed, so revalidating would throw away a good
 * cache entry and re-render the page for no reason.
 */

import { revalidatePath } from "next/cache";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { saveFiledForm941 } from "@/lib/payroll/form-941-confirmation-store";
import type {
  FiledForm941Draft,
  FiledForm941Refusal,
  FiledForm941Warning,
} from "@/lib/payroll/form-941-confirmation-core";

/** The page this form lives on, named once. */
const FORM_941_PATH = "/admin/books/form-941";

/**
 * What the client form receives back.
 *
 * `refusals` and `warnings` are always present as arrays rather than being
 * optional, so the component never has to write `?? []` and can never forget
 * to. An empty array and an absent array mean the same thing to a reader and
 * different things to `.map`.
 */
export type SaveFiledForm941ActionResult = {
  readonly ok: boolean;
  /** Always a whole sentence safe to render on its own. */
  readonly message: string;
  readonly refusals: readonly FiledForm941Refusal[];
  readonly warnings: readonly FiledForm941Warning[];
  /**
   * True only when an existing quarter's figures were overwritten.
   *
   * Surfaced so the form can SAY it happened. Michael re-entering Q1 because
   * he found a transcription error is correct and normal; Michael overwriting
   * Q1 because he thought he was entering Q2 is a mistake he can only catch if
   * the screen tells him a replacement occurred.
   */
  readonly replacedExisting: boolean;
};

export async function saveFiledForm941Action(
  draft: FiledForm941Draft,
): Promise<SaveFiledForm941ActionResult> {
  await requireBooksAccess();

  const res = await saveFiledForm941(draft);

  if (res.ok) {
    revalidatePath(FORM_941_PATH);
    return {
      ok: true,
      message: res.message,
      refusals: [],
      warnings: res.warnings,
      replacedExisting: res.replacedExisting,
    };
  }

  if (res.code === "REFUSED") {
    return {
      ok: false,
      /*
       * A HEADLINE THAT DOES NOT REPEAT THE DETAIL.
       *
       * Each refusal already carries its own `what` and `fix`, rendered beside
       * the field it belongs to. A headline that restated the first one would
       * make a single problem look like two, and when there are three
       * refusals it would silently promote one of them above the others for
       * no reason a reader could work out.
       */
      message:
        res.refusals.length === 1
          ? "Nothing was saved. There is one thing to fix, marked below."
          : `Nothing was saved. There are ${res.refusals.length} things to fix, marked below.`,
      refusals: res.refusals,
      warnings: [],
      replacedExisting: false,
    };
  }

  // NOT_CONFIGURED | WRITE_FAILED | READ_FAILED. The store writes these
  // sentences to explain that the fault is not in the typing, so they are
  // passed through verbatim rather than being summarised into "an error
  // occurred", which is the sentence Michael's complaint about Sage is about.
  return {
    ok: false,
    message: res.message,
    refusals: [],
    warnings: [],
    replacedExisting: false,
  };
}
