# The four entities, §280E, and how to run them properly

**Written:** books-74. **Status:** research + design. Nothing here posts.

Michael asked for this, verbatim:

> "will you deep research the industry standard best practice. What would a cpa
> with my same structure do? I've never done things per industry standards, I
> just make it up as I go, I understand accounting, but not systems like this
> where one person has intertangle business interests. **They exist solely to
> mitigate 280E, otherwise all three businesses would be under the cannabis
> business.** How should I operate and manage this properly and professionally?"

This document answers that. It is written to be read by Michael and handed to a
CPA. **It is not legal advice and I am not his lawyer** — the conclusions that
carry audit risk are flagged as things to take to counsel, and the reason is
given so he can judge the risk himself rather than take my word.

---

## 0. The one-paragraph answer

His structure is **defensible for the ATM business and the land, and dangerous
if it ever becomes a management company.** The distinction is not the paperwork;
it is *what the employees of each entity actually do.* The Tax Court has
squarely held that a commonly-owned entity which performs the dispensary's
functions is itself "trafficking" under §280E even though it never touches or
owns the marijuana — and that the resulting double tax is the taxpayer's own
fault for choosing that structure. But the same court has never held that a
**landlord** or a genuinely **separate line of business** is trafficking, and
Washington's own licensing rule expressly contemplates a commonly-owned
landlord. So the strategy is: keep the entities *functionally* distinct, price
their dealings at arm's length, document contemporaneously, and never let the
non-cannabis entities employ the people who sell cannabis.

---

## 1. Why §280E bites, and the one door it leaves open

§280E denies deductions and credits for a trade or business "trafficking in
controlled substances." It applies even where the business is fully state-legal;
the courts have rejected every constitutional and statutory attack on that
point. `N. Cal. Small Bus. Assistants v. Commissioner`, 153 T.C. 65 (2019) (not
an excessive fine under the Eighth Amendment); `San Jose Wellness v.
Commissioner`, 156 T.C. 62 (2021) (no depreciation, no charitable deduction).

The door §280E leaves open is that **cost of goods sold is not a deduction at
all.** It is a component of gross income under §§61 and 63 and Reg. §1.61-3(a),
so §280E never reaches it. The Tenth Circuit put it plainly in `Alpenglow
Botanicals v. United States`, 894 F.3d 1187, 1200 (10th Cir. 2018). Congress
preserved COGS deliberately to avoid a Sixteenth Amendment problem — taxing
gross receipts rather than income. S. Rep. No. 97-494, at 309.

**This is the whole game, and it is why the next slice of the books is a costing
slice, not a structure slice.** Every dollar Michael can correctly and
substantiably put in COGS is a dollar taxed; every dollar that lands in
operating expense is taxed at ~100% of itself on top of the tax on the margin.

### 1a. Michael is a reseller, and that is the bad category

This matters more than the entity structure, and it is the point most owners get
wrong. The regulations split inventory costing in two:

- **Reg. §1.471-3(b) — resellers.** Cost is "the invoice price less trade or
  other discounts," plus "transportation or other necessary charges incurred in
  acquiring possession of the goods." **That is the entire list.**
- **Reg. §1.471-3(c) — producers.** Cost includes raw materials, direct labor,
  *and* indirect production costs, including "an appropriate portion of
  management expenses."

A retailer is a reseller. `Patients Mutual Assistance Collective Corp. v.
Commissioner`, 151 T.C. 176 (2018), aff'd 995 F.3d 671 (9th Cir. 2021), held
Harborside — a large dispensary — was a reseller, not a producer. And
`Richmond Patients Group v. Commissioner`, T.C. Memo 2020-52, held that a
dispensary which *inspected, sent for testing, trimmed, dried, maintained,
packaged and labeled* its product was **still a reseller**; those are things
"resellers do without losing their character as resellers." `Patients Mut.` at
213 n.26.

