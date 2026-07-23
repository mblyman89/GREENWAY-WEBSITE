/**
 * GuidedIntakeWizard — Task P. The hand-holding, step-by-step patient intake
 * on /admin/medical. Replaces the retired /admin/medical/intake page and the
 * old per-customer quick form with ONE hardened path.
 *
 * The wizard mirrors the DOH consultant procedure exactly (verbatim sequence
 * from the DOH Patient FAQ + MCR Consultant guide — see
 * docs/MEDICAL_CANNABIS_COMPLIANCE.md §3):
 *   1. Pick the patient (must exist as a customer first — birthdate drives the
 *      minor/adult statutory expiration rule).
 *   2. Validate the paper authorization (DOH 608-048 four checks) + scan it on
 *      the Canon PIXMA TS3522.
 *   3. Work in the MCR (SecureAccess WA → MCR): enter the patient, take &
 *      upload the photo, collect the $1 fee, copy back the card number the
 *      MCR GENERATED (staff never invent it) and the dates.
 *   4. Issue here (records the WAC 314-55-090(2) card facts), then print the
 *      store companion card and laminate it on the Scotch Thermal Laminator.
 *
 * Server component: search + selection travel as GET params (?patq, ?patient);
 * submission posts to guidedIntakeAction which enforces every rule again
 * server-side (the UI hints are never the enforcement layer).
 */
import Link from "next/link";
import { Badge, Button } from "@/components/admin/ui";
import { listCustomers, getCustomerById } from "@/lib/customers/store";
import { getActiveCard, toRecognitionCard } from "@/lib/medical/store";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";
import {
  classifyPatientAge,
  maxExpirationFor,
  type PatientAgeClass,
} from "@/lib/medical/medical-intake-core";
import { pacificToday } from "@/lib/reports/timezone";
import { guidedIntakeAction } from "@/app/admin/medical/actions";

const AGE_BADGE: Record<PatientAgeClass, { label: string; tone: "green" | "gold" | "orange" | "neutral" }> = {
  minor: { label: "MINOR — 6-month card max, parent/guardian DP required", tone: "orange" },
  adult_18_20: { label: "18–20 — MUST register to buy at all", tone: "gold" },
  adult_21_plus: { label: "Adult 21+ — registration voluntary", tone: "green" },
  unknown: { label: "No birthdate on file — set it on the customer profile", tone: "neutral" },
};

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        done
          ? "bg-[var(--admin-green,#16a34a)] text-white"
          : "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}

