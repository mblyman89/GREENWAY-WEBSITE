# R70 — Merch Studio (Greenway Glass & Goods)

Status: **Slices 1–2 shipped** (R70). **Slice 3 (Proof & Export) and Slice 4 (the shop) are documented in `docs/roadmap/R71-MERCH-PROOF-AND-SHOP.md`.** Builds on the R69 research report (`docs/roadmap/R69-APPAREL-STUDIO-STRATEGY.md`, `docs/research/r69-apparel/notes-raw.md`).

## 1. The owner's request (verbatim core, rule 1)

> "Thank you! I already have a separate merchandising company established, I will paste in the company information later, I don't have the numbers on hand. The company is called Greenway Merchandising LLC, dba greenway glass & goods. Question 2, no do not hide it. Because I have a separate business identity I can sell these products on the main cannabis website. To do this safely, we need to establish a subdomain to host it on. The merch pages will have clear a distinct messages stating that purchases of merchandise are sold through greenway glass and goods, and the checkout process is separate and isolated from the main checkout process. That will allow us to accept credit and debit card payments safely without the credit card companies web crawlers flagging us for illegal cannabis sales via credit card. Also, as an additional safe guard, no apparel will be displayed in the cannabis shop, nor will it deliver any of the merch. With these safe guards in place, we can safely do all the things we want to do on our site without legal scrutiny from the LCB. I will get clarity from a real lawyer, but this is the consensus from my peers in the industry. This is how they all get around this issue. I am a tiny operation with very few employees. I will make every design at first, and then slowly hand off design work to my employees after I am comfortable with that. The point I'm getting at is, I won't be making bulk orders ever, I don't need fancy accounts with wholesalers yet, i was thinking more along the lines of vista print or some other on demand service tailored to higher quality garments and better quality printing methods, something that won't wear off in the washing machine or something like that, I am going for higher quality items because that's what my specific customers asking for this stuff want. So I want to be able to design and create super bad ass cool and creative graphic art designs for my garments. So a brand new custom design studio for designing apparel would be great. A new page listed in the mktg and adv drop down menu called "Merch Studio" … The page should have tabs. It should be clean and organized. It should have all the same types of behaviors from the banner editors, controls and settings and fine tune precision and such. The scrolling preview window, all the little things we worked out how to do right with the banner editors, should be repurposed and used in this new studio. It should be highly tailored and suited and setup for garment design and creation. If a professional studio has it and it's something a real professional from the community would want and need the feature, then we should include it. For now, I just want to build the studio, the full pipeline for creating apparel. If there is a way to incorporate a just in time inventory on hand model where we design stuff, list it on the website, then print and ship one when we get a sale. So having where and how to fulfill a purchase would be awesome to include. Let's jump right in to slice 1, garment catalog and warnings, and slice 2, the design canvas. … Work the full slice, commit and push, then work the second slice, commit and push. Follow the standing rules and never guess, never assume."

## 2. Decisions and why

**Seller of record.** All merch is sold by **Greenway Merchandising LLC (dba Greenway Glass & Goods)**. The studio page says so on top, and every later slice keeps an `entity` on merch records so the books, payments and tax stay apart from the cannabis licensee. The owner is confirming the structure with an attorney. R69 §1 lists the LCB FAQ quotes and the open questions to bring to that attorney.

**Fulfillment partner: Printful print-on-demand (just-in-time).** This fits "never bulk, one at a time, premium, won't wash off":

- Printful prints in its own facilities, so quality is consistent. Printify, by contrast, is a marketplace of third-party printers (R69 notes, "Printful vs Printify").
- It offers DTG, **DTFlex** (its DTF line, the most wash-durable on blends and dark colors), embroidery and 3D puff, all on premium blanks.
- It offers custom inside and outside labels for a private-label finish.
- It has a full order API that supports draft → confirm, so nothing is produced until a person clicks (standing rule: AI and automation produce drafts only).
- VistaPrint is a traditional print service with **no print-on-demand integrations or order API** (merchize.com, Apr 2026), so it can't fulfill one-off web orders automatically.
- Apliiq is a later option for woven labels and patches, but it only integrates with Shopify and Woo.
- Printful's content policy (help.printful.com article 50263862632977) bans only hate/violence, illegal content and IP violations. Cannabis-brand logos are not on the list.