**So the honest position for Greenway is: reseller. Purchase invoice plus
freight-in. Not store labor, not rent, not security, not the POS.**

And §263A does not rescue it. §263A(a)(2) says: "Any cost which (but for this
subsection) could not be taken into account in computing taxable income for any
taxable year shall not be treated as a cost described in this paragraph." A cost
§280E disallows cannot be capitalized into inventory to get in through the back
door. The IRS's Cannabis Industry FAQ (Apr. 25, 2025) states the same position:
compute COGS under §471 and its regulations.

The repo already takes this position correctly — `cogs-position-core.ts`
implements `determineTaxpayerRole` and a `"conservative"` vs `"as_filed"`
election, and `0173_chart_of_accounts.sql` cites CCA 201504011 in the account
comments. **The costing law is already modeled. What is missing is the wiring
that classifies real transactions into it.** That is §6 below.

---

## 2. The case that is actually about Michael's structure

`Alternative Health Care Advocates v. Commissioner`, 151 T.C. No. 13 (Dec. 20,
2018). This is the one he needs to understand, because the facts are close to
the shape he described.

**The facts.** Duncan ran a dispensary, Alternative (a C corporation). He
organized a second entity, Wellness (an S corporation), "to handle daily
operations for Alternative" — hiring the employees and paying the expenses,
including advertising, wages, **and rent**. Wellness performed services solely
for Alternative. Wellness kept its own office. Same owners. Wellness took the
position that it never owned or sold marijuana, so §280E did not reach it and
all its expenses were deductible.

**The holding.** The Tax Court rejected it:

> "Petitioners argue that, as a management services company, Wellness did not
> itself engage in the purchase and sale of marijuana. But the only difference
> between what Alternative did and what Wellness did (since Alternative acted
> only through Wellness) is that Alternative had title to the marijuana and
> Wellness did not. Wellness employees were directly involved in the provision
> of medical marijuana to the patient-members of Alternative's dispensary. While
> Wellness and Alternative were legally separate, Wellness employees were
> engaged in the purchase and sale of marijuana (albeit on behalf of
> Alternative); that was Wellness' primary business. We do not read the term
> 'trafficking' to require Wellness to have had title to the marijuana its
> employees were purchasing and selling."

And on the unfairness of the result:

> "These tax consequences are a direct result of the organizational structure
> petitioners employed, and petitioners have identified no legal basis for
> remedy."

**Why it was worse than doing nothing.** The money Alternative paid Wellness was
income to Wellness. Wellness's offsetting expenses were then disallowed. The
income flowed through to the shareholders' 1040s. So the shareholders picked up
flow-through income with no deduction against it, *and* Alternative still got no
deduction. The structure manufactured a second layer of tax. `Loughman v.
Commissioner`, T.C. Memo 2018-85, is the same lesson in a simpler form: wages
paid by a cannabis S-corp were disallowed to the corporation and still taxable
to the shareholder — taxed twice on one dollar.

### 2a. THE HINGE, and it is good news for Michael

Read the holding again. The court's reasoning turns on one measured fact:
**"Wellness employees were directly involved in the provision of medical
marijuana."** Wellness *was* the dispensary's workforce. That was "its primary
business."

Two consequences follow, and they point in opposite directions:

1. **A management/staffing/payroll entity for the store is the losing fact
   pattern.** If an entity's employees ring the register, stock the shelves, or
   buy the product, that entity is trafficking. Title is irrelevant. Do not
   build this.
2. **Wellness was the tenant, not the landlord.** The opinion lists rent among
   the expenses Wellness *paid*. **The case never decided how a commonly-owned
   lessor is treated,** because no lessor was before the court. So
   `Alternative Health Care` is *not* authority against Michael's landholding
   entity. It is authority against a management company.

I want to be precise about the limit of that second point: it means the case
does not condemn the landlord, **not** that a landlord is blessed. No case I
found holds that a commonly-owned cannabis landlord is trafficking, and the
IRS's published positions do not assert it. But the argument the Service would
make is available — see §4.

