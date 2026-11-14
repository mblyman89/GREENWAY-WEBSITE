# SOP-10 — Product Enrichment: Photos First, AI Drafts, the Copilot and Publishing

| | |
|---|---|
| **Version** | 1.0 (D244 R-6; built on E-0 … E-5 #1798–#1804 and R-1 … R-5 #1805–#1809; living document) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Product Enrichment** (`/admin/products`, nav Product Intake, permission `products.enrich`, `src/components/admin/admin-nav-data.ts` L77). **Enrichment Copilot** (`/admin/products/copilot`). **Bulk AI** (`/admin/products/bulk-ai`). The product page (`/admin/products/[key]`). **Digital Assets** semantic photo search (`/admin/media`, `media.manage`, L95). The public menu cards that show the result |
| **Who may do it** | `products.enrich`: owner, admin, manager, content editor (`src/lib/auth/roles.ts` L111) |
| **Program records** | `docs/sop-program/D244-enrichment-powerhouse-strategy.md` (audit, slices E-0 … E-7, owner round 2, the delivered table) |
| **Scope (this version)** | The owner (round 2): *"a product should be publish once it has a picture. the other important details like description and facts can come later. the menu looks terrible without product pictures, but with them, its a game changer. the descriptions and facts are just cherries on top."* |

> **This SOP is a living document (owner decision D41).** When enrichment changes, the delivered row goes into the D244 strategy doc and this SOP gets a new version row in Appendix D.

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures
5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference card
10. Glossary
- Appendix A: Source map
- Appendix B: Settings the owner can change
- Appendix D: Version history

## 1. Purpose & scope

Enrichment is stage 5 of Product Intake (receive → onboard → **enrich** → master). It turns a bare POS line into a menu card that sells: a **photo** first, then a name, descriptions, strain type, potency, aroma, flavor, terpenes, effects, tags and search (SEO) text.

The rule that decides everything below, in the owner's words: *"a product should be publish once it has a picture."* A card goes live when it has a photo. Everything else can follow.

This SOP covers the **on-hand** products. The owner: *"so long as the system thinks we have at least 1 lot in stock, we should consider that to be what I mean by 'on-hand'."* Sold-out products wait until every on-hand vendor is done.

Not in scope: prices and stock (the POS owns them and enrichment never changes them), grouping sizes into one card (Product Mastering), and receiving lab certificates (SOP-04).

## 2. Roles & permissions

| Who | What they do here |
|---|---|
| Owner, admin, manager, content editor (`products.enrich`) | Everything in section 4: attach photos, run AI drafts, accept, edit, publish, use the Copilot |
| Owner, admin, manager, content editor (`media.manage`, `src/lib/auth/roles.ts` L103) | Pause, resume and retry the semantic photo index on Digital Assets (4.10) |
| The AI | **Drafts only.** It never attaches a photo, never publishes and never accepts on its own. Every change on the menu is a person's click |

## 3. Before you start

1. The product has been received and approved, so it is on the live menu (stage 4 of Product Intake).
2. AI is set up (owner step; Appendix B). If it is not, every draft button says so and nothing else breaks.
3. For semantic photo search, migration `0365_media_embeddings.sql` has been applied with pgvector on (owner step). Until then the photo matcher still works on names and vendors.

## 4. Procedures

### 4.1 The daily flow (one vendor at a time)

1. Open **Product Intake → Product Enrichment**. The list opens on **On hand** by default.
2. Pick a **Vendor** in the vendor select. The vendor strip shows published, ready, missing copy and missing photo, with a % bar.
3. Press **"Ready to publish"**. Tick **Select every card matching this filter**, read the pre-flight line, and press **Publish**. This clears every draft that already has a photo.
4. Press **Open Copilot session →** on the vendor strip and work the cards (4.4). Cards with no photo come first.
5. For the rest of the vendor's copy, run the AI in bulk: **⚡ Draft now (live)** for today, or **🌙 Add to the overnight batch** before you leave (4.6).
6. Next morning, open **Bulk AI**, filter to the vendor and press **Accept all ≥ 80%** per product (4.7).
7. When the vendor shows 100%, press **Next vendor →**.

### 4.2 Attach a photo (this publishes the card)

1. Open the product. The **Recommended photos** panel shows up to 12 photos, each with a confidence and the reasons (chips such as "Remembered for this product", "Same vendor", "Matches by meaning").
2. Check the photo is this product: the brand, the strain name, the pack size.
3. Press **Attach as cover** (or **Attach**).
4. The card publishes by itself when it was a draft and the photo is published in the library. The page says so. An archived card stays archived.
5. The photo is remembered, so the next card of the same product is offered it first.

If no recommendation is right, upload a photo on the product page, or find one in **Digital Assets** with the search box (it searches by meaning as well as by name).

### 4.3 What "confidence" means, and the 80% rule

Every AI draft carries a confidence and the evidence it used, shown as chips: `pos` (the POS line), `vendor`, `photo:N` (text read off an attached photo), `lot:N` and `coa:N` (lots and lab certificates), `kb:…` (the product knowledge base).

1. A field backed by direct evidence (POS, vendor, photo text, lot or certificate) is **at least 80%**, plus 5 for each further direct source, up to 95. The owner: *"I have noticed there are times where the ai is 100% accurate yet gives itself a 50% confidence result. if you can make it trust itself better would be great."*
2. A **Best guess** rests only on what is normal for the strain family or category. It is capped at 70% and wears a **Best guess** badge.
3. A field with no evidence is capped at 40%.
4. **Accept all ≥ 80%** takes the newest draft per field at or above 80%, **and best guesses too**. The owner: *"best guesses should auto accepted, but flagged so we can take a closer look once we have time to."* Exception: a best-guess **potency** is never taken by Accept all.

### 4.4 The Enrichment Copilot (one card at a time, fastest)

Open from the vendor strip (**Open Copilot session →**), the Bulk AI banner, a product page, or `/admin/products/copilot`.

1. Pick the vendor. The session bar shows "N of M" and what is left.
2. Left column: the product, its lots and lab certificates. Middle: photos on the card, **recommended photos numbered 1–9**, and the pending drafts. Right: the **chat**.
3. Press a number **1–9** to attach that photo (4.2 rules apply; it publishes the card).
4. Press **D** to draft every field now, or **A** to accept all ≥ 80%.
5. Ask the chat anything, for example "Write a short description in our house style" or "What does the label say?". Use **Look closely** on a photo to have the vision model read its label.
6. The chat only **proposes**. Read the proposal, change the words in the box if you want, and press **Use this**. It goes through the same checks as every other accept (compliance re-scan, shape check, effects list).
7. Press **P** to publish and go to the next card (needs a photo, nothing else), **N** for next, **S** to skip (the card moves to the back), **/** to type in the chat.

### 4.5 One product in depth (the product page)

1. **⚡ Enrich now (live, all fields)** drafts name, descriptions, strain type, potency, aroma, flavor, terpenes, effects, tags and SEO in one call.
2. Each draft shows the field, a diff against what is on record, its evidence chips and any **Best guess** badge.
3. **Accept all ≥ 80% + best guesses** takes every qualifying draft at once. Or press **Accept**, or edit the text in its box and press **Save & accept**, or **Reject**.
4. **← Previous · N of M · Next →**, **Save & next →** and **Publish & next →** keep your place in the list you came from.

### 4.6 Live or overnight: which button to press

| | ⚡ Draft now (live) | 🌙 Add to the overnight batch |
|---|---|---|
| When | You are working the vendor now | End of day, many products, no rush |
| Speed | Minutes | Within 24 hours (usually a few) |
| Price | Normal | About half (Google's Gemini Batch API) |
| Where | Bulk AI, product page | Bulk AI, product page |
| Result | Pending drafts | The same pending drafts, stamped "overnight batch" |

Both use the same prompt and the same checks; only the speed and price differ. Overnight work runs on the existing background worker (no new scheduled job).

### 4.7 Bulk AI: accept, edit and publish on the grid

1. Open **Bulk AI** (`/admin/products/bulk-ai`). Filter by **vendor** and **Confidence at least** (Any / 50 / 70 / 80 / 90).
2. Per product: **Accept all ≥ 80%**, or **Accept all ≥ 80% & publish** (publish needs a photo; the flash says why when it does not).
3. Any single draft can be edited in place: change the text, press **Save & accept**. The edited text is re-checked (SEO cleaned, tags kept to the allowed list, effects checked, strain type and potency parsed) and passes the compliance gate.
4. The **failure list** names each product the AI could not draft and why. **Cancel** stops the live queue.

### 4.8 Needs a closer look (best guesses)

1. Product page and Bulk AI show **Needs a closer look**: every best guess that was accepted.
2. When you have time, read each one against the package or certificate.
3. Right: press **Looks right** (it is marked checked and audited). Wrong: edit the field and save.

### 4.9 Strain type and potency from the lot and certificate

1. The AI reads up to 3 of the product's lots (in-stock first) and their lab certificates.
2. A potency number is kept only when a POS, lot or certificate number says it (within 0.05% or 0.5 mg). The AI never invents a number.
3. An accepted strain type or potency is written to the product's own menu cards and marked as checked by a person.

### 4.10 Semantic photo search (Digital Assets)

1. **Digital Assets → Semantic photo search** shows the index status and progress. It builds by itself in the background.
2. **Pause** / **Resume** and **Retry** (for photos that could not be read) are there; each press is audited.
3. A match "by meaning" alone is shown at 35–74% and never reaches High; when the name also matches it gets a lift.

## 5. Messages: "If you see this message"

| Message (or what you see) | What it means | What to do |
|---|---|---|
| "No lab, lot or POS number says X. Check the certificate, then type the number it shows." | The Copilot or a draft proposed a potency no record backs | Read the certificate and type its number |
| Publish is greyed out in the Copilot | The card has no photo | Attach a photo (1–9) first |
| A recommended photo is attached but the card stays a draft | The photo is not published in Digital Assets, or the card is archived | Publish the photo in Digital Assets, or un-archive the card |
| An AI button says AI is not set up | No AI key | Owner step, Appendix B |
| Bulk AI failure list shows a reason | The AI call failed for that product | Fix what the reason says, or draft that product live |
| Semantic photo search says pgvector is not available | Migration 0365 needs pgvector | Owner step, section 3 |

## 6. Exceptions & escalation

1. **Wrong photo already live:** open the product, remove it or attach the right one as cover. Tell the owner if it was live for long.
2. **A health or medical claim in a draft:** reject it. The compliance gate should block it; if one gets through, tell the owner the product and the words.
3. **Strain type or potency disagrees with the certificate:** the certificate wins. Edit the field; tell the owner when the POS is wrong (fix it in the POS).
4. **Anything you are not sure of:** leave it as a draft and add it to the Monday check (8.2).

## 7. Controls & compliance (why the rules exist)

1. **AI drafts, a person decides** (AGENTS.md drafts-only rule). The AI never attaches, accepts or publishes on its own; a person's click does every change, and each is audited.
2. **No medical or health claims** (WAC 314-55-155). Every accept re-scans the text; effects come from an allowed list.
3. **Numbers are never invented.** Potency must match a POS, lot or certificate number.
4. **Price and stock stay POS-controlled.** Enrichment never changes them.
5. **Photo first.** A published card needs a published photo, so shoppers never see a broken picture.

## 8. Checklists & forms

### 8.1 Per-vendor session

| Step | Done |
|---|---|
| Vendor picked, On hand on | ☐ |
| Ready to publish → published | ☐ |
| Copilot: every photo-less card has a photo or is skipped with a note | ☐ |
| Live or overnight drafts queued for the rest | ☐ |
| Accept all ≥ 80% run per product | ☐ |
| Vendor at 100% → Next vendor | ☐ |

### 8.2 Weekly (Monday) closer look

| Step | Done |
|---|---|
| Needs a closer look list worked (Looks right or edited) | ☐ |
| Bulk AI failure list empty or explained | ☐ |
| Semantic photo search not paused, nothing stuck | ☐ |

## 9. Quick reference card

**Rule:** photo = published. Words can come later.

**Copilot keys:** **1–9** attach photo · **A** accept all ≥ 80% · **D** draft now · **P** publish & next · **N** next · **S** skip · **/** chat.

**Confidence:** evidence ≥ 80% · Best guess ≤ 70% (accepted, flagged) · no evidence ≤ 40%.

**⚡ Live** = minutes, normal price. **🌙 Overnight** = within 24 h, about half price.

## 10. Glossary

| Word | Meaning |
|---|---|
| On hand | At least one lot with stock, or the menu says in stock / low stock |
| Draft (card) | Not on the public menu yet |
| Draft (AI) | A proposed field value waiting for a person |
| Best guess | A draft with no direct evidence; capped at 70%, flagged |
| Evidence chip | Where a draft's fact came from (`pos`, `vendor`, `photo:N`, `lot:N`, `coa:N`, `kb:…`) |
| Copilot | The one-card-at-a-time session with a chat |
| Overnight batch | The half-price, within-24-hours AI run |
| Semantic search | Finding photos by meaning, not only by exact words |

## Appendix A: Source map

| Topic | File |
|---|---|
| Accept-all threshold (80) | `src/lib/enrichment/ai-draft-v2-core.ts` L43 |
| Publish on photo | `src/lib/enrichment/publish-on-photo-server.ts`, `bulk-publish-core.ts` |
| Worklist, on hand, vendor strip | `src/lib/enrichment/worklist-core.ts`, `src/app/admin/products/page.tsx` |
| Recommended photos | `src/lib/enrichment/image-recommend-v3-core.ts` |
| All-fields draft | `src/lib/enrichment/ai-draft-v2-core.ts`, `src/lib/ai/all-fields-draft.ts` |
| Lot and certificate evidence | `src/lib/enrichment/lot-evidence-core.ts` |
| Edit in place | `src/lib/enrichment/draft-edit-core.ts` |
| Live vs overnight | `src/lib/enrichment/enrich-batch-core.ts` |
| Semantic photo search | `src/lib/media/media-embed-core.ts`, `supabase/migrations/0365_media_embeddings.sql` |
| Copilot | `src/lib/enrichment/copilot-core.ts`, `copilot-server.ts`, `src/app/admin/products/copilot/` |
| Models | `src/lib/ai/enrich-model-core.ts`, `src/lib/ai/enrich-model.ts` |

## Appendix B: Settings the owner can change

| Setting (Vercel environment) | What it does | Recommended |
|---|---|---|
| `AI_ENRICH_MODEL` | The live drafting model | `gpt-6.1-sol` |
| `AI_ENRICH_REASONING_EFFORT` | How hard a reasoning model thinks | `medium` |
| `AI_COPILOT_MODEL` | The Copilot chat (optional; else the live model) | `gpt-6-astra` |
| `AI_ENRICH_BATCH_MODEL` | The overnight model (optional) | `gemini-4-carbon` |
| `AI_GEMINI_API_KEY` | Needed for the overnight batch and semantic search | Set it |
| `AI_EMBED_MODEL` | The semantic search model (optional) | `gemini-embedding-2` (default) |
| `ENRICH_PUBLISH_ON_PHOTO` | `off` stops publish-on-photo | Leave unset (on) |

## Appendix D: Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | D244 R-6 | First version: photo-first publishing, the 80% rule with best guesses accepted and flagged, the Copilot, live vs overnight, edit in place, lot and certificate evidence, semantic photo search |
