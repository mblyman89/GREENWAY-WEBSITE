# Intake Pipeline — Owner Decisions & Roadmap Additions

This file records the owner's answers to the open questions in the intake
pipeline audit (bible `INTAKE_PIPELINE_BIBLE.md` §18.5 / §18.6, executive
report §8), plus roadmap items the owner added after Round 5. Every fact here
has a file:line citation that was checked at commit `3e35824e`. Where the owner
said "I think", the code was checked, and the result is written down, even when
it disagrees.

A pin test (`tests/compliance/intake-roadmap-decisions.test.ts`) keeps the
code facts below honest. If one of them stops being true, that test fails and
this file has to be updated.

---

## D-R3-1 — Who may key a missing unit cost? (S33)

**Owner answer (Round 6, verbatim):** "owner and admin can add cost if
missing. It never will be though, the states CCRS is extremely strict about
this. So I'm almost hesitant to build it. It can only be used for non cannabis
inventory. No product I upload from Cultivera will come without a cost
assigned. Our system refuses to accept the manifest if it doesn't have a cost
assigned even, I think. So let's not build this for the cannabis inventory, but
we should for non cannabis inventory."

**Decision:** S33 is **rescoped**. Cannabis cost entry is **not built**.
S33 becomes non-cannabis cost entry, S33-NC below.

### What the code actually does with a cannabis line that has no cost

The owner's "I think" was checked. The system does **not** refuse the manifest.
Only the books refuse the vendor bill.

| Step | What happens to a line with no price | Where |
|---|---|---|
| Parse | Parse accepts it. `unit_cost_minor_units` stays `null` when the JSON has no `line_price`. | `src/lib/inventory/intake-parser.ts:391-397` |
| Invoice merge | Cost is filled from the vendor invoice by lot, when an invoice is attached. | `src/lib/inventory/manifest-merge-core.ts:174` (`mergeInvoicePricesByLot`) |
| Review | Review adds an **info** flag only ("No unit cost on this line — confirm pricing."). Info does not block review. | `src/lib/inventory/intake-review-core.ts:176-177` |
| Finalize | The manifest finalizes and the lots are received. | `src/app/admin/inventory/intake/actions.ts:804` (`finalizeManifestAction`) |
| Vendor bill | The **whole bill** is refused with `BILL_LOT_COST_UNKNOWN` ("Key the unit costs, then finalize again"), and `vendor_bill_refused` is logged. | `src/lib/accounting/vendor-bill-service.ts:262-284` |

So in theory a no-cost cannabis line can enter inventory. The owner reports
that in practice it never happens: CCRS and Cultivera always carry cost.
Because of that, we are **not** building a cannabis cost-entry screen. If a
`BILL_LOT_COST_UNKNOWN` refusal ever shows up in the audit log, reopen this
decision. The refusal already fails safe, because nothing partial is posted.

### Non-cannabis: the real gap (S33-NC, new scope)

| Fact | Where |
|---|---|
| A blank cost field becomes **0**, not "unknown". | `src/app/admin/inventory/noncannabis/actions.ts:29-34` (`dollarsToMinor` returns 0 for `""`) |
| The product column is `cost_minor_units integer not null default 0`, so "unknown" and "free" look the same. | `supabase/migrations/0076_noncannabis_products.sql:43` |
| Invoice lines allow `unit_cost_minor_units >= 0`, so $0.00 is accepted. | `supabase/migrations/0112_noncannabis_vendor_invoices.sql:89` |
| There is **no way to edit cost after creation**. The only edit action changes barcode, reorder point and location. | `src/app/admin/inventory/noncannabis/actions.ts:153` (`updateNonCannabisOpsAction`) |
| Every non-cannabis action is gated by `inventory.manage`, which is owner, admin **and manager**. | `src/lib/auth/roles.ts:97` |

**S33-NC scope (proposed, not built yet):**

- Add a "Cost" edit on the non-cannabis product page that fills **only when the cost is 0**.
- Parse the input with the existing bulk-fill `parseCostInput`.
- Record an audit event with before and after values via `recordAudit` (`src/lib/auth/audit.ts:19`).
- Show a "Cost missing" chip on $0 products, so they can be found.

**Role:** the owner said "owner and admin". Today's `inventory.manage` and
`payables.manage` both also include **manager** (`roles.ts:90,97`). There is no
owner/admin-only helper today: `session.ts` exports only `requireStaff` and
`requirePermission`. The permission map does have owner/admin-only permissions
(`users.manage`, `settings.manage`), but they mean other things. S33-NC will
therefore add a dedicated permission, e.g. `inventory.cost.fill` =
`["owner","admin"]`, in `roles.ts`, rather than borrow an unrelated one. **To confirm when S33-NC starts:** should
managers be excluded, as stated, or included, as the permission map would do by
default?

---

## Q-02 — How many manifests per week?

**Owner answer:** 15–20 manifests per week, about 65–87 per month.

Checked against the caps that depend on it:

| Cap | Value | Covers 15–20/wk? | Where |
|---|---|---|---|
| Onboarding manifest picker window | 30 days | yes (~65–87 manifests in the window) | `src/lib/catalog/onboarding-list-core.ts:67` |
| Picker max manifests | 100 | yes, about 13 manifests of headroom at the top of the range | `onboarding-list-core.ts:68` |
| Legacy draft read | 500 | yes | `onboarding-list-core.ts:61` |
| Picker draft count cap | 5000 | yes | `src/lib/inventory/catalog-drafts.ts:692` |