---

## 3. When separate entities collapse into one business

Michael's sentence — "**They exist solely to mitigate 280E**" — is the sentence
that creates his exposure, and I am not going to soften it.

The test for whether two activities are one trade or business or two is factual.
`Commissioner v. Groetzinger`, 480 U.S. 23, 35 (1987) supplies the baseline
(continuity, regularity, primary profit purpose). But the cannabis cases add the
part that hurts:

- **Separate entities can still be a single trade or business** if they are part
  of a "unified business enterprise" with a single profit motive.
  `Alternative Health Care`, 151 T.C. at 239; `Patients Mutual`.
- Activities merge when they "share a close and inseparable organizational and
  economic relationship." `Olive v. Commissioner`, 139 T.C. 19, 41 (2012),
  aff'd 792 F.3d 1146 (9th Cir. 2015).
- The factors are "the degree of organizational and economic interrelationship,
  the business purpose which is (or might be) served by carrying on the various
  undertakings separately or together, and the similarity of the various
  undertakings."

Note the middle factor: **the business purpose served by carrying them on
separately.** "To mitigate 280E" is a *tax* purpose, not a business purpose. On
audit, that answer argues the Service's case. Compare:

- **`CHAMP` (Californians Helping to Alleviate Med. Problems), 128 T.C. 173
  (2007) — the one taxpayer win.** Caregiving was a separate deductible
  business. What carried it: marijuana was sold in only ~10% of the space, and
  **the headcount was split — 7 employees on marijuana, 18 on caregiving.**
  Separate people doing separate work.
- **`Olive` — loss.** One fee covered everything, the *same employees* provided
  both, and the extra services carried no separate expense.
- **`Canna Care`, T.C. Memo 2015-206 — loss.** Selling books and T-shirts did
  not create a second business; the court could not determine the percentage.
- **`Patients Mutual` — loss.** Marijuana was >99.5% of revenue; the other
  activities were "neither economically separate nor substantially different."

**The pattern across all four: what wins is separate people, separate space,
separate money, and separate records — and enough revenue in the non-cannabis
line that it is visibly a business rather than a rounding error.** What loses is
shared staff, shared fees, and a percentage nobody can compute.

---

## 4. Grading Michael's three non-cannabis entities

Applying the above to what is actually seeded in `gl_entities` (migration 0172).

### The land — `landholding`, Sch C, NAICS 531100 — STRONGEST

Renting real property is a genuinely different undertaking from retailing: a
different asset, a different revenue mechanic, a different NAICS code, and an
activity that exists in the economy independent of cannabis. `Alternative Health
Care` does not reach it (§2a). Michael's own Sage books already treat it as a
real counterparty rather than a pocket: `70000-GRNWY` RENT as expense against
`52000-LYMAN` RENT as income. That is the right instinct and it should be kept.

**The risk to manage:** if the rent is not arm's length it is not a real lease,
and an above-market rent is the same as a management fee — moving income out of
a 280E entity into a deductible one. That is exactly what §482 exists to undo.
Get a market-rent basis and keep it (§5).

**A second, subtler risk:** the *tenant* side of the rent is still
non-deductible to Greenway under §280E. The lease does not create a deduction;
it creates deductible expenses *at the landlord* (depreciation, property tax,
interest, maintenance) against rental income. The benefit is real but it is
narrower than it looks — it is the landlord's own cost recovery, not a transfer
of Greenway's disallowed costs.

### The ATM — `atm`, Sch C, NAICS 522200 — DEFENSIBLE, with work

An ATM business is a real separate business: it earns surcharge income from
cardholders, it has its own equipment and its own vault cash, and it serves
people who are not necessarily buying cannabis. Its revenue does not depend on
marijuana passing through it. This is closer to `CHAMP` than to `Canna Care`.

**The risks to manage, in order:**
1. **If the ATM sits only inside the store and serves only its customers**, the
   Service will argue `Olive` — an incidental convenience for cannabis
   customers, economically inseparable from the store.