**Curated blanks, not the whole catalog.** Pros say "the blank is half the product" and "don't marry one blank" (R69 §2, §7). Slice 1 seeds 11 premium blanks, with a backup in most categories:

| Category | Blank | Printful id |
|---|---|---|
| Tee | Comfort Colors 1717 | 586 |
| Tee | Bella+Canvas 3001 | 71 |
| Long sleeve | Comfort Colors 6014 | 753 |
| Hoodie | Independent IND4000 | 1543 |
| Crewneck | Comfort Colors 1566 | 839 |
| Zip hoodie | Lane Seven LS14003 | 943 |
| Windbreaker | Independent EXP54LWZ | 629 |
| Snapback | Yupoong 6089M | 99 |
| Dad hat | Yupoong 6245CM | 206 |
| Trucker | Richardson 112 | 422 |
| Cuffed beanie | Yupoong 1501KC | 266 |

**Every number is traceable.**

- Colors, sizes, base prices, placement keys, upcharges, techniques and fabric come from Printful's public catalog API (`garment-colors-data.ts` is generated; see §5).
- Placement inches come from Printful's tee, hat and hoodie guides.
- Where the exact print area sits behind Printful's OAuth-only v2 API or printfiles endpoint (both return 401 without an account), the placement is marked **"Studio default — confirm on Printful's template."** The UI shows that label in gold rather than presenting a guess as fact. Affected: the hoodie front height above the pouch, both zip-front panels, the windbreaker areas and the wrist size. Once the Printful account is connected (Slice 4), these get replaced by the live `placement_dimensions`.

**Rules engine (`print-rules-core.ts`).** It has four levels:

- **Blocker:** will fail.
- **Warning:** will print worse or cost more.
- **Review:** compliance-theme words a person must acknowledge. These are never auto-rejected.
- **Tip:** a pro suggestion.

Each message carries *why*, *fix* and *source*. The numbers and where they come from:

| Rule | Value | Source |
|---|---|---|
| Resolution | 150 DPI minimum, 300 ideal; px ÷ 300 = max inches | Printful/Gelato, French Press Custom |
| Letter height | ≥ 0.25"; beanie 0.25" lowercase / 0.3" capitals | Printful, Gelato |
| Embroidery line | ≥ 0.05" | Gelato |
| Embroidery detail | nothing under 1/16" | Printful hat guide |
| Thread palette | Printful's 15 threads; ≤ 6 colors typical | Printful catalog API |
| Stitch count | 1,200 per sq in fill, 150 per inch satin; per-letter bands of 100/150/200; ±15% on textured fabric | JA Digitizing |
| Hat stitch cap | ~15k | Printful |
| Hat side text | ≤ 10 characters per line | Gelato |
| Inside-label fonts | ≥ 10 pt | Printful |
| Contrast | WCAG 3:1 used as the "will it read" bar | WCAG 2.x |

The engine also checks method availability per placement, fabric/method fit (DTG on low cotton), the dark-garment underbase, obstacles (zipper = blocker; pouch, hood drape and 6-panel center seam = warnings), print-area bounds, gradients, photos and transparency on embroidery, and 3D puff suitability.

Two numbers are **studio heuristics**, labeled as such in code: the 60 sq in "heavy DTF block" tip, and the contrast thresholds of 1.5 and 3.

**Compliance themes.** WAC 314-55-155(2)(a) themes are flagged as **Review**:

- youth appeal
- over-consumption
- alcohol, tobacco and vehicles
- curative claims

Branded apparel acts as advertising, so this keeps the brand clean even though the LLC is separate. Images can't be read, so any image triggers a reminder to review it.

