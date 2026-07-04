# Product Workflow Analysis & Alignment Plan

Verbatim owner request (2026): "Will you next move on to the products page and
product drafts page. Can you expand further what the product drafts is doing for
us? Is this something that should be included with products as it's where
enrichment lives? I'm trying to understand the work flow. We intake items, the
system does the heavy lifting naming everything and such, then we move on to
product enrichment (products), we should probably rename it to product
enrichment so it's more obvious, but anyways, after enrichment, does it then go
to product drafts? I want to start focusing on work flow and ease of use and
access ... focus on how we can make my employees lives easier and better ...
deep researching proper work flow and how we can better align with industry
standards and best practices."

---

## A. What each page ACTUALLY does today (verified from code — no guessing)

### 1. Vendor Intake — `/admin/inventory/intake`  (perm: inventory.manage)
The FRONT of the chain. A vendor manifest/transfer (CCRS JSON + COA) is ingested;
the system does the heavy lifting: parses lots, names them, pulls potency from
the COA, matches each lot to the live menu by its POS key.

### 2. Product Drafts — `/admin/inventory/drafts`  (perm: inventory.manage)
Data layer: `src/lib/inventory/catalog-drafts.ts`, table `catalog_product_drafts`.
- On accepting a manifest, each lot is matched to the PUBLISHED menu by POS key.
- Lots that DON'T match => a DRAFT product is auto-seeded from the transfer JSON
  + COA potency (name, brand, vendor, category, strain, THC/CBD, cost, price
  floor, AI-suggested price + rationale). Status = `draft`.
- Employee reviews each draft and either APPROVES it with a final price
  (`approveDraftWithPrice`, enforces the hard 2× cost floor) or DISMISSES it.
- Approved drafts are STAGED for the next menu publish. Nothing is customer-facing
  until approved.
- So: this is the "does this NEW product belong on the menu?" gate. It is about
  EXISTENCE / ONBOARDING of new SKUs, driven by receiving.

### 3. Products — `/admin/products`  (perm: products.enrich)
Data layer: `src/lib/enrichment/store.ts`, `menu-version`. Operates over the
LIVE PUBLISHED menu. This is ENRICHMENT: add photos, descriptions, tags, staff
picks, AI-drafted copy. Price & stock stay POS-controlled. Shows gap KPIs
(missing description/image/brand link), completeness %.
- So: this is the "make products on the menu look great online" surface. It is
  about CONTENT QUALITY of products that already exist on the menu.

### 4. Product Mastering — `/admin/products/masters`  (perm: inventory.manage)
Groups menu items that are really ONE product at different sizes/forms into a
single card (AI suggests groupings; human accepts -> draft master -> publish).
- So: this is about CARD STRUCTURE / de-duplication of the menu.

---

## B. The owner's mental model vs. reality

Owner asked: "after enrichment, does it then go to product drafts?"
ANSWER: No — it's the OPPOSITE order, and they're two different lifecycles that
meet at the menu. The real flow is:

  INTAKE (receive lot)
     │  system names/prices/matches
     ▼
  ┌─ lot matches an existing menu product ──────────► already on menu
  │
  └─ lot is NEW (no menu match) ──► PRODUCT DRAFTS (onboarding gate)
                                       │ approve w/ price (2× floor)
                                       ▼
                                    staged for next MENU PUBLISH
                                       │
                                       ▼
                                    LIVE MENU  ◄─────────────┐
                                       │                     │
                                       ▼                     │
                                    PRODUCTS (enrichment) ───┘ (content added on
                                       photos/descriptions/tags   live products)

So "Product Drafts" is an ONBOARDING/existence gate that comes BEFORE the menu;
"Products" (enrichment) comes AFTER a product is live on the menu. They are not
sequential steps of one pipeline — Drafts feeds the menu, Products polishes what's
on the menu.

Naming confusion is real: "Products" that is really "Enrichment"; "Product
Drafts" (new-SKU onboarding) vs. "Product Mastering" drafts (grouping) — three
different "draft" ideas.

---

## C. Industry standard (authoritative research)

Sources: AtroPIM "Product Data Enrichment: Process, Best Practices, and Tools"
(2026); PIMinto "PIM for Catalog Management" (2026); cannabis inbound modules
(Flourish/Flowhub) for the receiving→catalog side.

The canonical PIM product lifecycle is FIVE stages:
  1. Audit the catalog (find gaps)
  2. Define the data model (required attributes per channel)
  3. Source missing data (drafts; supplier feeds; AI generation)
  4. Validate & approve (human review stage BEFORE publish; AI never publishes)
  5. Publish & monitor (KPIs: completeness score, time-to-market)

Key best-practice principles that apply directly to Greenway:
- A product moves through explicit STAGES from "incomplete → complete → live."
- AI output is DRAFTS ONLY and passes a human validation gate. (Already our rule.)
- ROLE-BASED workflow stages: different people own different steps, in parallel.
- COMPLETENESS score is the north-star metric; surface gaps, don't hunt for them.
- "Cleanse first, then enrich" — structure/existence before content polish.
- Reduce clicks & consolidate the surfaces a worker touches for one job.

Greenway ALREADY follows the spine of this (draft gate, human approval, AI=draft,
completeness KPIs). The gap is NAMING + NAVIGATION CLARITY + WORKFLOW HAND-OFFS,
not the underlying model.

---

## D. Recommendations (to confirm with owner before building)

### D1. Rename for obviousness (owner explicitly asked)
- "Products" ► "Product Enrichment"  (nav + page title + help + dashboard card).
- "Product Drafts" ► "New Product Review" (or "Incoming Products" / "Product
  Onboarding") — makes clear it's the new-SKU gate from receiving, not a scratch
  pad. Keeps `/admin/inventory/drafts` route.
- Consider grouping under a clear "Catalog" nav section: Product Enrichment,
  New Product Review, Product Mastering — so the three catalog surfaces sit
  together and read as one workflow.

### D2. Make the workflow legible (ease of use)
- Add a short "workflow strip" / breadcrumb-of-stages on each catalog page:
  Intake → New Product Review → Menu → Enrichment, with the current stage lit,
  so a new employee instantly understands where they are and what's next.
- On approving a draft, offer a one-click "Enrich now" hand-off to the enrichment
  page for that product (connect the two lifecycles at the seam).
- Cross-links: Enrichment page badge "N new products awaiting review →"; Review
  page shows "once approved, add photos/description in Product Enrichment."

### D3. Ease of access
- A single "Catalog" landing/hub that shows the three surfaces + counts
  (drafts to review, products missing description/image, pending master
  suggestions) so a manager sees the whole catalog health in one glance.

### NOTE: All of D is DRAFT PROPOSAL — confirm scope/names with owner first.
### Do NOT rename routes (SEO/bookmarks) unless owner wants; rename LABELS first.