2. **Shared staff is the `Alternative Health Care` trap.** If store employees on
   Greenway's payroll load the ATM, count the cash, or service it, that labor is
   store labor. Whoever does that work should be paid by whoever's business it
   is, and the time should be documented.
3. **Shared cash is the worst of it.** The measured Sage data shows this is
   already live: **121 rows, $61,109.02**, of LYMAN-suffixed expenses paid out of
   GREENWAY cash. Commingled cash is the single most persuasive evidence of one
   "unified business enterprise." This is the thing to fix first operationally.

**What makes it stronger:** its own bank account, its own surcharge revenue
records, a written site/placement agreement with the store and with the
landlord, and — if possible — **at least one machine somewhere else.** A second
location is disproportionately good evidence, because it proves the business is
not a feature of the dispensary.

### Personal — `personal`, 1040 — not a business, and that is the point

Its job is to be the place non-business money goes so it stops contaminating the
business books. Michael has described the personal side as "discombobulated and
poorly accounted for." Cleaning that up is not cosmetic: **every personal item
sitting in a business ledger is a substantiation problem**, and under §280E
Greenway does not even get the deduction it is risking the audit for.

### The line Michael must never cross

**Do not create a management, staffing, payroll, or "administrative services"
entity for the store.** That is `Alternative Health Care` precisely. It is the
one structure that reliably produces a *worse* result than no structure at all,
because it creates taxable income in a second entity whose offsetting deductions
are then disallowed. If any entity's employees sell cannabis, that entity is
trafficking, whatever its name and whatever it owns.

---

## 5. What a CPA with this structure actually does

This is the "industry standard best practice" Michael asked for. Reading across
the cases and the transfer-pricing rules, it comes to six habits.

### (1) Separate everything that can be separated, in fact and not just on paper

One bank account per entity. One card per entity. Never pay entity A's bill out
of entity B's cash — and when it is unavoidable, book it the same day as an
intercompany balance and settle it, don't let it age. Separate books per entity
(the repo does this with a first-class `entity_id`, which is better than Sage's
account-code suffixes). Separate leases. Separate insurance where possible.
Separate employees, always.

The measured $61,109.02 of cross-entity payments is the concrete thing to stop.
Not because the expenses are wrong — utilities and property tax on Geiger Rd
plausibly *are* the landlord's costs — but because paying them from the store's
checking account makes them look like the store's costs, and the store cannot
deduct them anyway.

### (2) Price every intercompany dealing at arm's length, and write down why

§482 lets the IRS reallocate income between commonly-controlled businesses when
the pricing "does not clearly reflect income." Reg. §1.482-1 requires the method
that is most reliable under the facts. Michael has exactly one significant
controlled transaction today — **rent for Geiger Rd** — and possibly a second
(ATM placement).

What the file should contain, per Reg. §1.6662-6(d)(2), scaled sanely to a
business his size:
- a signed written lease with a term, a rate, and who pays what;
- **evidence of market rate**: two or three comparable commercial/industrial
  lease listings or a broker letter for comparable Kitsap County space, dated;
- a functional note: who owns the building, who insures it, who maintains it,
  who bears vacancy risk;
- the arithmetic tying the rate to the comparables, including any adjustment;
- **and it must exist when the return is filed**, not when the auditor asks.

That is the whole difference between "we charge rent" and "we charge market
rent, here is the file." The penalty structure under §6662 rewards the file.

### (3) Make the conduct match the documents

This is where owner-operated groups lose. If the lease says the tenant pays
utilities, the tenant must actually pay them. If the ATM agreement says the ATM
entity services the machine, store staff must not be doing it. An intercompany
agreement contradicted by the general ledger is worse than no agreement, because
it proves the parties knew the right answer and did something else.

### (4) Take the conservative COGS position and substantiate it

