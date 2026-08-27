/**
 * books-67 probe: what EXACTLY does an empty quarter refuse with?
 *
 * KEPT, and it earns its place. The empty-quarter behaviour now depends on ONE
 * refusal code being the only one raised on a clean empty quarter: the
 * confirmation route draws a blank form for `NO_SUBJECTS` alone and still
 * refuses for everything else. If a future slice adds a second refusal that
 * fires on an empty quarter — a missing rate, say, or a headcount determination
 * — the blank form silently stops appearing and Michael is back to the screen he
 * reported. Run this to see the refusal list in one command.
 *
 * It is a PROBE, not a gate: the binding assertions live in
 * `tests/compliance/eams-confirmation-core.test.ts` and `form-sheet-core.test.ts`.
 *
 * Michael reported "1 problem, no payroll yet". Before changing any page, prove
 * that the refusal is NO_SUBJECTS and that it is the ONLY one on an otherwise
 * clean empty quarter. Fixing the wrong refusal would leave his screen unchanged
 * and would look, from here, exactly like success.
 */
import {
  validateWaQuarterRequest,
  buildWaQuarter,
  type WaQuarterRequest,
} from "../../src/lib/payroll/wa-quarterly-core";
import { GREENWAY_RATES } from "../../src/lib/payroll/payroll-rates-2026";
import { waResolveRates, waRateAsOfDate } from "../../src/lib/payroll/wa-quarterly-ui-core";

const quarter = { year: 2026, quarter: 3 } as const;
const asOf = waRateAsOfDate(quarter);
const resolved = waResolveRates(GREENWAY_RATES, asOf);

console.log(`rates resolved for ${asOf}: ${resolved.ok}`);
if (!resolved.ok) {
  console.log("  missing:", resolved.missing.map((m: { label: string }) => m.label).join(", "));
  process.exit(1);
}

const req: WaQuarterRequest = {
  quarter,
  subjects: [],
  rates: resolved.rates,
  // Nested under `pfml`, not flat. First draft of this probe guessed flat and
  // threw; the real shape came from reading the type (rule 1).
  pfml: {
    employerOwesEmployerShare: false,
    determinedAverageHeadcount: null,
  },
};

const refusals = validateWaQuarterRequest(req);
console.log(`\nrefusals on an EMPTY quarter: ${refusals.length}`);
for (const r of refusals) {
  console.log(`  code=${r.code}`);
  console.log(`  because=${r.because}`);
}

const built = buildWaQuarter(req);
console.log(`\nbuildWaQuarter ok: ${built.ok}`);

if (refusals.length === 1 && refusals[0].code === "NO_SUBJECTS") {
  console.log("\nCONFIRMED: exactly one refusal, NO_SUBJECTS. Matches his '1 problem'.");
} else {
  console.log("\nHYPOTHESIS WRONG - do not proceed on the assumption it is NO_SUBJECTS.");
  process.exit(1);
}
