# SOP-10 — Product Enrichment: Photos First, AI Drafts, the Copilot and Publishing

| | |
|---|---|
| **Version** | 1.3 (D244 R-14; adds the cure process is not a medical claim, 4.15; 1.2 was D244 R-13 and adds owner round 4: R-11 Remove text queue on the Copilot and Vendor kits #1815, R-12 Bulk AI select and approve #1816; 1.1 was D244 R-10 with round 3; 1.0 was D244 R-6; living document) |
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
   **Facts and AI first, photo last.** Once the card publishes it leaves the worklist and the Copilot session (by design). If there are facts to attach, attach them first, or run the AI (Draft now, then Accept) first, and attach the photo last. The Copilot, Vendor kits and the Remove text editor all show this reminder in gold.
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

**When does the overnight batch start? (D244 R-16)** Not the instant you press. Presses within two minutes of each other are gathered into one batch; the every-minute background worker then sends it on its next free minute (up to 200 products per batch, at most 3 batches open at Google). Google answers within 24 hours, usually a few. The queue box shows the vendors in the batch and how many from each, and when it will leave. To pick many vendors at once, open **Or tick several vendors** and tick them, or tick **Every vendor**. If answers fail, **🌙 Retry the failed in the next overnight batch** puts them back in the queue.

### 4.7 Bulk AI: accept, edit and publish on the grid

1. Open **Bulk AI** (`/admin/products/bulk-ai`). Filter by **vendor** and **Confidence at least** (Any / 50 / 70 / 80 / 90).
2. Per product: **Accept all ≥ 80%**, or **Accept all ≥ 80% & publish** (publish needs a photo; the flash says why when it does not).
3. Any single draft can be edited in place: change the text, press **Save & accept**. The edited text is re-checked (SEO cleaned, tags kept to the allowed list, effects checked, strain type and potency parsed) and passes the compliance gate.
4. The **failure list** names each product the AI could not draft and why. **Cancel** stops the live queue.
5. **Many at once (R-12).** Owner (round 4): *"to be able to select one or all drafts waiting for me to approve. I want this page to auto approve the ones that are over 80%."* Every product in the list has a tick box, and so does every draft. Tick them (or **Select all**) and press **Approve selected**: a ticked product accepts its drafts at 80% or better (best guesses too, flagged); a ticked single draft is accepted as it is. Or press **⚡ Approve every draft at 80%+** and confirm: every product that has one is done in one press. The page works through them a few at a time (8 products per step) and shows *Approving… 40 of 250 products*, then a total. Every draft still passes the compliance re-scan; a blocked one stays for you. Approving never publishes.

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

### 4.11 Know the product before you pick (identity strip)

Owner (round 3): *"Add more details about the product, like its category and type and vendor assigned to it on the details page at the top of the page with its name. Then use that to help the image recommendations and drafting."*

1. The product page opens with the **identity strip** under the name: Category (with its plain type), Inventory type (POS), POS category, Vendor (a link to the vendor card, and how it was found), Brand and Strain. A missing fact shows in orange; it is never guessed.
2. If the vendor is missing or wrong, fix it on the vendor or brand card first. The photo suggestions and the drafts both use it.
3. The photo suggestions use the type: a photo naming this type is lifted ("Same type"), and one naming a *different* type drops ("Different type (vape)"). Drafts are told the type and write for that type only.

### 4.12 Vendor kits: one generic photo for many like-kind products

Owner (round 3): *"Many vendors use the same non labeled images for all their like kind products. I want to be able to sort the vendors by type/ category so I can pick a generic on brand image and add it to all their like kind products that would use this image. I want the ai to help with this."*

1. Product Enrichment → **Vendor kits (one photo, many products) →**, or **Vendor kits** on the vendor strip (`/admin/products/vendor-kits`).
2. Pick the vendor. Choose **Sort by** website category or the POS category the vendor uses (for example Live Resin Cart).
3. Open a group. The photos are ranked for a generic, on-brand picture, and each one says why. A photo with one strain's name printed on it drops.
4. Press **Ask the AI**. The photo reader checks the top 4 photos and says whether each is generic or names one product, quoting the label. It only looks; nothing is attached.
5. Pick the photo. The products with no photo are ticked for you; untick any that should not get it. Choose **Add to gallery** (it becomes the cover only where there is none) or **Make it the cover**.
6. Press **Apply to N products**. Each card gets the photo, and a card with a published photo goes live (4.2).

### 4.13 Remove text from a photo (wrong name or size printed on it)

Owner (round 3): *"I need a way to remove text on a product picture. I want to drag a box over the text, then click a button to remove it."*

1. On the product page, press **✂ Remove text** on a Recommended photo tile (beside Attach / Attach as cover), or **✂ Text** on a gallery photo. A tile whose label names another product says so in orange: *AI: the label names "Gelato" — not this product. Remove that text?*
2. Drag a box over each piece of text you want gone (up to 12), or press **✨ Find the text (AI)**. The AI boxes every piece of text and ticks the ones that name a different product, size or brand, giving the reason. This product's own name and the brand are kept, and **warning or compliance text is always kept**. Untick anything you want to keep.
3. Optional: type what is under the text (for example "black jar label").
4. Press **Remove text**. FLUX Fill repaints only inside the boxes. It takes about 10–30 seconds.
5. Compare **Before** and **After**. If it looks right, press **Attach as cover** (or **Attach to gallery**). If not, press **Try again with different boxes**.
6. The original photo is never changed. The new one is saved in Digital Assets as "… (text removed)". It is a draft when the original was a draft or its rights are pending; publish it there before it can go live.

### 4.14 Remove text from several photos at once (Copilot and Vendor kits)

Owner (round 4): *"I want to draw a box on all product images, then click the remove text button. that way I can quickly queue up several images to feed to flux to fix one after the next."*

1. On the **Copilot** (under the photos) or on **Vendor kits** (under the generic photos), find **✂ Remove text from several photos**.
2. Tick the photos to fix (up to 12). Each opens below with its own picture.
3. On each one, drag a box over the text, or press **✨ Find the text**. Optional: say what is under the text once for all of them.
4. Press **✂ Remove text from N photos** once. FLUX Fill fixes them one after the next; each says *Waiting…*, then *FLUX is removing the text*, then *Done*, with a running total.
5. Compare **Before** and **After** on each. On the Copilot press **Attach as cover** or **Attach**. On Vendor kits press **Use as the kit photo**, check the ticks, then **Apply**.
6. Remember 4.2: facts and AI first, photo last — attaching publishes the product and it leaves the list.

### 4.15 "Cure", "cured" and other words read in context (the cure process)

Owner (round 5): *"I need the word "cure", "cured", and others like it to be a warn only, and the system should allow me to attach facts that use that word. Why? because cannabis is dried and then cured. it is called the cure process."* and *"if we can make the system smarter by looking at the words before and after the word cure, or any of the blocked words for that matter, so it will allow the words if used not in a medical way."*

The compliance check now reads the words around a blocked word before it blocks. It looks at the same sentence, about 4 words before and 5 after.

1. **The cure process is allowed, as a heads-up.** "Hang-dried and slow cured for 21 days", "our cure process", "properly cured flower", "cured resin", "dry and cure". Accept, Save & accept, Approve and Attach facts all go through. The draft shows a heads-up such as *allowed in context: "cured" (the drying-and-curing process)*, so a person still reads it.
2. **A medical use still blocks.** "Cures anxiety", "the cure for insomnia", "cures your blues", "a miracle cure", "cures everything", "a cure-all", "a cure for a bad day". A medical word near "cured" still blocks too: "slow cured and great for chronic pain".
3. **"Cured for" needs a length of time.** "Cured for 21 days" and "cured for at least 3 weeks" pass. "Cured for a patient" blocks.
4. **The same check covers other blocked words** when they are used in an everyday way:
   - "a sweet treat" and "treat yourself"
   - "keep out of reach of children"
   - "store in a safe place"
   - "grown in healthy living soil"
   - "sealed to prevent oxidation"
   - "clean with isopropyl alcohol" and "don't mix with alcohol"

   "Treats stress", "kids love it", "it is safe", "a healthy choice" and "pairs well with alcohol" still block.
5. **If a sentence you need is still blocked,** reword it so the medical word is not in the same sentence. Or tell the owner the exact sentence, so the word list in `src/lib/ai/compliance-patterns.json` (`contextRules`) can be updated.

## 5. Messages: "If you see this message"

| Message (or what you see) | What it means | What to do |
|---|---|---|
| "No lab, lot or POS number says X. Check the certificate, then type the number it shows." | The Copilot or a draft proposed a potency no record backs | Read the certificate and type its number |
| Publish is greyed out in the Copilot | The card has no photo | Attach a photo (1–9) first |
| A recommended photo is attached but the card stays a draft | The photo is not published in Digital Assets, or the card is archived | Publish the photo in Digital Assets, or un-archive the card |
| An AI button says AI is not set up | No AI key | Owner step, Appendix B |
| Bulk AI failure list shows a reason | The AI call failed for that product | Fix what the reason says, or draft that product live |
| Semantic photo search says pgvector is not available | Migration 0365 needs pgvector | Owner step, section 3 |
| "FLUX is not set up (Settings → Integrations), so text cannot be removed yet." | No FLUX key | Owner step: add the BFL key in Settings → Integrations |
| "The boxes cover most of the picture. Draw them tighter around the text." | The boxes cover more than 60% of the photo | Draw smaller boxes around the words only |
| "Saved to the media library as a draft" after Remove text | The original photo was a draft or its rights are pending | Publish the new photo in Digital Assets once the rights are clear |
| A queue photo says *Failed* with a reason | FLUX refused or timed out on that one photo | Press **✂ Remove text** again; only the failed and unfinished photos are sent |
| "Skipped N (compliance re-scan or unreadable) — review those by hand." after Approve | Those drafts did not pass the compliance re-scan | Open the product, edit the draft, then Save & accept |
| *allowed in context: "cured" (the drying-and-curing process)* (heads-up) | The word is used in its everyday sense (4.15) | Read it, then accept; nothing is blocked |
| "Blocked by the WA I-502 compliance re-scan" on a draft that only says "cured" | A medical word is in the same sentence, or "cure for" has no length of time (4.15) | Move the medical word out of that sentence, or say "cured for 21 days" |
| The product vanished from the Copilot right after a photo | It published (by design) | Open it from Product Enrichment to add facts later |
| An orange **Vendor** in the identity strip | No vendor could be found for this card | Set the vendor on the brand or vendor card |

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
6. **Edited photos are new photos.** Remove text never changes the original. The copy records where it came from (`text-removed:<id>`), keeps the original's rights status, and is audited (product.remove_text_found / _started / _saved).
7. **Vendor kits re-check the vendor.** Apply only touches cards that belong to the chosen vendor, never duplicates a photo, and writes one audit row per card plus product.vendor_kit_applied.
8. **Bulk approve is a person's press.** Select and approve never runs on its own (no cron). It uses the same 80% rule and compliance gate as one-by-one Accept, writes an audit row per product (`via: "bulk-select"`), and never publishes.
9. **Words are read in context (D244 R-14).** A blocked word used in its everyday sense, such as the cure process, becomes a heads-up. The word is never hidden, and a medical word in the same sentence still blocks. The site and the crawler run the same word lists from one file (`src/lib/ai/compliance-patterns.json`, patterns version 4).

## 8. Checklists & forms

### 8.1 Per-vendor session

| Step | Done |
|---|---|
| Vendor picked, On hand on | ☐ |
| Ready to publish → published | ☐ |
| Vendor kits: each like-kind group with a generic photo applied | ☐ |
| Copilot: every photo-less card has a photo or is skipped with a note | ☐ |
| Live or overnight drafts queued for the rest | ☐ |
| Accept all ≥ 80% run per product (or ⚡ Approve every draft at 80%+ on Bulk AI) | ☐ |
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

**Same photo for many?** Vendor kits → vendor → group → Ask the AI → Apply. **Wrong name on a photo?** ✂ Remove text → Find the text → Remove text → Attach as cover. **Many photos?** Tick them → box each → ✂ Remove text once.

**"Cured" is fine** (the cure process, a heads-up). "Cures anxiety" still blocks. **Facts and AI first, photo last** (a photo publishes and the product leaves the list). **250 drafts at 85%?** Bulk AI → ⚡ Approve every draft at 80%+.

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
| Identity strip and type evidence | `src/lib/enrichment/product-identity-core.ts` |
| Vendor kits | `src/lib/enrichment/vendor-kit-core.ts`, `src/lib/enrichment/vendor-kit-server.ts`, `src/app/admin/products/vendor-kits/page.tsx` |
| Words read in context (cure process) | `src/lib/ai/compliance-context-core.ts`, `src/lib/ai/compliance-patterns.json` (`contextRules`), `src/lib/ai/compliance.ts`, `crawler/app/compliance.py` |
| Remove text queue (several photos) | `src/components/admin/products/RemoveTextQueue.tsx`, `src/components/admin/products/remove-text-queue-actions.ts` |
| Bulk approve (select one / all, 80%+) | `src/lib/enrichment/bulk-approve-core.ts`, `src/app/admin/products/bulk-ai/BulkApproveBar.tsx`, `src/app/admin/products/bulk-ai/approve-actions.ts` |
| Remove text (vision finds, FLUX Fill removes) | `src/lib/enrichment/text-erase-core.ts`, `src/lib/enrichment/text-erase-server.ts`, `src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx` |

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
| 1.1 | D244 R-10 | Owner round 3: the identity strip and type evidence (4.11), Vendor kits (4.12), Remove text with FLUX Fill and the AI text finder (4.13); new messages, controls 6–7, checklist row, quick-reference lines and source map rows |
| 1.2 | D244 R-13 | Owner round 4: Remove text from several photos at once on the Copilot and Vendor kits (4.14); "facts and AI first, photo last" (4.2); Bulk AI select one / all and ⚡ Approve every draft at 80%+ (4.7 step 5); new messages, control 8, checklist, quick-reference lines and source map rows |
| 1.3 | D244 R-14 | Owner round 5: "cure", "cured" and other blocked words are read in context (4.15). The cure process is a heads-up, not a block; a medical use still blocks. New messages, control 9, quick-reference line and source map row |