Reseller costing: invoice price less discounts, plus freight-in. §6001 and
Reg. §1.6001-1 put the burden on Michael to substantiate every dollar of COGS
claimed; `Alterman v. Commissioner`, T.C. Memo 2018-83, sets out the formula
(beginning inventory + purchases + production costs − ending inventory) and
requires inventory records be "recorded in a legible manner, properly computed
and summarized, and ... preserved." **That is a records requirement, and it is
the requirement this app is being built to satisfy.** The Oct 31 2026 audit
inventory and the Nov 1 upload are the beginning of that record.

### (5) Keep the excise tax out of revenue

The WA cannabis excise tax under RCW 69.50.535 is collected from the buyer and
held in trust. CCA 201531016 treats state excise tax as a reduction in the
amount realized rather than a deduction. Booking it as revenue inflates gross
receipts and then needs a deduction §280E will not give. Migration 0173 already
handles this correctly with a control/trust account, and the comment in the
migration says so.

### (6) Never let the tax purpose be the only purpose

Each non-cannabis entity should be able to answer, in one sentence and without
mentioning taxes, *why it exists as a business*: "it owns the building and rents
it out"; "it operates cash machines and earns surcharge income." Those sentences
are true for Michael's entities today. **The structure's problem is not that the
entities are fake — it is that Michael described their purpose in tax terms.**
The remedy is not a story; it is conduct that makes the business purpose the
obvious answer: separate cash, separate staff, market pricing, real records, and
ideally a customer other than himself.

---

## 6. How this changes what I already told him (D-41)

In books-73 I recommended that money one entity spends on another's behalf be
booked to `36000` Due To / From Related Entity rather than `41100` Shareholder
Contributions, on four grounds, the first being that an intercompany balance is
*reversible* and a capital contribution is not.

**That recommendation stands, and this research strengthens it rather than
weakening it** — but it needs one qualification I could not have written before
Michael told me why the entities exist.

The qualification: **an intercompany balance is only meaningful if the entities
are genuinely separate.** `36000` is the right account *and* it is a measuring
instrument. Every dollar that accumulates there is evidence about how separate
these businesses really are. A due-from that is created and settled looks like
two businesses dealing with each other; a due-from that only ever grows looks
like one wallet with two labels, and it is the first thing an examiner will point
at when arguing "unified business enterprise" under §3.

So the recommendation gains a second half: **book it to `36000`, and then
actually settle it.** The balance should cycle, not ratchet. If Michael finds he
cannot settle it — the receiving entity has no cash of its own to repay with —
that is itself the finding, and it means the entity is not standing on its own
and the answer was `41100` (or a distribution) all along.

`36000` also remains the choice that preserves the four-entity audit trail, which
§5(1) says is the whole defense. Routing cross-entity money through equity
erases exactly the record that proves separateness.

**Still unchanged:** `submitIntercompanyPair` has no caller, so nothing posts, and
the census row stays `correct: UNKNOWN`. I asked Michael one question in books-73
and he has not answered it yet: is money one entity spends on another's behalf
**expected to be repaid** (then `36000`, and I build the rule) or **not expected
to be repaid** (then `41100`/distribution, and the rule differs)? That question
is now more important than it was, because the answer is also the answer to
whether the entities are separate.

---

## 7. The next logical slice for wiring up the books

Michael asked for this specifically. Here is the reasoning, then the answer.

**What I measured before proposing anything** (rule 1 — never guess):

- The **entity dimension already exists and is correct.** `gl_entities` in
  migration 0172 has exactly the four codes, each with its tax form and NAICS,
  and it is seeded. The comment already says it "replaces Sage 50 account-code
  suffixes with a real first-class dimension." *Nothing needs building here.*
- The **280E cost classification already exists in the schema.**
  `gl_accounts.default_cost_class` and `gl_account_rules.cost_class` both carry
  `('cogs_direct','cogs_allocable','nondeductible_280e','separate_business',
  'personal','none')`, and `coa-core.ts#defaultCostClass` already encodes the
  asymmetry that only `greenway` is exposed to 280E.