**Watch item:** at 20 per week a 30-day window holds about 87 manifests. If
volume rises above about 23 per week (about 100 in 30 days), the picker's
100-manifest cap will start dropping the oldest manifests in the window. The
picker already says when it is capped (S14).

**Still open from Q-02:** lines per manifest per week and how many lines
arrive with no SKU. These size the S05 identity backfill and the F-086
classification-memory scan. They have not been answered, so nothing here
assumes them.

---

## R-LLAMA — One more try at LlamaParse invoice # and transport details

**Owner request (Round 6, verbatim):** "Will you also add to the roadmap
strategy to try one more time to get llama ai to work better to extract invoice
numbers and transportation manifest details. It really struggles, and we've
tried 2-3 times already, I just don't get why it's so hard for it, it's in
quality PDFs but it still struggles."

### Prior attempts (git history)

| PR | What it did |
|---|---|
| #797, #798 | LlamaParse provider (PR-1, PR-2) |
| #799 | LlamaParse made the **primary** PDF reader, with unpdf as the outage fallback |
| #802 | LlamaParse status page |
| #803 | Invoice-number regex (`extractInvoiceNumberFromText`) |
| #804 | "Run AI extract" + driver license reader (`readDriverLicenseNumber`) |
| #805 | Manual invoice-number override (migration 0151) |

### Root cause — proven, not guessed

**LlamaParse is reading the PDFs correctly. Our code cannot read LlamaParse's
answer.**

- We ask LlamaParse for **Markdown**: `result_type: "markdown"` in `src/lib/inbound-email/llamaparse-core.ts:123`. We then fetch `/api/v1/parsing/job/{id}/result/markdown` in `llamaparse-provider.ts:125`.
- Since #799, that Markdown is the **primary** text for every PDF (`src/lib/inventory/pdf-extract.ts:64-105`).
- The field scanners were written and tested against **unpdf's flat text**, for example `Invoice #: INV-15121 Order #: 15121`. They were never tested against Markdown.

A probe ran the real functions on the same values in both shapes:

| Input shape | `extractInvoiceNumberFromText` | `readDriverLicenseNumber` |
|---|---|---|
| Flat text (unpdf) | ✅ found | ✅ found |
| `**Invoice #:** INV-15121` (bold label) | ❌ null | ❌ null |
| `**Invoice #** INV-15121` | ❌ null | — |
| `\| Invoice # \| INV-15121 \|` (table, label and value in one row) | ❌ null | ❌ null |
| Table with header row, then value row | ❌ null | ❌ null |
| `Invoice \# 0000020830` (escaped hash) | ❌ null | — |
| `## Invoice Number: 0000020830` (heading) | ✅ found | — |

Markdown adds `**`, `\#`, `|` and header/value rows. That breaks every label
followed by value pattern except headings. This is why each earlier regex fix
helped for a while and then "struggled" again: each fix was tuned to whichever
text shape was in front of us.

### Strategy (one slice, S-LLAMA, Ring 1 then Ring 2)

1. **Golden set first (the acceptance bar).** Collect 10–15 of Michael's real
   manifests and invoices, covering every vendor layout seen in 30 days. For
   each one, commit the redacted LlamaParse Markdown **and** the unpdf text as
   fixtures. Next to each fixture, record the hand-checked truth: invoice #,
   driver name, driver license #, vehicle make/model/plate, departure and
   arrival times. No fixture is added without a hand-checked truth.
2. **Markdown to label/value normalizer (pure core).** Add
   `markdown-fields-core.ts`, which turns Markdown into the flat
   `Label: value` lines the scanners already understand:
   - strip `**` and `__`;
   - unescape `\#`;
   - turn a two-cell `| Label | value |` row into `Label: value`;
   - turn a header row plus value row(s) into `Header: value` pairs by column;
   - drop `|---|` separator rows.

   The existing scanners run on the normalized text. This is a pure function
   with embedded self-tests and mutation testing, and no scanner logic is
   rewritten.
3. **Structured tables, only if the golden set needs them.** The LlamaParse v2
   API can return `text` and `items`, which are tables as rows, alongside
   Markdown in the **same** job (`expand=`). If step 2 misses a golden field,
   read the label from the `items` table cells instead of regexing text. This
   still makes one parse call per PDF.
4. **Per-field acceptance.**
   - Invoice #: at least 95% exact match on the golden set.
   - Driver license # and plate: at least 90%.
   - **Zero wrong values.** A miss must be `null`, never a guess (never-guess rule).
   - The existing manual override (0151) stays as the fallback.
5. **Shadow before switching.** Ring 1 logs "normalized says X, legacy said
   Y" through `recordAudit` (`src/lib/auth/audit.ts:19`) for two weeks of real traffic, about 30–40
   manifests. After that, Ring 2 uses the normalized value.
6. **Cost.** Zero extra LlamaParse calls. Same parse count, about 65–87
   manifests per month. No new egress, polls or crons.
7. **Later, optional:** LlamaParse structured-output / extraction schema for
   the header block, but only if the golden set still misses fields after
   steps 2–3.

**Placement:** added after S33 as **S34 (R-LLAMA)**. It does not depend on
Phases 3–7, so it can move earlier if invoice numbers hurt more than the
publish work.
