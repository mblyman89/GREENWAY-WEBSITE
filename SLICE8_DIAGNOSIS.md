# SLICE 8 — DIAGNOSIS: Bulk editing the Cultivera migration gaps

**Written BEFORE any code (standing rule 5).** Every claim below is anchored to a
file and line that was read in this session. Nothing here is remembered or assumed.

---

## 1. The owner's request, verbatim

Round 11, first message:

> "Please proceed with the bulk editing slice. This one maybe do some deep research
> on the web first so you know exactly how the professional enterprise grad solution
> tackles this problem. I want to make sure we build something that is useful and
> powerful, yet easy to use and user friendly. Please go above and beyond with this
> slice. Follow the standing rules and never guess, never assume."

Round 11, second message (the constraint that reshaped the design):

> "Those locks are real and intentional for products and we built it that way when we
> built product intake, where products flow into our system rather than come from
> Cultivera. Cultivera's data is garbage, and we will need a way to add those fields
> if they don't exist in the Cultivera data. So I wonder if that means we need to bend
> the rules specifically for the one time Cultivera upload, and allow me to enter that
> data the one time and then it respects the locked fields rules that protect my
> license from compliance issues."

---

## 2. The finding that means NO rule has to be bent

The owner asked whether an exception must be carved out. **It must not.** The
codebase already draws the exact distinction he described, in three independent
places, and all three agree.

### 2.1 The locks are real — confirmed, not assumed

`src/lib/inventory/lot-edit-core.ts:23-45` is the whitelist gatekeeper. Exactly four
fields are hand-editable:

    EDITABLE_LOT_FIELDS = ["vendor_id", "brand_id", "strain_name", "strain_type"]

and eleven are explicitly locked, including the three the owner needs to fill:

    LOCKED_LOT_FIELDS = [..., "unit_cost_minor_units", ..., "expires_on", ...,
                         "pos_product_key"]

The file's own header (`lot-edit-core.ts:4-13`) states the doctrine:

> "numbers that CCRS reporting is built on (quantities, lot codes, unit costs, LCB
> category/inventory type, COA/lab data, dates) are NEVER hand-edited here — they come
> from manifests, imports and audited adjustments."

Read carefully, that sentence locks **hand-EDITING of a value that came from a
manifest or import**. It does not speak to a field the import never delivered at all.

### 2.2 The precedent: SLICE 2 already did this once, for the same reason

`src/app/admin/inventory/actions.ts:100-116` — the received-date fix — is the same
shape of problem, and it was solved without an exception:

> "the received date is not a derived number, it is a FACT FROM THE PAPERWORK that the
> Cultivera export simply failed to carry. The owner reading it off the manifest is the
> most authoritative source available."

`expires_on` is stated as locked in `lot-edit-core.ts:41` **because it comes from the
COA** (`lot-edit-core.ts:6`). When the COA exists, that lock is correct and stays.
When Cultivera shipped no expiry at all, there is no manifest value to protect — the
field is blank, and a blank is not a fact being overwritten.

### 2.3 The importer itself pre-authorised this exact work

This is the decisive evidence. `src/lib/pos/import-lot-core.ts:291-302`, the function
that wrote the note on every migrated lot, emits:

    "Cultivera migration (one-time POS import)."
    "COA flag N in POS export — obtain and attach the COA during enrichment."
    "Expiration date not provided by POS export — set during enrichment."

The one-time import **wrote down, at import time, that these fields were missing and
would be set during enrichment.** SLICE 8 is not an exception to the design. SLICE 8
is the enrichment step the importer explicitly deferred to.

It also means the affected rows are **self-identifying**: the literal marker
`"Cultivera migration (one-time POS import)."` appears in `inventory_lots.notes` on
exactly the one-time-import rows and nowhere else. Confirmed by grep — the string
occurs only at `import-lot-core.ts:292` (the writer), `import-lot-core.ts:576` (its
self-test), and `received-date-core.ts:424,428` (test fixtures). Go-forward intake
lots never carry it.

### 2.4 "Enter it once, then it locks again" is an existing, tested doctrine

The owner asked for exactly this behaviour. It already exists as
`fact_provenance jsonb` (migration `0138_structured_product_facts.sql:29`) and the
rule is stated at `src/lib/inventory/reprocess-core.ts:16-18`:

> "A fact column whose fact_provenance key already exists is NEVER touched, even when
> the column reads NULL — a reviewer's decision (provenance "reviewer", SLICE 57)
> always outranks the machine."

And `0214_inventory_lot_received_date.sql:41-75` shows the full provenance pattern for
a lot column: value + `_source` + `_set_by` + `_set_at`, with a CHECK constraint
guarding the source vocabulary (`'pos_import' | 'manifest' | 'owner_entered'`).

**Conclusion.** SLICE 8 fills blanks on one-time-migration rows, stamps who filled
them and when, and then the field is protected exactly like every other evidenced
fact. No lock is weakened. No go-forward intake lot is touched, ever.

---

## 3. What SLICE 8 will and will not permit

### 3.1 The eligibility predicate (all four must hold)

A lot is bulk-editable for a given field ONLY when:

1. the lot carries the one-time-migration marker in `notes`; AND
2. the target field is **currently blank** (NULL — never a value being replaced); AND
3. the lot is not `destroyed`; AND
4. the field is one of the three the import demonstrably failed to carry.

Fail any one and the row is **ineligible** and is shown as such, with the reason. This
implements the researched rule "communicate eligibility clearly" — ineligible rows are
never silently skipped.

### 3.2 The three fillable fields, and why each qualifies

| Field | Why blank | Why filling is legal | Source stamp |
|---|---|---|---|
| `expires_on` | `import-lot-core.ts:301` — "Expiration date not provided by POS export — set during enrichment." | Read off the physical package/COA. A fact from paperwork the export dropped. | `owner_entered` |
| `unit_cost_minor_units` | Cultivera export carried no cost for these rows; SLICE 7 counts them as `unknownCost` and they silently contribute 0 to On-hand cost. | Read off the vendor invoice. Minor units (rule 7). | `owner_entered` |
| `pos_product_key` | `lot-gap-core.ts` `hasNoProductLink` — NULL *or* empty string. | Links the lot to a catalog product; not a CCRS-reported number. | `owner_entered` |

### 3.3 Hard refusals (STATUTORY — these refuse, never degrade)

- **Never overwrite a non-blank value.** If the field has any value, the row is
  ineligible. This is the whole safety property; it is asserted in the pure tests.
- **Never touch a non-migration lot.** Go-forward intake lots are out of scope by
  predicate.
- **Never touch `on_hand_qty`, `received_qty`, `lot_code`, `category`,
  `inventory_type`, `lab_result_id`, `manifest_id`, `created_at`.** Quantities move
  only through audited adjustments; `created_at` is the immutable FIFO key
  (`store.ts:546-549`).
- **Never write a value that fails the same validation a single edit would apply.**
  Bulk is not a bypass. The pure core validates every row individually.

---

## 4. The design, from the research

Four authoritative sources were read in full this round: the Basis Design System bulk
editing pattern, Pencil & Paper's enterprise data-table UX guide, PatternFly's
inline-edit design guidelines, and Eleken's bulk-actions guidelines. Where they agree,
we follow. Where the compliance domain conflicts with convenience, compliance wins.

**Adopted:**

1. **Explicit bulk-edit mode**, entered from a button above the table (Basis). Not
   always-on checkboxes — this keeps the normal browsing view uncluttered.
2. **Selection count carried in the action button** (Basis) — "Fill 12 selected".
3. **Contextual header** in the edit step naming the field, the count, and the item
   type (Basis).
4. **Changes preview before anything is written** (Basis: "for complex edits, show a
   preview to avoid unintended edits"). This is also **standing rule 3 (drafts-only):
   a write needs owner review.** The two requirements coincide exactly.
5. **Eligibility shown, never hidden** (Eleken). Ineligible rows are listed with the
   reason they cannot be filled.
6. **Deliberate friction for high-stakes data** (Pencil & Paper: "add friction —
   expandable-row or modal editing — for high-stakes data"). Cannabis traceability is
   as high-stakes as data gets, so SLICE 8 uses a **two-step confirm**, not inline
   auto-save.
7. **Right-align numbers with tabular figures** (Pencil & Paper) for the cost column.
8. **Result summary distinguishing succeeded / skipped / failed** (Eleken).

**Deliberately rejected:**

- **Optimistic UI / auto-apply.** Eleken lists it; Pencil & Paper warns against it for
  high-stakes data. A write that reaches a state traceability table must be confirmed
  before it happens, not undone after.
- **Undo-after-the-fact as the primary safety net.** Preview-before-write is strictly
  safer and is what rule 3 requires.
- **Find-and-replace** (a Basis variant). It exists to rewrite *existing* values. SLICE
  8 may only fill blanks, so the variant is inapplicable by construction.

---

## 5. Build plan

1. `src/lib/inventory/bulk-fill-core.ts` — PURE. Eligibility predicate, per-field
   validation (reusing `parseReceivedDateInput`'s date discipline and
   `parseDollarsToMinor` from `list-filter-core.ts`), plan builder producing
   `{ applied[], skipped[] with reasons }`, and `__runBulkFillCoreTests()`.
2. Register the core in `scripts/compliance/run-pure-selftests.ts`.
3. `tests/compliance/slice8-bulk-fill.test.ts` — including a corpus proving no
   non-blank value is ever included in a plan, and no non-migration lot is ever
   eligible.
4. Store writer + server action behind `requirePermission("inventory.manage")`, with
   `recordAudit` per the SLICE 2/77 pattern.
5. Migration (idempotent, applied MANUALLY by the owner) adding the `_source` /
   `_set_by` / `_set_at` provenance columns for the filled fields, mirroring 0214.
6. UI: bulk-edit mode on `/admin/inventory`, wired to the SLICE 7 gap worklists.

Gates: `tsc --noEmit` 0 errors, `eslint` 0 problems, full vitest sweep, sabotage tests.
Note: `next build` OOMs identically on clean `main` in this sandbox, so `tsc --noEmit`
is the type gate. No DB credentials here, so live row counts are NOT restated as fact.