- The **costing engine already exists**: `cogs-position-core.ts`, 1,260 lines,
  with `determineTaxpayerRole`, `validateCogsInput`, `computeForm1125A`,
  `comparePositions`, `adviseOnMethodChange`. **It has zero importers** — the
  census already records "0 importers."
- The **classification table is inert**: `gl_account_rules` has a unique index, a
  control-account guard trigger, and **no TypeScript that reads or writes it**
  (D-30, D-37). `atm-classification-core.ts` describes it in comments and
  deliberately does not use it.
- The **raw material is on hand and measured**: 550 expense rows, **$368,276.34**,
  across five real card/bank exports, hitting 18 G/L accounts, paid from
  `10005-GRNWY` (349 rows) and `37009-GRNWY` (201 rows). Every G/L account used
  is already in the chart — "G/L accounts used but NOT in the chart: 0."

**So the gap is not law, schema, or engine. The gap is the classifier in the
middle: nothing turns a real transaction line into (account, entity,
cost_class).** That single missing surface is what blocks D-30, D-37, D-47 and
the whole bank-feed posting path, and it is the surface where every conclusion in
this document either gets enforced or gets lost.

### Proposed slice: the expense classification core

A pure leaf module — `expense-classification-core.ts`, same shape as
`ledger-category-map-core.ts` shipped in books-73: zero imports, no I/O, no
clock, no randomness, fully self-tested, gated twice.

Its one job: given a transaction line (merchant text, amount, which card or bank
account paid it), propose **(account, entity, cost_class)** *or refuse with a
code*. Specifically:

1. **Normalize** the merchant string the way `gl_account_rules.match_value`
   requires (upper-case, punctuation stripped) so "Office Depot", "OFFICE DEPOT
   #1234" and "office  depot" are one rule and not three.
2. **Match** by the `match_kind` ladder the schema already defines
   (`merchant_exact` before `merchant_contains`), lowest `priority` wins, with
   **first-key determinism** pinned by test — the exact failure that produced two
   survivors in the books-73 mutation campaign.
3. **Assign the entity**, which is the part this research makes non-negotiable.
   Kitsap County Treasury property tax on Geiger Rd is the *landlord's* cost, not
   the store's, whichever card paid it. This is where §5(1) stops being advice
   and becomes code.
4. **Assign the cost class**, and here the module must be *conservative by law*:
   for `greenway`, a reseller's operating expense is `nondeductible_280e`, and
   the module must **refuse to place store labor, rent, or security into
   `cogs_direct`** — because Reg. §1.471-3(b) does not allow it and
   `Richmond Patients Group` says trimming and packaging do not change that. A
   refusal here is worth more than a guess: a wrong `cogs_direct` is the row that
   loses an audit.
5. **Refuse, loudly and with a reachable code**, when it cannot classify: unknown
   merchant, ambiguous rule tie, control-account target, cross-entity
   suspicion, personal-looking spend on a business card. Rule 48 — a check that
   cannot classify must fail, never skip. Rule 43 — every refusal code must be
   reachable by some code path, so any code the shipped rule set cannot reach
   gets a parameterized door (`classifyIn(rules, line)`) so the tests can hit it,
   exactly as `resolveLedgerCategoryIn` does.

**Why this slice and not another:**
- It is the **only** thing blocking four recorded defects at once.
- It runs against data Michael has already given me and I have already measured,
  so it can be *proved on his real rows* rather than on fixtures.
- It posts nothing, so it cannot corrupt anything — same safety property that
  made the bank feed "the safest thing to wire first" (D-37).
- It is the surface that makes the 280E position **mechanical instead of
  advisory**, which is the entire point of §§1a and 5(4).
- It respects "we are not ready to migrate inventory over yet": this is the
  expense side, not the inventory cut-over.