**Permission.** The page uses `content.edit`, the same as Creative Studio, so designers already have access. No new permission was needed, which keeps `roles.ts` unchanged.

**Engine for Slice 2 (design canvas).** An in-house **SVG canvas in real inches** reuses the Banner Studio's proven parts:

- `useStudioDock` (the follow/sticky preview dock)
- `controls.tsx` (NumberSlider, Segmented, ColorField with eyedropper and recents)
- `banner-guides-core` smart snap
- `banner-arrange-core` align, distribute and rotate
- `banner-curve-core` arched text
- the undo/redo history with grouping

Why SVG rather than adding Fabric.js:

- **Zero new dependencies.**
- Real-inch coordinates (`viewBox` in inches), so the rules engine reads the same numbers the designer sees.
- The SVG *is* the vector print file. Slice 3 renders it to a 300-DPI transparent PNG per Printful file type (Printful's requested format). R71 decision: rendering happens **in the browser** (it has the exact fonts and the IndexedDB artwork), not with `sharp` — see R71 §2.1.

Fabric.js stays an option if freehand drawing or path editing becomes a need.

## 3. What Slice 1 delivers

- **Nav:** MKTG & ADV → **Merch Studio** (`/admin/merch-studio`, 👕).
- **Garments tab:** pick a blank, a color (swatches from Printful), sizes with base prices, and a placement table (max area, methods, Printful key and upcharge, obstacles, cited source).
- **Artwork Check tab:** drop in any file. It is read locally and never uploaded. Set the print width, method and placement and see blockers, warnings, tips and reviews, plus a quick text test.
- **Fulfillment & Pricing tab:**
  - The 9-step just-in-time pipeline (who does what, and in which slice it lands).
  - A per-unit profit calculator in cents: Printful base + placement upcharges + puff + Printful shipping + Stripe 2.9% + 30¢ (stripe.com/pricing, read 2026-10-17).
  - A "lowest price for X% margin" suggester.
- **Pure cores with self-tests** registered in `run-pure-selftests.ts` and `tests/compliance/merch-studio-core.test.ts`: `garment-catalog-core` (235 checks), `print-rules-core` (29) and `fulfillment-core` (11).

## 3b. What Slice 2 delivers: the Design tab (the garment canvas)

**Where:** Merch Studio → 🎨 Design (second tab). It uses the same garment and colour selection as every other tab.

**Engine choice: SVG in real inches.** The canvas viewBox is measured in inches of the actual garment. Each print frame is placed from the catalog's cited `topIn` / `centerXIn` and its max width × height (`frameRect` in `garment-views-core.ts`). Because of this, what you see is the size that prints. The garment silhouettes are *illustrative*: they are drawn to typical proportions for each style and are labelled as such in code. The *frame* geometry is exact. It is measured from the reference line Printful uses for each placement: the collar seam for front and back, the shoulder seam for sleeves, and the brim seam for hats. Slice 3 adds Printful's own mockups, so the owner sees real photos before anything sells.

**Why these behaviours (pro-grade, reused from Banner Studio so it feels familiar):**
- **Follow-scroll dock:** the canvas stays in view while you work in the panels below. It has Small/Medium/Large/Full sizes and a remembered setting, the same as the banner editor.
- **Undo/redo:** 60 steps, with rapid edits grouped within 600 ms (one drag = one undo). Keys are Ctrl/⌘+Z, Ctrl+Shift+Z and Ctrl+Y. The keys are ignored while you type in a field.
- **Smart snapping:** snaps to the frame edges and centres and to other elements, with pink guides. Hold Alt to drag freely. A live L/T/R/B readout in inches shows how far the art is from each edge of the frame.
- **Precision:** arrow keys nudge 1/16" (Shift: 1/4"). The Selected tab has exact inch fields, plus quick Centre H/V, Top and Fill-width buttons.
- **Rotate and resize:** the corner you're not dragging stays pinned, even when the element is rotated. Shift toggles aspect lock. Text resizes by changing its font size, so it never stretches.
- **Text is sized by *letter height*.** Screen printers and embroiderers talk in cap height, not points. Text width is **measured in the browser** with the real font, never guessed. Letter height uses a labelled estimate (cap height ≈ 0.70 em). For embroidery, the 0.25" minimum letter height from print-rules is enforced against that estimate.
- **Arched text:** the same curve engine as the banner editor.
- **Embroidery colours:** the colour picker switches to Printful's 15 thread colours. "Snap colours to threads" converts every colour on the side to its nearest thread.
- **Per-side method:** DTG / embroidery / (puff) for each placement, with live blocker/warning/tip checks against the Slice 1 print rules. Rules are fed real inches, ink area, colour count and effective DPI per image. Blockers get a red outline on the canvas. Warnings can be acknowledged per side.
- **Libraries:** the banner editor's icon set (filled weight, so it prints and stitches solidly), object set and shape set, plus text presets (Headline, Wordmark, Arched text, Small tagline) that size themselves to the selected placement.
- **Your own art:** images are sized to their true 300-DPI print size and fitted into the frame. The tool reads image pixels locally to detect colour count and photo/gradient content, which matters for embroidery. SVG is treated as vector (no DPI limit).
- **Preview sub-tab:** every side in every garment colour, with a badge counting low-contrast elements on each colour (the print-rules contrast check).
- **Price estimate:** a Printful estimate for size M updates as you add sides (from Slice 1 `fulfillment-core`).

