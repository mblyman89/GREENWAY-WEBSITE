# SOP-08 — New Hire Onboarding, System Access and Offboarding

| | |
|---|---|
| **Version** | 1.2 (owner answers to Q-08-1...Q-08-5 applied, D70-D74; Phase 0.3 fix G-52 + G-59 built; draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Employees** (`/admin/staffing/employees` and each employee file): owner, admin and manager (`staffing.manage`). **Users** (`/admin/users`): owner and admin (`users.manage`). **Time Clock** (`/admin/staffing`, `/admin/staffing/clock`): every role with `timeclock.use` (owner, admin, manager, budtender). The new hire takes part in onboarding (I-9 Section 1, handbook, training, badge photo). |
| **Verified against** | `main@bad718b4` (2026-10-28). Every label, button, message, number and rule below was read from the code or quoted from the state texts (RCW 69.50.357, WAC 314-55-083, WAC 314-55-087, read 2026-10-28 from app.leg.wa.gov) or from the owner. Nothing was written from memory. Where the code and a help panel or comment disagree, this SOP follows the code and records a finding. Where the code cannot do something the law or the owner needs, this SOP says so plainly and gives the safe interim. |
| **Program records** | Findings `F-08-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-52`…`G-58` in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D41 (living SOPs), D42 (concierge covers every feature), **D69 (this SOP is next; accounting and the Lyman menu are skipped)** in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md`, and the owner's books-87 decision that a login is not a job (quoted in `supabase/migrations/0210_separate_logins_from_employees.sql` L4–12) · Scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` (SOP-08) |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work.

> **What the owner asked for.** *"The next major sop I want to work on is new hire onboarding, system management and off boarding employees. Please proceed with this sop next. Follow the standing rules."* Payroll, W-4, direct deposit and everything else in the accounting branch, and the Lyman menu (Security Log, Compliance Calendar), are **skipped** by the owner's instruction (D69). This SOP points to them and stops there.

> **How to use this document.** Part 1 (§4.1–§4.4) explains the two identity systems: the **employee file** (a person who works here, with a time-clock PIN) and the **user** (a back-office sign-in). Part 2 (§4.5–§4.14) is **onboarding**, in the legal order. Part 3 (§4.15–§4.19) is **system management**: PINs, roles, the handbook gate, changes while employed. Part 4 (§4.20–§4.24) is **offboarding** and rehire. Section 8 has the paper forms and Section 9 the quick cards.

> **The one thing to know before anything else.** Item 1 below is now fixed; items 2 and 3 still do **not** work the way the screens suggest, and each has an interim rule in this SOP:
> 1. **Fixed in Phase 0.3 (G-52, G-59):** new people now start as a **Candidate** with **no clock PIN** (`staffing/actions.ts` L119–143; Payroll Setup `payroll-onboarding-store.ts` L1132–1144), so they cannot clock in or unlock a register. The PIN can only be set once the person is **Active** (`staffing/actions.ts` L170–178). Only the **owner or an admin** can press Start onboarding, Activate, Terminate or Rehire (`roles.ts` L265, `[id]/actions.ts` L192). Activate unlocks only when the required steps are done.
> 2. **The employee file and the user are not connected by the app** (F-08-2). Terminating an employee does **not** deactivate their sign-in, and deactivating a user does **not** clear their PIN. **Offboarding is always both halves** (§4.21, form 8.3).
> 3. **Checking "Employee read and signed the handbook" does not unlock the register.** The register looks at the **Document tracker** row **Employee handbook acknowledgment = Read & signed** (`handbook-ack-store.ts` L107–118), not at the checklist box (F-08-4). Set both (§4.10).

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: Two identity systems**
   - 4.1 The employee file and the user
   - 4.2 Where everything lives
   - 4.3 Employment statuses
   - 4.4 Which people need which

   **Part 2: Onboarding (in the legal order)**
   - 4.5 Before the offer: interview without asking about records
   - 4.6 Adding the person (no PIN)
   - 4.7 Hiring steps: offer, background check, age 21
   - 4.8 Paperwork: I-9, W-4, DSHS new-hire report
   - 4.9 Hire info: hire date, badge number, 21+ box
   - 4.10 The handbook: checklist box, document row and the gates
   - 4.11 Training and the training log
   - 4.12 The photo ID badge
   - 4.13 Ready to work: PIN, schedule, payroll pointer
   - 4.14 The back-office sign-in (Users), when needed

   **Part 3: System management while employed**
   - 4.15 PINs: rules, changing, removing, lockout
   - 4.16 Roles: back-office role and job role
   - 4.17 Changing a role or job role
   - 4.18 The handbook gate and new handbook versions
   - 4.19 Visitors and non-employees on the premises

   **Part 4: Offboarding and rehire**
   - 4.20 Before the last day
   - 4.21 Terminating: both halves, same day
   - 4.22 The offboarding checklist
   - 4.23 Records: never delete
   - 4.24 Rehiring a former employee
5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference cards
10. Glossary

Appendix A: Source map · Appendix B: Not built yet (interim procedures) · Appendix C: Open questions for the owner · Appendix D: Revision history

---

## 1. Purpose & scope

This SOP makes every hire, every access change and every departure **legal, recorded and the same every time**. It covers:

- **Onboarding**: from interview to the first shift. It follows the order the law requires, and it ends only when the person is 21+ verified, has completed the I-9 and W-4, has signed the handbook, has been trained, and holds a badge.
- **System access**: the time-clock PIN (clock in, register unlock, approvals), the back-office sign-in (Users), roles and job roles, and the handbook gate.
- **Offboarding**: the termination record, PIN, sign-in, badge, schedule, the final pay pointer, and keeping the file for five years.

**Out of scope (owner instruction, D69):** pay rates, W-4 withholding set-up, direct deposit and the ACH e-sign, payroll runs, final-pay calculation, sick-leave balances, employee tabs (these are in the accounting branch), the Security Log and the Compliance Calendar (Lyman menu). Where onboarding touches them, this SOP says "the owner handles it in Accounting" and stops.

**Law this SOP is built on (read 2026-10-28):**

- **RCW 69.50.357(2):** *"Licensed cannabis retailers may not employ persons under twenty-one years of age…"*
- **RCW 69.50.357(3)(a):** retailers *"must ensure that all employees are trained on the rules adopted to implement this chapter, identification of persons under the age of twenty-one, and other requirements adopted by the board…"*. Section (3)(b) adds training on authorizations and recognition cards for a medically endorsed store.
- **WAC 314-55-083(1):** *"All licensees and employees on the licensed premises shall be required to hold and properly display an identification badge issued by the licensed employer at all times while on the licensed premises… The identification badge must list the licensee's trade name and include the person's full and legal name and photograph. All licensees and employees must have their state issued identification available to verify the information on their badge is correct."* Sections (1)(a)–(c) require visitor badges and a visitor log, kept three years (§4.19).
- **WAC 314-55-087(1)(e):** records kept on the licensed premises **for five years** include *"All employee records to include, but not limited to, training, payroll, and date of hire"*.

The employment-law references in the app (WA Fair Chance Act RCW 49.94.010, USCIS I-9 timing, DSHS new-hire reporting, RCW 49.48.010 final wages) are quoted from the app's own checklist text (`employee-lifecycle-core.ts`), which cites `docs/EMPLOYEE_COMPLIANCE.md`. This SOP repeats them as the app states them. It is not legal advice.

## 2. Roles & permissions

| Who | Back-office role (`roles.ts`) | What they may do here |
|---|---|---|
| **Owner** | Owner | Everything. The only role that can grant Owner. Exempt from the handbook gate (`handbook-ack-core.ts` L47, L68) |
| **Admin** | Admin | Employees (`staffing.manage`, L260) and Users (`users.manage`, L221): invite, change roles up to Admin, deactivate |
| **Manager** | Manager | Employees only (`staffing.manage`): add people, run the checklists, documents, training, hire info, PINs. **Not Start onboarding, Activate, Terminate or Rehire** (owner decision D74; built in Phase 0.3, G-59: the buttons are hidden for managers, who see *"Activate, Terminate and Rehire: owner or admin only."*, and the server refuses them, `[id]/page.tsx` L71, L247; `[id]/actions.ts` L192). PINs only once the person is Active. **Cannot open Users** |
| **Budtender** | Budtender / Staff | Time clock (`timeclock.use`, L264), Cycle Counts (`inventory.count`), loyalty and customers. No Employees, no Users |
| **Content editor**, **Read-only** | Content Editor, Read-only / Analyst | No Employees, no Users, no time clock |

**Rules for this SOP:**

1. **Onboarding is prepared by the owner, an admin or a manager, but only the owner or an admin presses Activate, Terminate or Rehire** (D74: *"I would like to modify this to be owner admin only. No manager access."*). The person who presses the button signs form 8.1 or 8.3. The app enforces this (permission `staffing.lifecycle` = owner, admin; `roles.ts` L265).
2. **Only the owner or an admin issues or removes a back-office sign-in** (Users). A manager who must send someone home (for example a dismissal on the spot) **removes nothing**: they call the owner or an admin, who terminates and deactivates the same day (§4.21).
3. **Nobody changes their own access.** The app enforces this: you cannot change your own role or deactivate yourself (`user-guards-core.ts` L65–67, L96–98).
4. **Nobody grants a role above their own.** The app enforces this for invites and changes (L43–50), and the last active owner cannot be demoted or deactivated (L73–80, L108–110).
5. **Payroll set-up and direct deposit are the owner's**, in Accounting (D69). Managers do not enter pay rates or bank details.

## 3. Before you start

- The new hire has accepted a **written conditional offer** (§4.7). Do not start the file before the interview is done.
- Have ready: a blank **form 8.1** (onboarding sign-off), the current **I-9** and **W-4** forms, the printed handbook (Employees → **Handbook & Policies**, version **2.0**, `handbook-content.ts` L24), and the badge template.
- Confirm **migrations 0117 and 0136** are applied: the roster shows a gold banner if either is missing (`employees/page.tsx` L119–131). Without 0117 there is no checklist, and without 0136 the handbook gate is **open** (it never blocks anyone).
- Decide which access the person needs (§4.4): a PIN only, or a PIN and a back-office sign-in.

## 4. Procedures

# Part 1: Two identity systems

### 4.1 The employee file and the user

Greenway's system keeps **two separate records** for people, and the owner decided they stay separate (books-87, `0210_separate_logins_from_employees.sql` L4–12): *"I would rather users be people who have access to the system, and be separate from employees. I want to create the employee in payroll/ W-4 setup, then I will give them access to the back office if they need access to it."*

| | **Employee file** | **User** |
|---|---|---|
| What it is | A person who works here | A person who can sign into the back office |
| Where | Employees → **Employees** (`/admin/staffing/employees`) | Admin → **Users** (`/admin/users`) |
| Created by | **Add to roster** (owner, admin, manager); also Payroll Setup in Accounting | **Send invite** (owner, admin) |
| Proves who you are with | A **4–6 digit PIN** | Email and password (or a passkey) |
| Used for | Clocking in, unlocking a register, register approvals (manager or lead PIN), samples hub, the five-year employee record | Every back-office page the role allows |
| Ends with | **Terminate** (status Terminated, PIN cleared) | **Deactivate** (access cut off, sign-in banned) |

**How they link.** An employee file has a `staff_id` field that can point to a user. **No screen sets it** (F-08-2). Only files that were copied from users by the original 2023 set-up (migration 0037 L125–132) have one. Those show a **login** badge on the roster (`employees/page.tsx` L230). For everyone added since, the two records are unconnected, so:

- the register's handbook check uses only the **paper** route for them (§4.10);
- terminating them does not touch their sign-in, and deactivating their sign-in does not touch their PIN (§4.21).

### 4.2 Where everything lives

| Task | Where | Who |
|---|---|---|
| Roster, add a person, health cards, AI HR helper | Employees → **Employees** | Owner, admin, manager |
| One person's file: status, checklist, documents, training, basics (name, job role, PIN, SAW username), hire info, deadlines, sick leave, terminate | Click the person on the roster | Owner, admin, manager |
| Schedule | Employees → **Schedule** | Owner, admin, manager |
| Handbook (read, print) | Employees → **Handbook & Policies** | Owner, admin, manager |
| Time clock (station PIN pad), phone clock | Employees → **Time Clock** (`/admin/staffing`), `/admin/staffing/clock` | Anyone with `timeclock.use` |
| Hours (fix a missed punch) | Employees → Time Clock → **Hours** | Owner, admin, manager |
| Sign-ins, roles, deactivate, access-change log | Admin → **Users** | Owner, admin |
| Pay, W-4, direct deposit, Payroll Setup (W-4) | Accounting (D69, skipped) | Owner |

### 4.3 Employment statuses

| Status | Meaning | Can clock in / unlock a register? | Moves to |
|---|---|---|---|
| **Candidate** | On the books, not hired yet | No (not active) | Onboarding, Terminated |
| **Onboarding** | Hired, doing paperwork and training | No (not active) | Active (only when required steps are done), Terminated |
| **Active** | Cleared to work | **Yes, if a PIN is set** | Terminated only |
| **Terminated** | Gone; file kept five years | No (PIN cleared) | Onboarding (rehire) |

Source: `employee-lifecycle-core.ts` L22–36, L441–451; `employee-lifecycle-store.ts` L516–539. Only **Active** sets the file's active flag to true, and the PIN lookup only searches active files (`store.ts` L117–124).

> **Every new person starts as Candidate** (Phase 0.3, G-52; F-08-1 FIXED). Add a person and Payroll Setup both create a Candidate with `active = false` and no PIN. The owner or an admin presses **Start onboarding** (Candidate → Onboarding) and later **Activate employee**, which unlocks only when the required steps are done.

### 4.4 Which people need which

| Person | Employee file | PIN | Back-office user | Role |
|---|---|---|---|---|
| Budtender | Yes | Yes | **Yes** (the phone clock page and Cycle Counts need a sign-in: `clock/page.tsx` L35; SOP-06 D50–D51) | Budtender / Staff |
| Lead | Yes, job role **lead** | Yes | Yes | Budtender / Staff |
| Manager | Yes, job role **manager** | Yes | Yes | Manager |
| Admin | Yes | Yes | Yes | Admin |
| Bookkeeper, outside accountant, consultant | **No** (books-87) | No | Yes, if needed | Read-only / Analyst (or as the owner decides) |
| Vendor rep, contractor, inspector | No | No | No | Visitor log and visitor badge (§4.19) |

**Every employee gets a back-office sign-in** (owner decision D73: *"yes, everyone will get back office access."*), at the lowest role that does the job.

# Part 2: Onboarding (in the legal order)

The employee file's **Onboarding checklist** has 16 steps in four phases (`employee-lifecycle-core.ts` L46–51, L66–185). The steps marked **required** in the app (critical) are the ones that would block **Activate**: age 21, I-9 Section 1, I-9 Section 2, W-4, handbook, both trainings and the badge (L93–155). Work them **top to bottom**. The app enforces two orders: the background check only after the conditional offer, and I-9 Section 2 only after Section 1 (L85, L108, L407–416).

### 4.5 Before the offer: interview without asking about records

1. Interview and decide whether the person is otherwise qualified. **Do not ask about criminal history** at this stage. The app's step 1 says: *"Assess skills and fit FIRST. Do not ask about criminal history at this stage (RCW 49.94.010)."* (L70).
2. If you will hire, give a **written conditional offer** and keep a copy.

### 4.6 Adding the person (no PIN)

1. Employees → **Employees** → **Add a person**. The card says new hires start as a **Candidate** with no clock PIN (`employees/page.tsx` L189–191).
2. **Full name**: their full legal name, as on their ID (the badge needs it, WAC 314-55-083(1)).
3. **Job role**: **sales** for a budtender, **lead**, **manager** or **other** (`employees/page.tsx` L23). The job role decides who may approve register actions (§4.16).
4. **Status** shows *"Candidate (no PIN yet)"*. There is no PIN field here any more (`employees/page.tsx` L205–207): the app refuses a PIN on this form (*"New hires start as a Candidate. Set their clock PIN on their file after they are Activated."*, `staffing/actions.ts` L132).
5. Press **Add to roster**. The roster shows *"Saved."* and the person appears with the badge **Candidate**.
6. Open their file (click the name) and write today's date on **form 8.1**, line "File created". The **owner or an admin** presses **Start onboarding** (`[id]/page.tsx` L223); a manager sees *"owner or admin only"* instead.

### 4.7 Hiring steps: offer, background check, age 21

In the file's **Onboarding checklist**, phase **1 · Hiring (in this order)**:

1. **Interviewed — candidate is otherwise qualified**: check it.
2. **Conditional offer extended (in writing)**: check it. In the **Document tracker**, set **Conditional offer letter** to **On file** with the date (§4.10 explains the tracker).
3. **Background check completed**: only after the offer. The app refuses it before: *"Complete "Conditional offer extended (in writing)" first — the order is required (see the step's helper text)."* (L415). The step says: *"No blanket exclusions — consider the record individually. (From Jan 1, 2027, small employers must also document a legitimate business reason and hold the job 2 business days before adverse action.)"* (L83). Set **Background check report** to **On file**.
4. **Photo ID checked — employee is 21 or older** (required): look at their state ID yourself. The app records that you checked, **not** the birth date (L91; migration 0117 L52–54). Under 21: **stop**. RCW 69.50.357(2) forbids employing them. Tell the owner.

### 4.8 Paperwork: I-9, W-4, DSHS new-hire report

Phase **2 · New-hire paperwork**:

1. **Form I-9 Section 1 completed by the employee** (required): *"Due by the employee's FIRST day of work for pay. The employee fills out Section 1 themselves."* (L98).
2. **Form I-9 Section 2 completed by you** (required): *"You examine the employee's original documents and complete Section 2 within 3 BUSINESS days of the start date. Retain the I-9 for 3 years after hire or 1 year after separation, whichever is later."* (L106). The file's **Deadlines from the hire date** card shows the due date once the hire date is saved (§4.9; L350–371).
3. **Form W-4 collected** (required). File the paper W-4 with the employee records. **Entering withholding is the owner's, in Accounting → Payroll Setup (W-4)** (D69).
4. **New hire reported to DSHS**: *"within 20 days of hire"* (L123). The deadline card shows the date.
5. In the **Document tracker**, set **Form I-9** and **Form W-4** to **On file** with the date received.

> **Store originals safely.** The app tracks *whether* a document is on file. It does not store the I-9 or W-4 itself. Keep the paper in the locked employee-records file for five years (WAC 314-55-087(1)(e)); for the I-9, keep it for the longer of three years from hire or one year after separation.

### 4.9 Hire info: hire date, badge number, 21+ box

In the right rail, **Hire info**:

1. **Hire date (first day of work)**: the hire date is a required five-year record (WAC 314-55-087(1)(e); migration 0117 L31–33).
2. **Badge number**: the number on the badge you issue (§4.12).
3. Check **age 21 verified** if you have not already. Saving with the box checked also checks the checklist step (`[id]/actions.ts` L164–172).
4. Press **Save**. The page shows *"Hire info saved."*

### 4.10 The handbook: checklist box, document row and the gates

The handbook is read and acknowledged **before the first shift**. There are two ways to acknowledge it, and the register and the back office check them differently:

| Gate | Where it applies | What satisfies it | Source |
|---|---|---|---|
| **Back-office gate** | Every back-office page, for every role except Owner | The person's **sign-in** acknowledged the **current** version (2.0) on the handbook screen | `admin/layout.tsx` L67–83; `handbook-ack-core.ts` L42–55 |
| **Register gate** | Register unlock by PIN | The **Document tracker** row **Employee handbook acknowledgment** is **Read & signed**, **or** a linked sign-in acknowledged the current version, **or** a linked Owner | `api/pos/unlock/route.ts` L79–96; `handbook-ack-store.ts` L99–155; `handbook-ack-core.ts` L62–77 |

Because new files are not linked to a sign-in (§4.1), **the register only accepts the paper route** for them. So, for every new hire:

1. Give them the printed handbook (Employees → **Handbook & Policies** → print). They read it and sign the acknowledgment page.
2. If they have a sign-in, the first time they sign in they see the handbook screen and type their full name to acknowledge it (`HandbookGateScreen.tsx` L62). That satisfies the **back-office** gate only.
3. In the file: check **Employee read and signed the handbook** (required).
4. **And** in the **Document tracker**, open **Employee handbook acknowledgment**, set **Status** to **Read & signed**, enter **Signed on**, press **Save**. Checking the box in step 3 does **not** do this (F-08-4). Without this row the register says: *"Handbook acknowledgment required before using the register. Read the employee handbook in the back office and check the acknowledgment box (or have a manager mark your signed paper copy in your employee file)."* (`handbook-ack-core.ts` L74–75).
5. File the signed page with the employee records.

The roster's **Missing critical docs** card counts I-9, W-4 and the handbook from the **Document tracker**, and the handbook must be **Read & signed** (`employee-lifecycle-store.ts` L235, L288–298). If the card shows the new hire, a tracker row was missed.

### 4.11 Training and the training log

Phase **3 · Cannabis compliance**. RCW 69.50.357(3) requires training for **all** employees.

1. Train them on **store rules and LCB requirements** and on **checking ID and spotting under-21 customers**. Use SOP-01 (register) and SOP-19 (customers, ID, limits) when written.
2. In the **Training log**, add one line per topic. The **Topic** field suggests the required topics (`employee-lifecycle-core.ts` L311–318). Fill in **Date** and **Trainer**, then press **Add**. The page shows *"Training logged (kept 5 years)."*
3. Only then check **Trained on store rules & LCB requirements** and **Trained on checking ID / spotting under-21 customers** (both required). The app does **not** check that a log line exists (F-08-5). The rule is: **no log line, no checkmark**.
4. **Medical endorsement only:** training on authorizations and recognition cards (RCW 69.50.357(3)(b)), and the DOH consultant certificate tracked with its expiry date in the Document tracker (L291–296).

### 4.12 The photo ID badge

WAC 314-55-083(1) requires a store-issued badge showing the **trade name** (Greenway Marijuana), the person's **full legal name** and their **photograph**, worn **at all times** on the premises. The person must also have their **state ID** available so the badge can be checked against it.

1. Take the photo. Print the badge with the trade name, full legal name and photo, and a badge number.
2. Enter the **Badge number** in Hire info (§4.9). In the Document tracker, set **ID badge record** to **On file**.
3. Check **Photo ID badge issued** (required).
4. Write the badge number on form 8.1 and in the **badge register** (form 8.2).

The app records the number only. It does not print badges (Appendix B, G-57).

### 4.13 Ready to work: PIN, schedule, payroll pointer

Phase **4 · Ready to work**. Do this only when **every required step in phases 1–3 is checked** and the Document tracker shows I-9, W-4 and handbook correctly.

1. The person running onboarding and the new hire sign **form 8.1**.
2. The **owner or an admin** presses **Activate employee** (it unlocks only when the required steps are done, `[id]/page.tsx` L228–235; the server re-checks, `employee-lifecycle-store.ts` L500–515). Then **Basics → New clock PIN**: let the new hire type a 4–6 digit PIN that **nobody else knows** (§4.15). Before Activate the field says *"locked until Active"* (`[id]/page.tsx` L581). Press **Save basics**. The roster now shows **PIN set**. Check **Time-clock PIN set**.
3. **Added to the schedule**: build their first week in Employees → **Schedule**, then check the step.
4. **Payroll set up** and **Direct deposit offered (or paper check chosen)**: give the paper W-4 and any direct-deposit form to the **owner** (Accounting, D69). Check these steps only when the owner confirms. Direct deposit never blocks starting work; it is the employee's choice (L175–184).
5. Ask the new hire to unlock a register with their PIN while you watch. If they get the handbook message, recheck §4.10 step 4.

> **Built in Phase 0.3 (G-52).** A PIN typed for someone who is not Active is refused: *"A clock PIN can only be set once this person is Active. An owner or admin activates them after the required steps (21+, background check, training) are done."* (`candidate-start-core.ts`).

### 4.14 The back-office sign-in (Users), when needed

Owner or admin only (`users.manage`):

1. Admin → **Users** → **Invite a staff member**. Type their email and choose the role (§4.16). The list only offers roles at or below yours (`users/page.tsx` L137).
2. Press **Send invite**. The page shows *"Invite sent to {email} as {role}. They'll get an email to set a password."* (`users/actions.ts` L249). They set a password of at least 8 characters (`set-password-core.ts` L99).
3. The first time they sign in, they acknowledge the handbook (§4.10 step 2).
4. Write the role and invite date on form 8.1.

The sign-in is **not** linked to the employee file (§4.1). That is the owner's design. Whether a link should be added for the gates and offboarding is **open question Q-08-1** (G-53).

# Part 3: System management while employed

### 4.15 PINs: rules, changing, removing, lockout

- **What a PIN does.** It identifies a person at the time clock, at register unlock, and for register approvals (a **manager or lead** PIN approves safe swaps and similar actions: `api/pos/till/route.ts` L55, L193–207).
- **Format.** 4–6 digits (`staffing/actions.ts` L124). Two people cannot share a PIN: *"That PIN is already in use."* (L129, L169).
- **Secrecy.** PINs are stored as salted hashes and never shown again (`store.ts` L21–24; `pin-hash.ts`). The field is write-only: blank keeps the current PIN (`staffing/actions.ts` L161–163). **Never write a PIN down, never share it, never let someone else type yours.**
- **Changing.** In the employee file, open **Basics**, type the new PIN in **New clock PIN**, and press **Save basics**. Change it at once if anyone else may know it.
- **Removing.** In **Basics**, check **Remove their PIN (they can't clock in until you set a new one)** (`[id]/page.tsx` L569–571).
- **Lockout.** Five wrong PINs within 60 seconds lock that PIN pad for 60 seconds (`pin-throttle-core.ts` L29–31). The message is *"Too many wrong PINs — the PIN pad is locked for N more seconds."* (L77). Wait it out. If it keeps happening, someone is guessing: tell the owner.
- **Only Active people's PINs work.** *"No active employee for that PIN."* (`staffing/actions.ts` L65) means a wrong PIN, no PIN, or a person who is not Active.

### 4.16 Roles: back-office role and job role

There are **two** role settings and they are independent:

| Setting | Where | Values | Controls |
|---|---|---|---|
| **Back-office role** | Users | Owner, Admin, Manager, Content Editor, Budtender / Staff, Read-only / Analyst (`roles.ts` L5–10) | Which back-office pages and actions the sign-in can use (the permission matrix in `roles.ts`) |
| **Job role** | Employee file → Basics | sales, lead, manager, other | Register approvals (manager or lead PIN), the shift role recorded on punches (`store.ts` L276) |

Give the **lowest** role that does the job. Typical: budtender = Budtender / Staff + sales; lead = Budtender / Staff + lead; manager = Manager + manager. The role descriptions on the Users page are short summaries: for example, Budtender / Staff also has the time clock and Cycle Counts, which its description does not mention (F-08-9).

### 4.17 Changing a role or job role

1. **Back-office role** (owner or admin): Users → the person's row → choose the role and save. The guards block self-changes, changes to someone ranked above you, grants above your rank and demoting the last owner (`user-guards-core.ts` L52–82). Every change, including **blocked** attempts, is listed under **Recent access changes** (`users/page.tsx` L270–285).
2. **Job role** (owner, admin, manager): Employee file → Basics → **Job role** → **Save basics**. The audit records *employee.updated* **without** the old and new values (`staffing/actions.ts` L193–199; F-08-10). Write the change on **form 8.4**.
3. A promotion to **lead** or **manager** gives register approval powers. The owner approves it first (form 8.4).

### 4.18 The handbook gate and new handbook versions

When the handbook version changes (`HANDBOOK_VERSION`, now 2.0), every non-owner sign-in sees the handbook screen again before any back-office page. At the register, the **paper** route (Document tracker = Read & signed) has **no version**, so it keeps passing after a new version (`handbook-ack-store.ts` L107–118; F-08-4). When the version changes:

1. Print the new handbook. Every employee reads it and signs a new acknowledgment page.
2. Update each person's **Employee handbook acknowledgment** row (**Signed on** = the new date, **Notes** = "v{new version}").
3. Keep the old signed pages; they are part of the five-year file.

### 4.19 Visitors and non-employees on the premises

WAC 314-55-083(1)(a)–(c): every **non-employee visitor** (other than retail customers), such as vendor reps, contractors, delivery drivers inside the back area or IT techs, must **hold and display a store visitor badge**. A **log** records full name, badge number, time of arrival, time of departure and purpose, and is kept on the premises **three years**. **The app has no visitor log** (F-08-8). Use **form 8.5** at the back door, and keep numbered visitor badges at the counter. Employees, visitors and anyone else must show ID to an LCB officer on request (083(1)(d)).

# Part 4: Offboarding and rehire

### 4.20 Before the last day

1. Agree the last day. If the person resigned, keep their notice (email or letter) with the file.
2. Owner: plan the final paycheck. *"RCW 49.48.010: final wages are due at the END of the established pay period — pay them with the normal payroll run, don't skip them."* (`employee-lifecycle-core.ts` L229). Pay and sick leave are Accounting (D69).
3. If they hold a register drawer, the safe or keys, plan the hand-back with SOP-02.

### 4.21 Terminating: both halves, same day

**Half 1: the employee file** (owner, admin or manager):

1. Open the file → **Terminate employment** (right rail, `[id]/page.tsx` L656–680).
2. **Last day** (required) and **Reason (kept on file)** (required). Write facts, for example *"Resigned with two weeks' notice"*.
3. Press **Terminate**. The app sets the status to Terminated, makes the file inactive and **clears the PIN at once** (`employee-lifecycle-store.ts` L517–527). The page shows: *"Employee terminated. PIN cleared. Work the offboarding checklist below — and deactivate any back-office login on Admin → Users."* (`[id]/actions.ts` L225–226).

**Half 2: the sign-in** (owner or admin, **the same day**):

4. Admin → **Users** → their row → **Deactivate**. Their access ends on their very next request, and the sign-in is banned at the sign-in service (`users/actions.ts` L143–153; the session check refuses inactive profiles, `session.ts` L169). The message is *"{email} deactivated — access is cut off and sign-in is banned. If you're letting them go, run the offboarding checklist on their employee file too."* (L176). If it says *"…the auth ban failed; check Supabase Auth."* (L177), the back office is still locked for them. Tell the owner the same day.
5. A **manager** who did Half 1 calls or texts the owner or an admin to do Half 2, and writes who and when on form 8.3.

**For immediate dismissals,** do Half 2 **first**, then Half 1, before telling the person.

### 4.22 The offboarding checklist

After Terminate, the file shows the **Offboarding checklist** (seven steps, `employee-lifecycle-core.ts` L200–236). Work every step and check it:

| Step (as on screen) | What to do | App helps? |
|---|---|---|
| **Termination date + reason recorded** | Done by Terminate | Yes |
| **ID badge retrieved or voided** | Collect the badge; mark it returned or void on form 8.2 | No |
| **Time-clock PIN cleared & open punch closed** | The PIN is already cleared. Open Time Clock → **Hours** for their last day; if a punch is still open, close it with the real time and a reason (SOP-02 / Hours) | PIN yes; punch **no** (F-08-3) |
| **Back-office login deactivated (Users page)** | §4.21 Half 2 | **No** (F-08-3) |
| **Removed from future schedules** | Employees → **Schedule**: delete every shift after the last day | **No** (F-08-3) |
| **Final paycheck scheduled** | Owner confirms (Accounting) | Pointer only |
| **Employee file retained (do NOT delete)** | Nothing to delete; the app has no delete | Yes |

Also collect keys, the drawer and anything else issued, and remove them from any group chat or shared account (form 8.3).

### 4.23 Records: never delete

The app never deletes an employee. Terminated people move to **Former employees** on the roster (`employees/page.tsx` L245–248), and their checklist, documents, training log, punches and termination record stay. Keep the paper file (I-9, W-4, signed handbook pages, training sign-offs, forms 8.1–8.4) for **five years** on the premises (WAC 314-55-087(1)(e)), and the I-9 for the longer of three years from hire or one year after separation.

### 4.24 Rehiring a former employee

1. Open the file → **Rehire (restart onboarding)** (`[id]/page.tsx` L232–240). The status becomes **Onboarding** and the file stays inactive until **Activate employee**.
2. **Before pressing Rehire**, print or photograph the file's status card with the old **termination date and reason**. Rehire **erases them** from the file (`employee-lifecycle-store.ts` L535–538). Only the audit log keeps them (F-08-6).
3. The old checklist checkmarks **stay checked** (Rehire does not reset them, F-08-6). Uncheck every onboarding step, then work Part 2 again with a new form 8.1: new I-9 rules apply, along with the handbook, training, badge and a new PIN.
4. Press **Activate employee** when the button unlocks. Here the app's gate does work, because the file is in Onboarding.
5. If their sign-in was deactivated, an owner or admin reactivates it on Users.

## 5. Messages: "If you see this message"

| Message | Meaning | What to do |
|---|---|---|
| *"Saved."* (roster) | The person was added **as a Candidate** | Owner or admin presses Start onboarding; continue at §4.7 |
| *"New hires start as a Candidate. Set their clock PIN on their file after they are Activated."* | A PIN was sent with Add a person | Add them without a PIN |
| *"A clock PIN can only be set once this person is Active. …"* | PIN typed before Activate | Finish the steps; owner or admin activates; then set the PIN |
| *"Name is required."* | Full name was blank | Type the full legal name |
| *"PIN must be 4–6 digits."* | Wrong PIN format | Use 4–6 digits |
| *"That PIN is already in use."* | Someone else has that PIN | Choose another; if the new hire guessed someone's PIN, that person changes theirs |
| *"Complete "…" first — the order is required (see the step's helper text)."* | A required earlier step is not checked | Do the earlier step first |
| *"Finish the required compliance steps first: …."* | Activate pressed with required steps open | Finish the listed steps |
| *"Can't move from {status} to {status}."* | Not an allowed change (for example Active → Onboarding) | See §4.3; for a new hire created Active, follow §4.6 |
| *"Enter the termination date."* / *"Enter the termination reason (kept 5 years with the file)."* | Terminate form incomplete | Fill both |
| *"Enter the hire date as a calendar date."* | Bad date | Pick a date |
| *"Enter the training topic."* / *"Enter the training date."* | Training form incomplete | Fill it |
| *"Apply migration 0117 first (see the banner above)."* | Database update missing | Owner |
| *"Onboarding started — work through the checklist below."* | Status is Onboarding (rehire) | §4.24 |
| *"Employee is ACTIVE — welcome aboard!"* | Activated | Set the PIN (§4.13) |
| *"Employee terminated. PIN cleared. …"* | Half 1 done | Do Half 2 the same day (§4.21) |
| *"No active employee for that PIN."* | Wrong PIN, no PIN, or not Active | Retry once; then a manager checks the file |
| *"Too many wrong PINs — the PIN pad is locked for N more seconds."* | Five wrong PINs in a minute | Wait; report repeats to the owner |
| *"Handbook acknowledgment required before using the register. …"* | Register gate: no **Read & signed** row and no linked acknowledgment | §4.10 step 4 |
| Handbook screen instead of the back office | Back-office gate: this sign-in has not acknowledged the current version | Read and acknowledge it (§4.10 step 2) |
| *"Invite sent to … They'll get an email to set a password."* | Invite sent | §4.14 step 3 |
| *"Only someone who is already … can grant the … role."* | You tried to grant a role above yours | Ask someone with that rank |
| *"You can't change your own role — ask another owner or admin to do it."* / *"You can't deactivate yourself — …"* | Self-change blocked | Another owner or admin does it |
| *"That's the last active owner — …"* | Last-owner protection | Promote another owner first |
| *"{email} deactivated — access is cut off and sign-in is banned. …"* | Half 2 done | Finish the offboarding checklist |
| *"…but the auth ban failed; check Supabase Auth."* | The back office is locked but the ban did not apply | Owner checks the sign-in service |

## 6. Exceptions & escalation

| Situation | Do this |
|---|---|
| A PIN was typed when adding the person (before the checklist) | At once: Basics → **Remove their PIN** → **Save basics**. Note it on form 8.1 |
| The new hire is under 21 | Stop. Do not employ (RCW 69.50.357(2)). Owner |
| Background check raises a concern | Owner only; consider the record individually; follow the timing in the step's help (§4.7) |
| Someone worked a shift before the checklist was done | Owner the same day; finish the missing steps; write it on form 8.1 |
| Someone's PIN may be known to others | Change it now (§4.15) |
| Someone must leave now and no owner or admin is on site | The manager sends them home and calls or texts the owner or an admin with the time. The manager does **not** press Terminate (D74); the owner or admin terminates and deactivates remotely the same day |
| Dismissal for theft or diversion | Half 2 first, then Half 1; collect badge and keys before they leave; owner handles LCB reporting (SOP-20) |
| Repeated *"Too many wrong PINs"* | Owner; check which device in the audit log |
| A sign-in exists for someone who never worked here | Owner or admin deactivates it; do not create an employee file for them (books-87) |
| Unexpected **blocked** entries under Recent access changes | Owner the same day: someone is trying access they do not have |

## 7. Controls & compliance (why the rules exist)

| Control | Why | Source |
|---|---|---|
| No PIN until Active | A PIN is the key to the clock and the register; new hires start as Candidate and the PIN is locked until Activate (Phase 0.3, G-52) | `staffing/actions.ts` L119–178; `candidate-start-core.ts` |
| Only owner or admin activates, terminates or rehires | Owner decision D74 | `roles.ts` L265; `[id]/actions.ts` L192 |
| 21+ check by the manager, with the ID in hand | No employees under 21; $1,000 per violation per the app's step text | RCW 69.50.357(2); `employee-lifecycle-core.ts` L91 |
| Offer before background check | WA Fair Chance Act, as stated in the app | `employee-lifecycle-core.ts` L74–87 |
| Training logged with date and trainer | All employees trained on rules and under-21 ID; training records kept five years | RCW 69.50.357(3); WAC 314-55-087(1)(e) |
| Badge with trade name, legal name and photo, always worn | State rule | WAC 314-55-083(1) |
| Visitor badge and log, kept three years | State rule | WAC 314-55-083(1)(a)–(c) |
| Hire date, termination record, files kept five years, never deleted | Employee records rule | WAC 314-55-087(1)(e); `employee-lifecycle-store.ts` L16–17 |
| Handbook signed before first shift; both gates | Owner directive; the register gate enforces it | `handbook-ack-core.ts`; `api/pos/unlock/route.ts` L79–96 |
| Both halves of offboarding the same day | The two identity systems are not linked (F-08-2, F-08-3) | §4.1 |
| Lowest role; nobody changes their own access | Least privilege; the guards | `user-guards-core.ts` |
| PINs secret, hashed, throttled | A PIN proves presence | `pin-hash.ts`; `pin-throttle-core.ts` |

**What the app already does well (confirmed in this audit, F-08-C):** the role guard rails (self, rank, ceiling, last owner) for changes and invites; deactivation that both locks the back office on the next request and bans the sign-in; every access change, including blocked attempts, audited and shown on Users; PINs hashed and throttled, with duplicates refused; the PIN lookup ignores inactive people; Terminate clears the PIN at once and never deletes; the Fair Chance and I-9 ordering enforced; the register needing **both** a provisioned device and a PIN, plus the handbook gate; and the back-office handbook gate with the owner exempt.

## 8. Checklists & forms

Print these. File the completed forms in the employee's paper file (five years).

### 8.1 Onboarding sign-off (one per hire or rehire)

| Line | Entry | Initials / date |
|---|---|---|
| Employee full legal name | | |
| File created (no PIN entered) | Date: | |
| Interview done; no criminal-history questions before offer | | |
| Written conditional offer (copy filed) | Date: | |
| Background check after offer | Date: | |
| State ID checked; 21 or older | ID type (no number): | |
| I-9 Section 1 (by first paid day) | Date: | |
| I-9 Section 2 (within 3 business days) | Date: | |
| W-4 collected → given to owner | Date: | |
| DSHS new-hire report (within 20 days) | Date: | |
| Hire date saved in Hire info | Date: | |
| Handbook v___ read and signed → **Document tracker set to Read & signed** | Date: | |
| Training: store rules and LCB (log line added) | Date / trainer: | |
| Training: ID and under-21 (log line added) | Date / trainer: | |
| Medical store only: authorizations/cards; DOH certificate and expiry | | |
| Badge issued (trade name, legal name, photo) | Badge #: | |
| **All the above complete → PIN set by the employee** | Date: | |
| First week scheduled | | |
| Payroll and direct deposit handed to owner | Date: | |
| Back-office sign-in (if any): role ___ invited by ___ | Date: | |
| Test: register unlock with PIN worked | | |
| Signed: person running onboarding ________ · employee ________ | | |

### 8.2 Badge register (one line per badge, employees and visitors kept separately)

| Badge # | Name (full legal) | Issued (date, by) | Photo on badge (Y) | Returned / voided (date, by) |
|---|---|---|---|---|
| | | | | |

### 8.3 Offboarding record (one per departure)

| Line | Entry | Initials / date |
|---|---|---|
| Employee full legal name; last day | | |
| Reason (facts) | | |
| Half 1: Terminate pressed (PIN cleared) | By / time: | |
| Half 2: sign-in deactivated on Users (or "none") | By / time: | |
| If Half 1 was a manager: owner/admin told | Who / time: | |
| Open punch checked on Hours (closed if open) | | |
| Future shifts deleted | | |
| Badge returned or voided (form 8.2) | | |
| Keys, drawer, safe access, uniforms returned | | |
| Group chats and shared accounts removed | | |
| Final pay with normal payroll (owner) | | |
| Paper file kept (5 years); I-9 kept to the later date | | |

### 8.4 Role and job-role change log (owner approves promotions)

| Date | Person | Change (from → to; back-office role or job role) | Reason | Approved by owner | Done by |
|---|---|---|---|---|---|
| | | | | | |

### 8.5 Visitor log (WAC 314-55-083(1)(b); keep three years on premises)

| Date | Full name | Company / purpose of visit | Visitor badge # | Time in | Time out | Escorted by |
|---|---|---|---|---|---|---|
| | | | | | | |

### 8.6 Quarterly access review (owner, first week of each quarter)

| Check | Result | Initials |
|---|---|---|
| Every **active** user on Users is a current employee or an approved non-employee | | |
| Every **Active** employee has a badge number, hire date, I-9, W-4 and handbook Read & signed (roster cards show none missing) | | |
| No Terminated employee still has an active sign-in | | |
| Roles are the lowest that fit (form 8.4 matches) | | |
| Job roles **manager** and **lead** match who may approve at the register | | |
| Recent access changes reviewed, no unexplained **blocked** entries | | |
| Visitor log complete and filed | | |

## 9. Quick reference cards

### 9.1 Card: new hire (manager)

1. Interview, no criminal-history questions. Then a written offer.
2. **Add a person**: full legal name and job role (they start as Candidate, no PIN). Owner or admin presses **Start onboarding**.
3. Checklist in order: offer → background check → **21+ ID check**.
4. I-9 Section 1 (day 1), Section 2 (3 business days), W-4, DSHS report (20 days).
5. Hire info: hire date, badge number. Save.
6. Handbook signed → check the box **and** set the Document tracker to **Read & signed**.
7. Train, **log each topic**, then check both training steps.
8. Badge with trade name, legal name and photo.
9. Form 8.1 signed → owner or admin presses **Activate** → **then** the employee sets their PIN.
10. Schedule. W-4 and direct deposit to the owner. Test the register unlock.

### 9.2 Card: someone is leaving (manager / admin / owner)

1. File → **Terminate**: last day and reason. (The PIN is cleared.)
2. **Same day:** owner or admin → Users → **Deactivate**.
3. Offboarding checklist: badge, open punch (Hours), future shifts (Schedule), final pay (owner), keep the file.
4. Form 8.3 complete.
5. Dismissal for cause: deactivate first, then terminate.

### 9.3 Card: PINs (everyone)

- 4–6 digits, yours only, never shared, never written down.
- Five wrong tries lock the pad for 60 seconds.
- Think someone knows it? A manager changes it now.
- *"No active employee for that PIN"*: try once more, then get a manager.

## 10. Glossary

| Term | Meaning |
|---|---|
| **Employee file** | The record of a person who works here (`employees` table): status, checklist, documents, training, PIN, job role |
| **User** | A back-office sign-in (`staff_profiles`), with a back-office role |
| **Link (`staff_id`)** | The field that would connect an employee file to a user; not settable in the app today |
| **PIN** | 4–6 digit code that identifies an employee at the clock and the register |
| **Back-office role** | Owner, Admin, Manager, Content Editor, Budtender / Staff, Read-only / Analyst |
| **Job role** | sales, lead, manager, other: register approvals and shift role |
| **Activate gate** | The rule that Activate needs every required onboarding step; runs only from Onboarding |
| **Document tracker** | Per-document status: Missing, On file, Read & signed |
| **Handbook gate** | Back office: the sign-in acknowledged the current version. Register: the Document tracker row is Read & signed (or a linked acknowledgment) |
| **Badge** | Store-issued ID badge with trade name, full legal name and photo (WAC 314-55-083) |
| **Visitor log** | Record of non-employee visitors: name, badge #, times, purpose; three years |
| **Deactivate** | Users action that locks the back office and bans the sign-in |
| **Terminate** | Employee-file action that ends employment, clears the PIN and keeps the file |

## Appendix A: Source map

| Topic | Source (verified at `main@bad718b4`) |
|---|---|
| Roles and permissions | `src/lib/auth/roles.ts` L5–29 (labels, descriptions, ranks), L106, L126, L221, L247–248, L260, L264 |
| Role guards | `src/lib/auth/user-guards-core.ts` L36–115 |
| Users | `src/app/admin/users/actions.ts` L43–98 (role), L100–179 (deactivate, ban), L181–250 (invite); `src/app/admin/users/page.tsx` L88–93 (help), L119–145 (invite), L199–240 (rows), L251–268 (both halves), L270–285 (access log) |
| Session check | `src/lib/auth/session.ts` L118–171 |
| Password | `src/lib/auth/set-password-core.ts` L99–110 |
| Checklists, documents, deadlines, transitions | `src/lib/staffing/employee-lifecycle-core.ts` L22–36, L46–185, L200–236, L258–318, L350–371, L407–451 |
| Lifecycle store | `src/lib/staffing/employee-lifecycle-store.ts` L16–17, L127–139, L235, L288–298, L365–409, L412–440, L443–467, L476–548 |
| Employee file actions | `src/app/admin/staffing/employees/[id]/actions.ts` L41–66, L72–104, L110–134, L140–184, L190–229 |
| Employee file page | `src/app/admin/staffing/employees/[id]/page.tsx` L213–253 (status buttons), L285–352 (checklist), L354–396 (offboarding), L400–470 (documents), L472–520 (training), L525–590 (basics, PIN), L593–620 (hire info), L656–680 (terminate) |
| Roster | `src/app/admin/staffing/employees/page.tsx` L23, L88–105 (help), L119–131 (banners), L185–211 (add), L216–248 (list) |
| Roster actions, PIN | `src/app/admin/staffing/actions.ts` L37–110 (clock), L119–151 (create), L153–200 (update) |
| PIN store | `src/lib/staffing/store.ts` L17–39, L117–146, L338–352 |
| PIN hash and throttle | `src/lib/security/pin-hash.ts` L21–40; `src/lib/security/pin-throttle-core.ts` L29–31, L74–92 |
| Handbook gates | `src/lib/staffing/handbook-ack-core.ts` L42–77; `src/lib/staffing/handbook-ack-store.ts` L77–155; `src/app/admin/layout.tsx` L67–83; `src/components/admin/HandbookGateScreen.tsx` L62; `src/lib/staffing/handbook-content.ts` L24 |
| Register unlock and approvals | `src/app/api/pos/unlock/route.ts` L42–110; `src/app/api/pos/till/route.ts` L55, L193–207 |
| Phone clock | `src/app/admin/staffing/clock/page.tsx` L35 |
| Database | `supabase/migrations/0037_staffing_timeclock.sql` L37, L125–132; `0117_employee_command_center.sql` L31–57; `0136_handbook_acknowledgments.sql` L23; `0210_separate_logins_from_employees.sql` L4–80 |
| Pointers only (D69) | Payroll Setup `src/lib/payroll/payroll-onboarding-store.ts` L1046–1130; e-sign `src/app/admin/staffing/employees/[id]/esign/actions.ts` L71–201 |
| State texts (2026-10-28) | RCW 69.50.357 (2), (3)(a)–(b); WAC 314-55-083(1), (1)(a)–(d); WAC 314-55-087(1)(e) (app.leg.wa.gov) |
| Related SOPs | SOP-01 (register), SOP-02 (safe and Hours), SOP-06 (Cycle Counts, every employee), SOP-19 (ID and limits, to be written), SOP-20 (incidents, to be written) |

## Appendix B: Not built yet (interim procedures)

> **Living SOP reminder (D41).** When a gap below is built, update this SOP in the same piece of work: the named sections, the cards, the forms and the concierge ledger.

| Gap | What is missing | Findings | Interim procedure | Sections to update when built | Status |
|---|---|---|---|---|---|
| **G-52** | New people start as **Candidate** (Add to roster and Payroll Setup); the PIN field is locked until **Activate**; Activate runs the gate; the help text matches | F-08-1 (**S1**) | No PIN until form 8.1 is signed (§4.6, §4.13) | One thing to know, §4.3, §4.6, §4.13, §5, §9.1 | **BUILT** (Phase 0.3) |
| **G-53** | An owner-set **link** between a user and an employee file (on Users or the file); never creates an employee (books-87); the register then accepts the digital acknowledgment | F-08-2 | Paper handbook route for everyone (§4.10) | §4.1, §4.10, §4.14, §4.21 | APPROVED (D70) |
| **G-54** | **One-step offboarding**: Terminate offers to deactivate the linked sign-in, deletes future shifts, flags an open punch; Deactivate points to the file | F-08-3 | Both halves by hand, form 8.3 (§4.21–§4.22) | §4.21, §4.22, §9.2 | APPROVED (D71) |
| **G-55** | Checklist ↔ Document tracker kept in step (checking the handbook step sets Read & signed, and so on); Activate also needs the hire date, badge number and a training-log line per required topic; the paper handbook row carries the version | F-08-4, F-08-5 | §4.10 step 4, §4.11 step 3, §4.18 | §4.9–§4.11, §4.18 | PROPOSED |
| **G-56** | **Rehire** keeps the earlier termination (a history of employment periods) and starts a fresh checklist | F-08-6 | Print the status card first; uncheck everything (§4.24) | §4.24 | PROPOSED |
| **G-57** | **Visitor log and badges** in the app (WAC 314-55-083(1)(a)–(c)); badge printing for employees | F-08-8 | Forms 8.2, 8.5 (§4.12, §4.19) | §4.12, §4.19 | DEFERRED (D72: paper for now) |
| **G-59** | **Activate, Terminate and Rehire are owner and admin only** (a new permission, e.g. `staffing.lifecycle`, [owner, admin]); managers keep the rest of the employee file; buttons hidden for managers; server action refuses | (owner decision D74) | §2 rules 1-2 (managers never press them) | §2, §4.13, §4.21, §4.24, card 9.2 | **BUILT** (Phase 0.3) |
| **G-58** | Housekeeping: invite default role the same on screen and server; role descriptions list every permission; job-role changes audited with old and new values | F-08-9, F-08-10 | Form 8.4 (§4.16–§4.17) | §4.16, §4.17 | PROPOSED |

## Appendix C: Open questions for the owner

Each has an interim rule in this SOP until the owner answers.

| # | Question | Why it matters | Interim rule / recommendation |
|---|---|---|---|
| Q-08-1 | **May we add an owner-set link between a user and an employee file?** (G-53) | Today the two records are unconnected | **ANSWERED (D70):** *"yes, built right, professionally and of enterprise grade standards."* G-53 APPROVED. Interim rules stay until it ships |
| Q-08-2 | **Deactivate the sign-in in the same step as Terminate?** (G-54) | A forgotten Half 2 leaves back-office access open | **ANSWERED (D71):** *"yes."* G-54 APPROVED. Until it ships: both halves by hand, same day (form 8.3) |
| Q-08-3 | **Visitor log: paper, or build it in the app?** (G-57) | WAC 314-55-083 requires a visitor log kept three years | **ANSWERED (D72):** *"paper is fine for now."* Form 8.5 is the procedure; G-57 DEFERRED |
| Q-08-4 | **Does every budtender get a back-office sign-in?** | The phone clock, Cycle Counts and the SOP Library need a sign-in | **ANSWERED (D73):** *"yes, everyone will get back office access."* (§4.4) |
| Q-08-5 | **May managers press Activate and Terminate?** The app lets managers do both (`staffing.manage`) | Hiring and firing authority | **ANSWERED (D74):** *"owner admin only. No manager access."* §2 rules 1-2; new **G-59** (owner/admin-only permission for Activate, Terminate, Rehire) |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 | 2026-10-28 | First draft, verified against `main@bad718b4`, after the owner asked for this SOP (D69). State texts read: RCW 69.50.357, WAC 314-55-083, WAC 314-55-087. Findings F-08-1…F-08-10 and F-08-C; gaps G-52…G-58 proposed; questions Q-08-1…Q-08-5. Forms 8.1–8.6, cards 9.1–9.3. Payroll, direct deposit and the Lyman menu are pointers only (D69). No code changed | SOP program |
| 1.2 | Fix phase | Phase 0.3 (owner D76). G-52 BUILT: Add a person and Payroll Setup create a **Candidate** (`active = false`, no PIN); a PIN can be set only once Active (server check); roster PIN field removed. G-59 BUILT: new permission `staffing.lifecycle` (owner, admin) on Start onboarding, Activate, Terminate and Rehire; buttons hidden for managers. Payroll roster still lists candidates and onboarding people (migration 0306). "One thing to know", §2, §4.3, §4.6, §4.13, §5, §7, card 9.1 and Appendix B updated. F-08-1 FIXED. | Fix program |
| 1.1 | 2026-10-28 | Owner answers Q-08-1...Q-08-5 applied (D70-D74): G-53 and G-54 APPROVED; visitor log stays on paper (G-57 DEFERRED); every employee gets a sign-in; Activate, Terminate and Rehire are owner and admin only (§2, §6; new G-59). The SOP Library page (Employee -> SOP Library) now shows every SOP. | SOP program |