**What it will NOT do:** it will not post, will not write `gl_account_rules`, and
will not decide the `41000` WITHDRAWALS question ($141,904.95, 87 rows) — that
needs the CPA and the K-1 work that is deliberately on the back burner.

---

## 8. Washington law constrains the structure, and it cuts the other way

This is the part a federal-tax-only analysis misses, and Michael needs it because
his retail licence is the asset the whole thing rests on.

**WAC 314-55-035** requires a cannabis licence be issued in the name of the
**true parties of interest**, and it defines that term very broadly. For an LLC
it is all members *and* all managers. It expressly includes:

> "Any entity(ies) or person(s) with a right to receive some or all of the
> revenue, gross profit, or net profit from the licensed business during any full
> or partial calendar or fiscal year[;] Any entity(ies) or person(s) who
> exercise(s) control over the licensed business"

and for "Multilevel ownership structures," "All persons and entities that make up
the ownership structure." "Control" means "the power to independently order, or
direct the management, managers, or policies of a licensed business."

Two exclusions matter enormously here:

- **(4)(a) — the landlord exclusion.** A person or entity "receiving payment for
  rent on a fixed basis under a lease or rental agreement" is **not** a true
  party of interest. But read the rest: "Notwithstanding, if there is a common
  ownership interest between the applicant or licensee, and the entity that owns
  the real property, the board may investigate all funds associated with the
  landlord to determine if a financier relationship exists. The board may also
  investigate a landlord in situations where a rental payment has been waived or
  deferred."

  **This is Michael's exact situation, named in the rule.** The exclusion holds —
  a commonly-owned landlord is fine — but on two conditions the rule states
  outright: the rent must be **on a fixed basis under a lease**, and it must not
  be **waived or deferred**. Percentage-of-sales rent, or rent that goes unpaid
  when cash is tight, invites the LCB to investigate the landlord's funds.

- **(4)(f) — the services exclusion.** A business "with a contract or agreement
  for services with a licensed business, such as a branding or staffing company,
  will not be considered a true party of interest, **as long as the licensee
  retains the right to and controls the business**."

  Note what this means: Washington would *tolerate* a staffing company that
  federal tax law punishes. **The two bodies of law disagree, and Michael must
  satisfy both.** The safe intersection is the one §4 already reaches: no
  staffing or management entity for the store.

**And the LCB's Real Property guidance adds a hard structural limit:** the
document showing right to the real property "must be in the name of the applicant
entity," and "This rule prohibits lease or rental agreements between retail
licensees and non-retail producer/processor licensees." Michael is retail-only,
so the tied-house problem does not bite him — but it is the reason he can never
solve a 280E problem by acquiring a producer or processor and leasing between
them. WAC 314-55-035(2) says the same thing from the ownership side: a married
couple may not be a true party of interest in both a retailer licence and a
producer or processor licence.

**Net effect for the strategy:** Washington law *supports* the landholding entity
(it is an enumerated exclusion) provided the lease is written, fixed, and
actually paid — which is the same discipline §5(2) demands for §482. The two
regimes want the same file. That is a genuinely useful alignment and it makes the
lease documentation the highest-value hour Michael can spend.

Also worth knowing: any change in ownership needs board approval before it
happens (WAC 314-55-035(5)(b), WAC 314-55-120), and the source of funds invested
in the licensed business must be disclosed. Restructuring for tax reasons is not
a purely tax decision here; it is a licensing event.

---

## 9. Where this leaves the rescheduling question

Executive Order No. 14370, 90 Fed. Reg. 60541 (Dec. 18, 2025), directs the
Attorney General to expedite the Schedule III rescheduling rulemaking begun at
89 Fed. Reg. 44597. If cannabis moves to Schedule III, §280E stops applying by
its own terms, because it reaches only Schedule I and II substances.