**Storage (on purpose, for now):** drafts autosave every 700 ms to this browser (localStorage `gw-merch-designs-v1`). Uploaded art is kept in IndexedDB (`gw-merch-assets`), so large files don't hit localStorage limits. Nothing is uploaded yet. Slice 4 moves designs and art into Supabase (private bucket), so they're shared across devices and can be listed for sale.

**Pure cores and tests:** `garment-views-core` (262 checks: every blank, view and placement frame falls inside its view, mirroring, zoom) and `merch-design-core` (42 checks: text sizing, rotated resize, rule bridging, sanitising of stored/imported designs). Both are registered in `run-pure-selftests.ts` and vitest.

## 4. Website menu, subdomain cart and payments — strategy

**Domain shape.** Use `shop.<main-domain>`, or `goods.<main-domain>`, as a **separate Vercel project** (or a separate Next.js app in a multi-zone setup; see Next docs `02-guides/multi-tenant.md` and `multi-zones.md`). It carries its own:

- environment variables
- Stripe keys
- cookies (no shared session or cart cookie, no shared cart table)
- `robots`/sitemap
- legal pages (Greenway Merchandising LLC terms, privacy, returns)

The main site links *to* it with a clearly labeled "Merch — sold by Greenway Glass & Goods ↗" link in the header or footer. Nothing about merch appears inside the cannabis menu, product cards, cart or checkout.

The merch site has no cannabis words or imagery on checkout pages, and its own footer naming the LLC.

> **Risk to flag to the attorney and processor:** a subdomain is still visibly "tethered" to the parent domain (r/ecommerce thread). If the processor objects, the fallback is a fully separate domain. The code should treat the merch site as its own app from day one, so moving it is a DNS change rather than a rewrite.

**Wiring designs to listings (Slice 4).**

1. A design that passes Checks is published as a **merch product**: design version + blank + allowed colors + sizes + retail price + mockups.
2. It is stored in new tables owned by the merch entity (migration `0281_` onward, applied by the owner): `merch_products`, `merch_variants` (Printful `variant_id` per color/size), `merch_print_files`, `merch_orders`, `merch_order_items`, `merch_printful_submissions`.
3. The merch site reads only published merch products. The cannabis menu never queries these tables.

**Cart and checkout (Slice 4).**

