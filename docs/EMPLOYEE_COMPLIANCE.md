# Employee Compliance — Ground Truth (Task S-b)

Verified rules for employing people at Greenway Marijuana (WA I-502 retailer,
license 413541, Port Orchard). Sources were read directly (app.leg.wa.gov,
lni.wa.gov, USCIS, DSHS, DOH) — none of this is guessed. This document drives
the Employee command center: the onboarding wizard, document tracker, training
log, handbook, and offboarding checklist.

## Cannabis-specific rules (LCB / RCW / WAC)

* **21+ only — RCW 69.50.357.** Every employee must be at least 21 years old.
  Violations carry a $1,000 penalty per violation. The onboarding wizard
  requires a verified date of birth before an employee can be activated.
* **Training — RCW 69.50.357.** ALL employees must be trained on the rules of
  the retail licensee AND on identifying persons under 21. Medically endorsed
  stores must also train employees on medical authorizations and recognition
  cards. The training log records topic, date, and trainer; the required
  topics are seeded automatically.
* **ID badges — WAC 314-55-083.** Every employee must hold and visibly display
  an employer-issued identification badge (trade name, employee's full legal
  name, photo) while on the licensed premises and during transport. Badge
  issuance is an onboarding step; badge retrieval is an offboarding step.
* **5-year employee records — WAC 314-55-087(1)(e).** "All employee records to
  include, but not limited to, training, payroll, and date of hire" must be
  kept on the licensed premises for five years. The command center stores hire
  date, training log, and document status; never delete employee rows —
  terminated employees remain on file (status = terminated).
* **No on-premises consumption — RCW 69.50.357.** Covered in the handbook's
  drug & alcohol policy.
* **Medical endorsement — DOH WAC 246-72.** A medically endorsed store must
  have a certified medical cannabis consultant on staff (20-hour DOH-approved
  training, current CPR card, 21+, $95 initial / $90 annual renewal by
  birthday, continuing education). Tracked as a credential document with an
  expiry date.

## Hiring order — WA Fair Chance Act (RCW 49.94.010)

* An employer may NOT ask about criminal records, run a background check, or
  use criminal history until AFTER the applicant is determined otherwise
  qualified and a **conditional offer** has been made. No blanket exclusions.
* The onboarding wizard therefore hard-orders the hiring phase:
  1. Interview / qualify the candidate,
  2. **Extend a conditional offer**,
  3. only THEN run the background check.
* 2025 c 71 amendments (legitimate-business-reason analysis, 2-business-day
  hold, written decision) reach employers with fewer than 15 employees on
  **January 1, 2027** — the helper text flags this so the store is ready.

## Federal + WA new-hire paperwork

* **Form I-9 (USCIS):** employee completes **Section 1 by the first day of
  work for pay**; employer completes **Section 2 within 3 business days of the
  start date**. Retain I-9s for 3 years after hire or 1 year after separation,
  whichever is later. The wizard computes and shows the Section 2 deadline
  from the hire date.
* **Form W-4 (IRS):** collected before the first payroll is run.
* **WA new-hire report:** report every new/rehired employee to the DSHS
  Division of Child Support **within 20 days** of hire
  (dshs.wa.gov/esa/division-child-support/new-hire-reporting). Deadline is
  computed from the hire date.

## WA wage & hour (L&I)

* **Paid sick leave — RCW 49.46.210 / WAC 296-128:** accrues at a minimum of
  **1 hour per 40 hours worked**, for ALL employees from day 1; usable
  starting the **90th calendar day** of employment; unused balance of **40
  hours or less carries over**; employees must get at least **monthly** notice
  of their balance (a payroll statement is fine); balance is reinstated if
  rehired within 12 months; no discipline for lawful use; verification may be
  required only for absences longer than 3 days. The command center computes
  accrual from recorded time punches (worked minutes ÷ 40 hours).
* **Meal & rest breaks (WAC 296-126-092):** 30-minute meal period when working
  more than 5 hours (started between hour 2 and hour 5); paid 10-minute rest
  break for every 4 hours worked. In the handbook.
* **Overtime:** 1.5× the regular rate over 40 hours/week (RCW 49.46.130).
* **Final pay — RCW 49.48.010:** wages due at the **end of the established pay
  period** after separation (no same-day payout requirement). Offboarding
  checklist item.

## Offboarding (what a professional operation does)

1. Record termination date + reason (kept 5 years with the rest of the file).
2. Retrieve/void the LCB ID badge (WAC 314-55-083).
3. Clear the time-clock PIN; end any open punch.
4. Deactivate any back-office login (Users page) the same day.
5. Remove from future schedules.
6. Final paycheck at the end of the established pay period (RCW 49.48.010).
7. Keep the employee record — never delete (WAC 314-55-087 5-year retention;
   I-9 retention runs 3 years from hire / 1 year from separation).

## Design decisions in the app

* `employees.employment_status`: `candidate → onboarding → active → terminated`.
  Hiring-phase steps (conditional offer before background check) are enforced
  by ORDER in the wizard; the app nudges but the owner checks the boxes.
* Onboarding tasks, documents, and training entries live in their own tables
  (migration 0117) keyed to the employee; seeded from the pure-core
  definitions so the checklist is consistent for every hire.
* Documents track status (missing / on file / signed) + dates; the tracker
  answers the owner's question directly: "Do we have their W-4 and I-9 on
  file? Did they read and sign the handbook?"
* The handbook is built into the back office (print-friendly), with a
  read-and-sign acknowledgment tracked per employee as a document.
* AI is drafts-only: the HR helper drafts policy language and answers process
  questions from aggregate roster stats — it never sees SSNs, DOBs, banking,
  or any document contents, and it never changes records.