**What that means for how to build:** it is a reason to keep the 280E treatment
a *switch* rather than something baked into the data — which is what standing
rule 8 already requires and what `cost_class` on every line already achieves. It
is **not** a reason to relax anything now. Rescheduling is not law, the effective
date would not be retroactive, and the open years under audit would still be
280E years. Build for 280E; make it switchable.

---

## 10. The short version for Michael

1. **You are a reseller.** COGS is purchase invoice plus freight-in. Not store
   labor, not rent. That is `Reg. §1.471-3(b)`, and `Richmond Patients Group`
   closed the trimming-and-packaging workaround.
2. **The land entity is your strongest.** Keep it. Get a written lease at a
   documented market rate, on a fixed basis, and pay it every month without fail
   — that one file satisfies both §482 and WAC 314-55-035(4)(a).
3. **The ATM entity is defensible but needs work:** its own bank account, its own
   staff time, its own records, and ideally a machine somewhere other than your
   own store.
4. **Never build a management or staffing company for the store.** That is
   `Alternative Health Care Advocates`, and it produced a *worse* outcome than
   doing nothing.
5. **Stop paying one entity's bills from another's cash.** $61,109.02 of it is
   already in your books. Commingled cash is the best evidence against you.
6. **"They exist solely to mitigate 280E" is the wrong answer to give an
   examiner** — not because it is dishonest, but because the legal test asks what
   business purpose is served by running them separately, and a tax purpose is not
   one. The fix is conduct, not wording: separate cash, separate staff, market
   rent, real records. Then the business purpose is self-evident.
7. **Next slice: the expense classifier** — the missing piece between the data you
   have already given me and the ledger that is waiting for it.

---

## Authorities cited

**Statutes and regulations.** IRC §§61, 63, 162, 261, 263A(a)(2), 280E, 471,
471(c), 482, 6001, 6662; Reg. §§1.61-3(a), 1.471-3(b), (c), (f), 1.482-1,
1.6001-1, 1.6662-6(d)(2); RCW 69.50.535; WAC 314-55-035, 314-55-120; WA LCB Real
Property guidance.

**Cases.** `Alternative Health Care Advocates v. Commissioner`, 151 T.C. No. 13
(2018); `Patients Mutual Assistance Collective Corp. v. Commissioner`, 151 T.C.
176 (2018), aff'd 995 F.3d 671 (9th Cir. 2021); `Richmond Patients Group v.
Commissioner`, T.C. Memo 2020-52; `Alpenglow Botanicals v. United States`, 894
F.3d 1187 (10th Cir. 2018); `Californians Helping to Alleviate Med. Problems v.
Commissioner` (CHAMP), 128 T.C. 173 (2007); `Olive v. Commissioner`, 139 T.C. 19
(2012), aff'd 792 F.3d 1146 (9th Cir. 2015); `Canna Care v. Commissioner`, T.C.
Memo 2015-206; `Loughman v. Commissioner`, T.C. Memo 2018-85; `Alterman v.
Commissioner`, T.C. Memo 2018-83; `N. Cal. Small Bus. Assistants v.
Commissioner`, 153 T.C. 65 (2019); `San Jose Wellness v. Commissioner`, 156 T.C.
62 (2021); `Savage v. Commissioner`, 165 T.C. No. 5 (2025); `Commissioner v.
Groetzinger`, 480 U.S. 23 (1987).

**Administrative and other.** IRS Cannabis Industry FAQ (Apr. 25, 2025); CCA
201504011; CCA 201531016; CCA 202114019; S. Rep. No. 97-494 (1982); CRS Report
R46709 (updated Feb. 6, 2026); Exec. Order No. 14370, 90 Fed. Reg. 60541 (Dec.
18, 2025); 89 Fed. Reg. 44597.

**Caveat.** Case holdings above are drawn from the opinions' own language where
quoted. The two block quotations in §2 are reproduced from the text of the
opinion as published. Nothing here is a legal opinion; the structural questions
in §§3–4 and §8 should be confirmed with cannabis-experienced tax counsel before
any restructuring, and any ownership change requires LCB approval first.
