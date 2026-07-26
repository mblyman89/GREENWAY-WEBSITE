# Greenway Data Governance — Anchored Golden Rules

> **Status: BINDING.** Owner-approved (July 2026). Every intake, import, and
> transformer slice MUST follow these rules. Reference this document from PR
> bodies and code comments as `docs/data-governance.md`.

This document anchors the enterprise practices (Master Data Management,
Product Information Management, medallion architecture, data-migration
discipline) that the owner approved for Greenway's product-data program.
Plain-English summaries first; sources at the end.

---

## 1. The Golden Record (MDM / PIM)

**Rule 1.1 — One master version of each product.** Every product has exactly
one trusted record where every fact lives in its own labeled field. Display
names, CCRS names, menu cards, and receipts are all GENERATED from those
fields — never the other way around.

**Rule 1.2 — The name is a report of the data, not the storage of the data.**
Cultivera crammed facts into names ("Const HRG CBN 1:1:1 Blueberry 10 Pack
300mg") because its fields were too weak. Greenway never stores a fact ONLY
in a name. If a fact matters, it gets a field; the naming engine
(`src/lib/naming/convention-core.ts`, SLICES 46-53) re-assembles names from
fields on demand.

**Rule 1.3 — Fields before contents.** Schema first: a fact cannot be stored
sanely until its box exists. Boxes are added by migration BEFORE the code
that fills them ships.

**Rule 1.4 — Right box, right fact.** Strain TYPE (indica/sativa/hybrid)
never lives inside the strain NAME field; package size never lives inside a
potency field; a per-serving dose is a different fact from a package total
and gets a different field. When data arrives in the wrong box, it is moved
at the door — not after it spreads.

## 2. Medallion Architecture (Bronze / Silver / Gold)

**Rule 2.1 — Bronze: raw input is immutable.** Source files (the Cultivera
PRODUCTS.xlsx / INVENTORIES.xlsx exports, vendor invoices, manifests) are
kept byte-for-byte as received and are never edited. All processing reads
from Bronze; nothing writes to it.

**Rule 2.2 — Silver: parse, validate, normalize — with provenance.** Every
row is tokenized and every extracted fact is tagged with WHERE it came from
(`column:Total`, `name`, `strain-column`, `human`) and whether it was
cross-checked. Silver output is reviewable and re-runnable at zero cost
against the frozen Bronze input.

**Rule 2.3 — Gold: only approved data enters the live system.** The commit
step writes through the SAME code path as native intake, so an imported
product is indistinguishable from one received natively. One door, one set
of rules, forever.

## 3. Data-Migration Discipline (the one-time import)

**Rule 3.1 — Never auto-commit uncertain data.** A fact is auto-accepted only
when it is verified by cross-examination (e.g. per-serving mg x pack count =
package-total mg, name agrees with column). Anything else goes to the human
exception queue with a plain-English explanation of the conflict. Zero rows
guessed — this is the migration form of the standing NEVER-GUESS rule.

**Rule 3.2 — Dry-run before commit.** The transformer produces a report
(auto-accepted / needs-review / rejected), not a database write. Iterate on
the report until it is flawless; commit once.

**Rule 3.3 — Reconcile totals.** rows in = products created + exceptions
resolved + rejects documented. The commit is not done until the arithmetic
balances and is recorded.

**Rule 3.4 — Cross-examine every fact against every other source.** Name
tokens vs. data columns vs. arithmetic identities. Agreement raises
confidence; conflict routes to review. The Cultivera `Total` column is
KNOWN-INCONSISTENT for edibles (sometimes per-serving, sometimes
per-package, sometimes 0) — the package-total mg carried in the product name
is the more reliable witness and column values are used as cross-checks.

## 4. Data-Quality Dimensions (the checklist each fact must pass)

Accuracy (matches the real product), Completeness (required boxes filled),
Consistency (same fact identical everywhere it appears), Validity (passes
range/sanity caps — e.g. mg ceilings per inventory type, percent <= 100),
Uniqueness (no duplicate golden records; CCRS names disambiguated
deterministically), and Provenance/Timeliness (every fact knows its source
and when it was established).

## 5. Greenway-Specific Standing Rules (restated for one-stop reference)

- Money is stored in cents (minor units). Always.
- Migrations are applied MANUALLY by the owner; code never assumes a
  migration has run until the owner confirms.
- NEVER GUESS: verify against code, installed packages, and real data
  (the two Cultivera exports are the authoritative corpus for the import).
- Display names for humans; CCRS Product.Name auto-composed for the state
  (two-layer naming, SLICES 52-53). Customer-facing names keep ratio/mg for
  dose-led categories.
- mg display for Solid Edible / Liquid Edible / Tincture (and, per PROGRAM 3,
  Topical Ointment); percent for flower/concentrates. RSO stays percent +
  grams (it is typed and tested as a concentrate).

## Sources (consulted July 2026)

Golden record / MDM: Profisee "What Is a Golden Record in MDM?"; Semarchy
"What are Golden Data Records"; LatentView "MDM Golden Record"; Datalere
"Five Master Data Management Best Practices for Enterprises"; DQOps "Master
Data Management vs Data Quality".

PIM: LogRocket "Product information management (PIM) systems and best
practices"; BetterCommerce "The Ultimate Guide to PIM"; DynamicWeb "Best
Practices For Successful PIM Solutions".

Medallion architecture: Dataforest "Medallion Architecture: Bronze, Silver &
Gold Layers Explained (2026)"; ML4Devs "Medallion Architecture"; Conduktor
"Data Lake Zones: Bronze, Silver, Gold Architecture"; Data Engineering
Weekly "Revisiting Medallion Architecture".

Data migration: Infocompass "The Golden Rules of Data Migration"; Tevpro
"Data Migration Legacy Systems: A Complete Guide"; Heliosz "Best Practices
of Data Migration Validation"; OpenLegacy "Legacy System Migration: Best
Practices".

Data quality: Profisee "Data Quality: What, Why, How, Who"; Semarchy "What
is Data Quality? Dimensions, Benefits & Best Practices".