- The cart lives on the merch site (its own cookie or local storage).
- Checkout uses **Stripe Checkout** (hosted, PCI handled by Stripe) on the merch site's own Stripe account.
- Stripe Tax or manual WA sales tax handles tax for the LLC.
- On `checkout.session.completed`, the webhook writes a `merch_order` and creates a **Printful draft order** with the exact variant and print files, with the shipping address passed straight through.
- Staff see it in the studio's Orders tab and **click Confirm**. Printful then charges the LLC's card on file and produces the item in 2–5 business days.
- Printful webhooks (`package_shipped`) email tracking to the customer.
- Refunds and reprints are logged per order.

**Payment processor.**

- Open **Stripe under Greenway Merchandising LLC**, apparel only, with an honest business description ("branded apparel and accessories"), its own bank account and its own descriptor ("GREENWAY GOODS").
- Stripe prohibits cannabis products and dispensaries, drug paraphernalia, and undisclosed merchant arrangements. Apparel from a separately owned LLC is not on that list, but **glass and paraphernalia must never go through it**. Sell glass in-store, or use a high-risk processor that underwrites smoke-shop goods.
- Shopify Payments also disallows this niche (R69 research).
- If Stripe declines the account, the fallbacks are a high-risk apparel/lifestyle processor, or selling through Printful-integrated marketplaces (Etsy) while the attorney finalizes things.

## 5. Refreshing the catalog

`src/lib/merch-studio/garment-colors-data.ts` is **generated**. To refresh it from Printful's public catalog (no key needed):

```bash
python3 scripts/merch/refresh-printful-catalog.py
git diff src/lib/merch-studio/garment-colors-data.ts   # review new/removed colours and price changes
npx tsx scripts/compliance/run-pure-selftests.ts       # must still print ALL PURE SELF-TESTS PASSED
```

On 2026-10-17 the generator reproduced the committed file byte-for-byte. Since R71 it also emits `PRINTFUL_FILE_TYPES` (file id → Printful file type), `PRINTFUL_OPTION_IDS` (real item option ids such as `thread_colors_chest_left`) and `PRINTFUL_VARIANTS` (colour, size, variant_id, price cents, in-stock) — used by print-file export and the shop. To add a blank:

1. Find its id with `GET https://api.printful.com/products`.
2. Add the id to `IDS` in the script.
3. Add a `Blank` entry in `garment-catalog-core.ts`, taking placements from `files[]` in `GET /products/{id}`.
4. Re-run the generator.

## 6. Sources (visited October 2026)

- Printful public catalog API: https://api.printful.com/products and https://api.printful.com/products/{id}
- Printful API docs (v1, v2 beta): https://developers.printful.com/docs/
- Printful hoodie logo placement guide (Jul 27 2026): https://www.printful.com/blog/hoodie-logo-placement-guide
- Printful t-shirt placement guide: https://www.printful.com/blog/t-shirt-design-placement-guide
- Printful hat logo size and placement guide: https://www.printful.com/blog/hat-logo-size-and-placement-guide
- Printful print-file content policy: https://help.printful.com/hc/en-us/articles/50263862632977-What-is-Printful-s-print-file-content-policy
- Gelato embroidery design guidelines: https://support.gelato.com/en/articles/8996221-embroidery-design-guidelines
- JA Digitizing, estimating stitch counts: https://www.jadigitizing.com/j-armenta-blog/2017/1/24/estimating-stitch-counts
- French Press Custom, artwork prep: https://www.frenchpresscustom.com/blog/how-to-prepare-your-artwork-for-screen-printing-complete-guide
- Merchize, VistaPrint alternatives (Apr 2026): https://merchize.com/vistaprint-alternatives
- Stripe pricing: https://stripe.com/pricing
- Stripe prohibited and restricted businesses FAQ: https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs
- r/ecommerce, cannabis-themed shop and processors: https://www.reddit.com/r/ecommerce/comments/1i7fblh/help_with_question_about_selling_cannabis_themed/
- WAC 314-55-155: https://apps.leg.wa.gov/wac/default.aspx?cite=314-55-155
- WSLCB Cannabis Advertising FAQ: https://lcb.wa.gov/enforcement/cannabis_advertising_faqs
- WCAG 2.x SC 1.4.11 non-text contrast: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