export async function GuidedIntakeWizard({
  patientQuery,
  patientId,
  errorMessage,
  issuedId,
  scanError,
}: {
  patientQuery: string;
  patientId: string;
  errorMessage: string | null;
  issuedId: string | null;
  scanError: string | null;
}) {
  const today = pacificToday();
  const [results, selected] = await Promise.all([
    patientQuery ? listCustomers({ q: patientQuery, limit: 10 }) : Promise.resolve([]),
    patientId ? getCustomerById(patientId) : Promise.resolve(null),
  ]);
  const existingCard = selected ? await getActiveCard(selected.id) : null;
  const existingValidity = existingCard
    ? authorizationValidityAt(toRecognitionCard(existingCard))
    : null;

  const ageClass = selected ? classifyPatientAge(selected.birthdate, today) : "unknown";
  const minor = ageClass === "minor";
  const maxExpToday = maxExpirationFor(today, minor);

  return (
    <section
      id="intake"
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--admin-text)]">
          Guided patient intake{" "}
          <span className="text-xs font-normal text-[var(--admin-text-faint)]">
            · new card, renewal, or replacement
          </span>
        </h2>
        <Badge tone="outline">DOH-certified consultant only</Badge>
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
        Follow the steps top to bottom — the system blocks anything unlawful at submit. Only a
        DOH-Certified Medical Cannabis Consultant may register patients in the MCR; any employee may
        verify existing cards at the register.
      </p>

      {/* Success banner — points straight at print & laminate */}
      {issuedId && (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-green,#16a34a)]/40 bg-[var(--admin-green,#16a34a)]/10 px-4 py-3 text-sm">
          <p className="font-semibold text-[var(--admin-green,#16a34a)]">
            ✓ Recognition card recorded. Final step: print &amp; laminate.
          </p>
          <p className="mt-1 text-[var(--admin-text)]">
            <Link
              href={`/admin/medical/card/${issuedId}`}
              target="_blank"
              className="font-semibold underline"
            >
              Open the print page →
            </Link>{" "}
            print the companion card, run it through the Scotch Thermal Laminator, then click
            &ldquo;Mark printed &amp; laminated&rdquo; there. Hand the patient their MCR card,
            authorization form, and ID back.
          </p>
          {scanError ? (
            <p className="mt-1 text-[var(--admin-danger)]">
              Scan upload failed ({scanError}) — re-attach it from the patient&rsquo;s customer
              profile so the 5-year record is complete.
            </p>
          ) : null}
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
          {errorMessage}
        </div>
      )}

      {/* ── Step 1: patient ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--admin-border)] p-4">
        <div className="flex items-center gap-2">
          <StepBadge n={1} done={Boolean(selected)} />
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">Patient</h3>
        </div>

        {!selected && (
          <div className="mt-3 space-y-2">
            <form method="GET" action="/admin/medical" className="flex gap-2">
              <input
                type="search"
                name="patq"
                defaultValue={patientQuery}
                placeholder="Search name, email, or phone…"
                className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none"
              />
              <Button type="submit" variant="neutral" size="sm" className="shrink-0">
                Search
              </Button>
            </form>
            {patientQuery &&
              (results.length === 0 ? (
                <p className="px-1 py-1 text-sm text-[var(--admin-text-faint)]">
                  No match. Add them on the{" "}
                  <Link href="/admin/customers" className="underline">
                    Customers page
                  </Link>{" "}
                  first (include the birthdate — it drives the card-length rule), then search again.
                </p>
              ) : (
                results.map((r) => (
                  <Link
                    key={r.id}
                    href={`/admin/medical?patient=${r.id}#intake`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-sm transition hover:border-[var(--admin-border)] hover:bg-[var(--admin-canvas)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--admin-text)]">
                        {`${r.first_name} ${r.last_name ?? ""}`.trim() || "—"}
                      </p>
                      <p className="truncate text-xs text-[var(--admin-text-muted)]">
                        {r.email ?? "no email"} · {r.phone ?? "no phone"} · DOB{" "}
                        {r.birthdate ?? "not set"}
                      </p>
                    </div>
                    {r.is_medical_patient && <Badge tone="green">Medical</Badge>}
                  </Link>
                ))
              ))}
            {!patientQuery && (
              <p className="px-1 text-xs text-[var(--admin-text-faint)]">
                The patient must exist as a customer first — their birthdate decides whether the
                6-month (minor) or 1-year (adult) card limit applies.
              </p>
            )}
          </div>
        )}

        {selected && (
          <div className="mt-3 rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--admin-text)]">
                  {`${selected.first_name} ${selected.last_name ?? ""}`.trim()}
                </p>
                <p className="truncate text-xs text-[var(--admin-text-muted)]">
                  {selected.email ?? "no email"} · {selected.phone ?? "no phone"} · DOB{" "}
                  {selected.birthdate ?? "not set"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={AGE_BADGE[ageClass].tone}>{AGE_BADGE[ageClass].label}</Badge>
                <Link
                  href="/admin/medical#intake"
                  className="text-xs text-[var(--admin-text-faint)] underline hover:text-[var(--admin-accent)]"
                >
                  change
                </Link>
              </div>
            </div>
            {existingCard && existingValidity && (
              <p className="mt-2 text-xs">
                {existingValidity.valid ? (
                  <span className="text-[var(--admin-gold,#d4a72c)]">
                    ⚠ Already has a VALID card (expires {existingCard.expires_on ?? "—"}). Continue
                    only for a renewal (new authorization required) or a lost/stolen replacement —
                    replacements keep the SAME expiration unless the practitioner reexamined them.
                  </span>
                ) : (
                  <span className="text-[var(--admin-text-muted)]">
                    Previous card on file is not valid ({existingValidity.reason}) — a fresh intake
                    is the right move.
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Steps 2–4 need a patient ─────────────────────────────────────── */}
      {selected ? (
        <form action={guidedIntakeAction} className="mt-4 space-y-4">
          <input type="hidden" name="customer_id" value={selected.id} />
          {minor && <input type="hidden" name="is_minor" value="true" />}

          {/* Step 2: paper authorization */}
          <div className="rounded-lg border border-[var(--admin-border)] p-4">
            <div className="flex items-center gap-2">
              <StepBadge n={2} />
              <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                Validate &amp; scan the paper authorization
              </h3>
            </div>
            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
              Check the form against their state ID. All four DOH 608-048 checks are required — if
              any fails, STOP and send the patient back to their practitioner.
            </p>
            <div className="mt-3 space-y-2 text-sm text-[var(--admin-text)]">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="chk_form" className="mt-0.5 h-4 w-4" />
                <span>Form complete &amp; signed by a health care practitioner</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="chk_tamper" className="mt-0.5 h-4 w-4" />
                <span>Printed on tamper-resistant paper with a security feature</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="chk_identity" className="mt-0.5 h-4 w-4" />
                <span>Identity verified — full legal name matches their state ID</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="chk_seal" className="mt-0.5 h-4 w-4" />
                <span>Embossed RCW 69.51A.030 seal visible</span>
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-3">
              <p className="mb-1 text-xs font-semibold text-[var(--admin-text)]">
                🖨 Scan it now (Canon PIXMA TS3522)
              </p>
              <p className="mb-2 text-xs text-[var(--admin-text-faint)]">
                Face-down on the flatbed → scan to PDF/JPG → attach here. Stored privately as part
                of the WAC 314-55-090(2) five-year record.
              </p>
              <input
                type="file"
                name="form_scan"
                accept="application/pdf,image/png,image/jpeg,image/tiff"
                className="block w-full text-sm text-[var(--admin-text-muted)] file:mr-3 file:rounded-[var(--admin-radius)] file:border-0 file:bg-[var(--admin-surface-2,#1f2937)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--admin-text)]"
              />
            </div>
          </div>

          {/* Step 3: work in the MCR */}
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-4">
            <div className="flex items-center gap-2">
              <StepBadge n={3} />
              <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                Register in the DOH Medical Cannabis Registry (MCR)
              </h3>
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-8 text-sm text-[var(--admin-text)]">
              <li>
                Log in via SecureAccess Washington (SAW) → open the MCR (works best in Chrome).
                Select OUR store by LCB license <span className="font-mono">413541</span>.
              </li>
              <li>Enter the authorization-form data into the MCR.</li>
              <li>
                Take the patient&rsquo;s photo (portrait, JPEG, ≥400×600, 4:6 ratio) and upload it in
                the MCR. Photograph the designated provider too, if there is one.
              </li>
              <li>
                The MCR <strong>generates the card number</strong> and produces the official card.
                Copy that card number and the dates into the fields below — never make one up.
              </li>
            </ol>
            <div className="mt-3 space-y-2 text-sm text-[var(--admin-text)]">
              <label className="flex items-start gap-2">
                <input type="checkbox" name="chk_consultant" className="mt-0.5 h-4 w-4" />
                <span>
                  I am a <strong>DOH-Certified Medical Cannabis Consultant</strong> with a current
                  certification (budtenders may only verify cards, not create them)
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="in_doh_database" defaultChecked className="mt-0.5 h-4 w-4" />
                <span>Patient is entered and ACTIVE in the MCR</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="photo_uploaded_to_mcr" className="mt-0.5 h-4 w-4" />
                <span>Photo taken &amp; uploaded to the MCR (RCW 69.51A.230(3)(c))</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="card_fee_collected" className="mt-0.5 h-4 w-4" />
                <span>
                  Collected the <strong>$1 recognition-card fee</strong> (RCW 69.51A.230(10) —
                  required at registration; the store may charge more)
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="compassionate_renewal" className="mt-0.5 h-4 w-4" />
                <span>
                  Compassionate-care renewal by the designated provider (photo requirement waived —
                  RCW 69.51A.230(4)(b))
                </span>
              </label>
              {minor && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="chk_minor_dp" className="mt-0.5 h-4 w-4" />
                  <span>
                    <strong>Minor:</strong> parent/legal-guardian designated provider is registered
                    in the MCR too (RCW 69.51A.220) — register the DP with their own identical
                    authorization
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Step 4: record the card here */}
          <div className="rounded-lg border border-[var(--admin-border)] p-4">
            <div className="flex items-center gap-2">
              <StepBadge n={4} />
              <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                Record the card (copy from the MCR)
              </h3>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Card number (generated by the MCR)
                </span>
                <input
                  name="unique_patient_identifier"
                  required
                  placeholder="Copy it exactly from the MCR"
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Holder type
                </span>
                <select
                  name="holder_type"
                  defaultValue="patient"
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                >
                  <option value="patient">Patient</option>
                  <option value="designated_provider">Designated Provider</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Authorization issued on (from the paper form)
                </span>
                <input
                  name="authorization_issued_on"
                  type="date"
                  required
                  max={today}
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Effective date (today, unless the MCR shows otherwise)
                </span>
                <input
                  name="effective_on"
                  type="date"
                  required
                  defaultValue={today}
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Expiration date — MUST match the MCR card. Legal maximum:{" "}
                  {minor ? "6 months" : "1 year"} after the authorization was issued
                  {maxExpToday ? ` (if issued today: ${maxExpToday})` : ""}. The system blocks
                  anything longer.
                </span>
                <input
                  name="expires_on"
                  type="date"
                  required
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-text-muted)]">
                  Notes (optional — e.g. &ldquo;replacement, same expiration&rdquo;)
                </span>
                <input
                  name="notes"
                  className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] px-3 py-2 text-sm text-[var(--admin-text)]"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="confirm">
              Issue recognition card →
            </Button>
            <span className="text-xs text-[var(--admin-text-faint)]">
              Step 5 appears after issuing: print the companion card &amp; laminate it (Scotch
              Thermal Laminator).
            </span>
          </div>
        </form>
      ) : (
        <p className="mt-3 px-1 text-xs text-[var(--admin-text-faint)]">
          Steps 2–5 unlock once a patient is selected.
        </p>
      )}
    </section>
  );
}
