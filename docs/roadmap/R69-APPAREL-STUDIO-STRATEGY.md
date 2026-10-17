# R69 — Apparel Creative Studio: Research, Recon & Strategy Roadmap

Prepared October 17, 2026 for the Greenway owner. Research phase only — nothing in this document has been built yet. Raw research notes live beside this file in `docs/research/r69-apparel/notes-raw.md`.

---

## 0. The short version (read this first)

You asked for an enterprise-grade design studio for shirts, sweatshirts, jackets, hats and beanies — one that makes genuinely great wearables rather than "a logo on a shirt," that coaches whoever is using it with tips and warnings the way a veteran printer would, and that carries the job all the way from a blank garment to a submitted production order. After researching what print shops, streetwear founders, garment distributors, print-on-demand companies and Washington regulators say, the answer is that this is very buildable, much of the foundation already exists in our back office, and there is one thing that has to be settled before anything else: **who is legally allowed to sell the clothing.**

Washington law says a licensed cannabis retailer may sell only cannabis, cannabis products and paraphernalia. The Liquor and Cannabis Board's own advertising FAQ says it in plain words: "A licensee is not permitted to sell t-shirts from their retail store or business website. A separate business is necessary." The same FAQ says a separate LLC operating nearby *can* sell branded merchandise, that soft goods may be sold from a "parent" website, and that employee uniforms with the store logo are fine. Since July 4, 2026 the updated advertising rule (WAC 314-55-155) also bans giving away branded or unbranded merchandise as a promotion. So the studio must be designed from day one around a **separate apparel business (its own LLC and its own sales channel)**, with the dispensary using the studio only for **staff uniforms** and for designing goods that the separate business sells. That decision shapes the data model, the storefront, and the order pipeline, which is why it leads this report. We also found that the current website already sells Greenway merch through the dispensary storefront cart (`src/lib/merch/merch-catalog.ts`), which on its face conflicts with the LCB's guidance; we recommend hiding it until a cannabis attorney signs off.

On the product side, the recommendation is a **hybrid production model** with one studio feeding three "production lanes": print-on-demand through **Printful's v2 API** for zero-inventory one-offs and online sales; **wholesale blanks from SanMar or S&S Activewear delivered to a local Washington decorator** for bulk runs (screen print, embroidery, DTF) where margins are much better; and later, optionally, **in-house DTF** if volume justifies it. The studio itself should be a new true-canvas editor built on **Fabric.js** (because it can export vector print files, which the current banner studio cannot), wrapped in the same panels, brand kit, Digital Assets library, AI image tools and undo system our team already knows from the banner studio. Underneath sits a **rules engine** that knows the physics of each decoration method — resolution, minimum line weight, thread colors, stitch counts, ink colors, seams, zippers, hat curvature — and warns the designer before a bad file ever reaches a printer.

The rest of this document explains why, in plain English, and ends with a phased build plan and a short list of decisions only you can make.

---

## 1. Legal and business structure — the foundation everything else sits on

### 1.1 What the law actually says

Three sources matter, and they agree with each other.

The statute, **RCW 69.50.357(1)(a)**, says retail outlets may sell only cannabis, cannabis products and paraphernalia, with penalties of up to $1,000 per violation. Clothing is none of those three things.

The **LCB Cannabis Advertising FAQ** (lcb.wa.gov/enforcement/cannabis_advertising_faqs) applies that statute to merchandise directly. The relevant answers, quoted:

- "A licensee is not permitted to sell t-shirts from their retail store or business website. A separate business is necessary."
- "Neither selling nor giveaways of branded merchandise are permissible."
- Asked whether a separate entity — a separate LLC operating close by — could sell branded merchandise, the answer is "Yes."
- Asked about selling t-shirts and hoodies from a "parent" website: "You may sell the soft goods from the parent website. The paraphernalia must be sold from the licensed location."
- Employee uniform shirts bearing the store logo are acceptable (internal use, not sold).
- Branded paraphernalia (stash jars, pipes and similar items) carrying the store logo is acceptable.
- Cross-promotion with a neighboring business, including t-shirts, is acceptable.
- A cannabis leaf may appear in a logo, but not as imagery on signage or advertising.

The advertising rule, **WAC 314-55-155** (as amended effective July 4, 2026), adds the content rules. Subsection (5) bans promotional giveaways of branded or unbranded merchandise, other than incidental paraphernalia worth under a dollar. Subsection (2)(a) bans content that appeals to people under 21 (cartoon characters, toys and similar), that promotes over-consumption, or that depicts alcohol, tobacco, vehicles, or curative or therapeutic claims. Subsection (2)(c) requires "21+" on advertising, and subsection (7) requires the four standard warnings, at no less than 10% of the largest type, on most advertising (outdoor advertising is handled differently, and depictions of the plant or product are banned there).

### 1.2 What this means in practice

The clean, defensible structure is a **separate apparel company** — call it "Greenway Apparel LLC" for this document — that owns the apparel inventory, takes the money, and sells through its own storefront (its own domain, or a clearly separate "parent brand" site, or a POD-connected shop). The dispensary licensee never sells clothing, never gives it away as a promotion, and never rings it up on the cannabis POS. The licensee *may* use the studio to design **employee uniforms** (internal, not sold) and **branded paraphernalia** (which it can sell in-store).

Anything the apparel company sells should also follow the spirit of the advertising rule, because a Greenway-branded hoodie walking around town is, functionally, Greenway advertising. That means no cartoon or youth-appeal art, no over-consumption jokes, no alcohol/tobacco/vehicle imagery, no health claims, and caution with leaf imagery. The studio's warning engine (Section 10.3) will check for these themes and flag them, but a person makes the final call.

### 1.3 Questions for a cannabis attorney (do this before Phase 3)

The research is clear on the headline rule, but several specifics deserve a professional opinion: whether the apparel LLC may share owners with the licensee and whether that triggers any LCB disclosure or "true party of interest" considerations; whether the apparel LLC may use the "Greenway" name and logo under a license agreement; whether the apparel storefront may link to or from the dispensary website, and in which direction; whether the apparel business may operate in, or share space with, the licensed premises (the FAQ example describes a business "close-by"); whether one back-office software system can serve both entities if the books, inventory and payments stay strictly separate; and whether the existing storefront merch listings should be removed immediately. The roadmap below is designed so that every one of those answers can be accommodated without rework, because every apparel record carries an `entity` and a `channel`.

### 1.4 The existing merch in the storefront

Recon found `src/lib/merch/merch-catalog.ts`, a static catalog of Greenway-branded apparel modeled as menu items in the category "merch" and sold through the regular dispensary cart, product cards, product detail page and checkout (wired into `MerchProductCard`, `MerchDetailPanel`, `InteractiveMenuBrowser` and `menu/products/[id]`). Read literally, the LCB FAQ says this is not allowed on the licensee's business website. **Recommendation:** in the first build slice, add an owner-controlled switch that hides merch from the dispensary storefront (default: hidden) until the attorney weighs in. Nothing is deleted; it can be re-pointed to the apparel company's channel later.

---

## 2. What the pros, the community and the suppliers say

We read printer guides, decorator blogs, supplier documentation, print-on-demand developer docs and community threads. Rather than repeat each source, here are the themes that came up again and again, because these are the lessons the studio should bake in.

**Professional decorators** (French Press Custom, ScreenPrinting.com/Ryonet and Superior Ink, Printful's and Gelato's own design guides) consistently say that most bad apparel is caused before printing, by artwork that ignores the decoration method. The same complaints come up everywhere: low-resolution images enlarged until they're blurry; text smaller than a quarter inch; hairline strokes that vanish or that embroidery can't sew; gradients sent to embroidery; too many colors for screen printing; designs placed over seams, zippers or pockets; and logos too big for a hat front. Their second big theme is that **the blank is part of the product**: premium brands care about drape, cut, fabric weight and hand feel, and about finishing details (private-label neck tags, hem tags, folding and bagging) as much as about the print itself. Their third theme is process: written proof approval before production, realistic capacity-based lead times, and quality-control checkpoints.

**The streetwear and small-brand community** (r/streetwearstartup and similar) repeats a different set of lessons, mostly painful ones: people over-order the wrong sizes, pick cheap blanks that feel cheap, launch too many designs at once, skip samples, and under-price once shipping and returns are included. The consensus advice is to start with a small, tight collection on one or two great blanks, order a physical sample before any bulk run, use real size-curve data, and treat the first drop as a learning exercise. Community members also warn against relying on a single blank style, a point that became very real this year (see the Bella+Canvas change below).

**The garment suppliers** (SanMar, S&S Activewear) mainly emphasize integration and stock: their catalogs and live inventory are available electronically, orders can be placed electronically, and blanks can drop-ship straight to a decorator. The 2026 headline is that **SanMar completed its acquisition of Bella+Canvas in late June 2026 and is now its exclusive national wholesaler**, with S&S selling through only its remaining Bella stock. The industry lesson (RVA Threads, July 2026) is "don't marry one blank": always keep an equivalent backup style from a different mill and distributor.

**Print-on-demand companies** (Printful, Printify, Gelato) emphasize file specifications, placement templates and automation. Printful in particular publishes exact print areas, technique options (DTG, embroidery, DTF, sublimation, cut-and-sew), thread palettes, 3D-puff options, and an API that can generate mockups, estimate costs and submit orders.

---

## 3. Decoration methods, explained plainly

There are six ways to put a graphic on a garment that matter for us. Each has a "sweet spot," and the studio must know them, because the method determines what artwork is allowed.

**Screen printing** pushes ink through a mesh stencil, one screen per color. It is the standard for bulk because each extra shirt is cheap once the screens exist, but every color adds a screen and setup cost, and a white "underbase" layer under bright colors on dark shirts counts as an extra color. Shops typically require about 36 pieces minimum. French Press Custom's published 2026 pricing for a one-color front print runs about $3.77 per piece at 100–199 pieces and about $2.17 at 450–999 (decoration only, garment extra), with roughly two to three weeks of turnaround after proof approval. Screen printing is also the gateway to the "fancy" specialty inks covered in Section 4.

**DTG (direct-to-garment)** is an inkjet printer for shirts. It prints full-color photographs and gradients with no setup, so it suits one-offs and short runs. It feels softest on 100% cotton, needs a pretreatment spray, and its white ink on dark garments is weaker than other methods. Print-on-demand companies use it heavily. French Press pricing runs from roughly $15 per piece at very low quantity down toward $5 at volume, with no minimum.

**DTF (direct-to-film)** prints the design onto a film, coats it with adhesive powder, and heat-presses it onto the garment. It works on nearly any fabric (cotton, polyester, blends, nylon jackets, hats), gives the brightest color on dark garments, and is very durable, at the cost of a slight "transfer" feel. Designs can be "gang sheeted" (many small designs packed onto one film) to save money. Published pricing runs about $4.50 down to $2.20 per piece plus a setup fee of around $15. Pressing is typically at 300–330°F.

**Embroidery** sews the design with thread. It is the premium choice for hats, beanies, jackets, polos and left-chest logos. The art must first be "digitized" (converted into a stitch file), which is a one-time fee per design. Embroidery has hard physical limits: lettering under about a quarter inch becomes unreadable, lines under roughly 0.05 inch can't be sewn, about six thread colors is typical, stitch counts above roughly 15,000 get expensive and stiff, and gradients and distressed textures don't translate. Typical minimums are around 24 pieces at contract shops. **3D puff embroidery** sews over a foam layer to create raised, bold letters; it only works for chunky shapes.

**Heat-transfer vinyl (HTV)** is cut from colored sheets and pressed on. Pros use it almost exclusively for names and numbers (personalization), not for art.

**Sublimation and all-over print (AOP)** dyes the fabric itself and only works on light-colored polyester. Printful's "cut-and-sew" AOP prints the fabric panels before the garment is sewn, allowing edge-to-edge designs.

The rule of thumb the industry converges on, and which the studio's method advisor should apply by default, is: **under ~36 pieces on cotton → DTG; dark garments, polyester, nylon or hats with full-color art → DTF; 36–50+ pieces with limited colors → screen print; logos on hats, beanies, jackets and chest placements → embroidery; names and numbers → HTV; edge-to-edge prints on polyester → sublimation/AOP.**

| Method | Best for | Minimum | Color limits | Feel | Watch-outs |
|---|---|---|---|---|---|
| Screen print | Bulk runs, bold graphics, specialty inks | ~36 pcs | Each color = a screen (+ underbase on darks) | Plastisol noticeable; water-based/discharge soft | Fine gradients need halftones; setup per color |
| DTG | One-offs, photos, gradients | None | Unlimited | Softest on cotton | Weaker on darks; needs cotton; pretreat |
| DTF | Any fabric, darks, hats, jackets | None (gang sheets) | Unlimited | Slight film feel | Big solid areas feel heavy — knock out |
| Embroidery | Hats, beanies, jackets, chest logos | ~24 pcs (contract) | ~6 threads typical | Premium, textured | Min ¼" text, 0.05" lines, ~15k stitches, no gradients |
| HTV | Names/numbers | None | Solid per layer | Smooth vinyl | Not for detailed art |
| Sublimation/AOP | All-over polyester | Varies | Unlimited | Zero feel | Light polyester only |

---

## 4. "Fancy graphics" — how pros make apparel that doesn't look like a logo slapped on a shirt

You said you don't want plain things with a logo. The research shows that what separates premium apparel from promotional merch is mostly **technique, layering and finishing**, not just the drawing. These are the tools the studio should expose as first-class options, each with its own guidance.

**Specialty screen-print inks.** Plastisol is the opaque, durable baseline. **Water-based** ink soaks into the fabric for a soft, vintage feel and looks best on light garments (about $0.50–$1 extra per color per piece). **Discharge** ink chemically removes the shirt's dye and replaces it with pigment, giving a zero-feel print that looks woven-in on dark cotton; it only works on reactive-dyed cotton (not polyester, and not white) and results vary by garment, so a test print is recommended. **Puff** ink rises when cured into a raised 3D texture, only for bold shapes and text (about $1.25–$2 per location). **High-density** ink gives sharp-edged raised prints popular in streetwear. **Metallic** (about $2–$4), **foil** (about $3–$5), **glow-in-the-dark** (about $1–$1.50) and **suede** finishes round out the menu. Pros frequently **combine** them: a soft discharge body with one plastisol "pop" color, a flat print with a puff accent, or water-based art with a metallic spot.

**Embroidery techniques.** Flat embroidery, 3D puff, tonal embroidery (thread the same color as the garment, for a subtle luxury look), and applique (fabric cut-outs sewn on).

**Patches** are a huge part of hat and jacket design. **Embroidered** patches are classic. **Woven** patches hold very fine detail, almost photographic. **PVC/rubber** patches are raised, weatherproof and modern. **Leather** (debossed or laser-engraved) patches are premium and pair well with trucker and outdoor hats. **Chenille** patches give the fuzzy varsity look. **Sublimated** patches print full-color art. **Hook-and-loop (velcro)** patches are swappable.

**Placement creativity.** Premium brands use more than the front: back-neck hits, sleeve prints, hem hits, inside-neck prints instead of tags, side-panel and back-arch hat text, and oversized back prints with a small front chest hit. Printful offers inside and outside labels (about 3"×3", outside label about $2.49) for a private-label finish.

**Art techniques that print well.** Halftones (dots instead of gradients), distressing (designed for print, not for embroidery), knock-outs (letting the shirt color show through to save ink and soften the feel), limited spot-color palettes, and typography lockups. The studio should include ready-made, print-safe versions of these effects so designers get the look without breaking the rules.

**AI-assisted artwork.** We already have Flux, Midjourney and Canva integrations in the marketing studio. The apparel studio should reuse them to generate concept art, but always route the result through the rules engine (resolution, color count, method fit), and offer "vectorize" and "reduce to N colors" steps, because raw AI images are usually low-resolution, full of gradients, and unsuitable for screen printing or embroidery as-is.

---

## 5. The artwork rulebook (what the studio will enforce)

This is the condensed version of every file-spec guide we read (Printful, Gelato, French Press Custom and others). These become the rules in the warning engine.

**Resolution.** Raster art must be at least 300 DPI at the final printed size for screen printing and DTF; Printful and Gelato accept 150 DPI minimum for DTG/embroidery uploads. The simple math pros use is *pixels ÷ 300 = the largest size in inches it can print sharply* — a 12-inch-wide print needs 3,600 pixels across. Never upscale a small image; it just becomes a big blurry image.

**File type.** Vector is preferred (AI, then EPS, SVG, PDF), then a high-resolution PSD or transparent PNG. Files should be in sRGB for digital print. Text must be converted to outlines or embedded. Effects (shadows, glows, transparency) must be flattened or rebuilt as spot colors for screen printing.

**Text and lines.** Minimum text height is about a quarter inch (roughly 18 point) for print and embroidery; for beanies, Printful suggests at least 0.25" for lowercase and 0.3" for uppercase. Minimum line weight for embroidery is about 0.05".

**Colors.** Screen print colors should be specified as Pantone spot colors; each color costs a screen, and white underbase counts. Embroidery usually tops out around six thread colors and must use the thread palette of whoever stitches it (Printful publishes its palette in the API).

**Embroidery specifics.** No gradients, no photographic detail, no distressed textures. Large filled backgrounds explode the stitch count — use outlines or a patch instead. Hooping slightly shrinks the design, so make it a touch larger. Side and back hat text should be about ten characters per line or less.

**Physical obstacles.** No ink or thread over seams, zippers, pockets, drawstring holes, hoodie pouches, or (for hats) the center seam of six-panel caps without accounting for it. Avoid embroidery on trucker mesh backs.

---

## 6. Placement charts (where things go, and how big)

These are the real-world sizes the studio's garment templates will draw as safe zones. Sizes vary by brand and by garment size, so the studio stores them per blank and per size, but these are the defaults the pros publish.

### 6.1 T-shirts, long sleeves, sweatshirts

| Placement | Typical size | Position |
|---|---|---|
| Left chest | 2.5"–5" square (embroidery max ~4"×4") | ~3" below the neckline, ~2" in from the armpit |
| Center chest | 6"×6" to 10"×8" (8"×8" most common) | 3"–3.5" below the collar |
| Full front | 12"×16" (some to 15"×18") | 3"–4" below the collar |
| Large embroidery front | up to ~10"×6" | centered |
| Back | 10"×12" to 12"×16" (screen up to ~14"×17") | 3"–5" below the collar |
| Sleeve | ~4"×3.5" | upper sleeve |
| Inside/outside label | ~3"×3" | back neck |

On hoodies, the front pouch pocket and drawstring holes shrink the usable center-front area, and the hood seam constrains back-neck placements. On zip hoodies and jackets the zipper splits the front, so chest placements move left or right of it and full-front art usually goes on the back instead.

### 6.2 Headwear

| Style | Front width | Front height | Notes |
|---|---|---|---|
| Structured cap | 4"–5" | ≤2.25" | Center 0.5"–1" above the brim; use 80–90% of width |
| Trucker | ≤5" | ≤2" | Don't embroider the mesh back |
| Dad hat (unstructured) | 3.5"–4" | 1.75"–2" | Soft crown — keep designs simpler |
| Bucket | ~5" wide | — | Front panel curves |
| Beanie (cuff) | ~5" | 1.75"–2" | Min lowercase 0.25", uppercase 0.3" |
| Side panel | 2"–2.5" | 1"–1.25" | ≤10 characters per line |
| Back (above strap) | 2.25"–3" | 0.75"–1" | Arch text is common |

### 6.3 Jackets

Jackets vary more than any other category (nylon coaches jackets, canvas work jackets, fleece, softshell), so the studio will store each jacket blank's own print areas. General guidance: left-chest embroidery or a patch on the front, large print or embroidery on the back yoke, DTF rather than screen print on nylon and water-resistant fabrics (and DTF or embroidery for canvas), and never over seams, snaps or zippers.

---

## 7. Choosing blanks (the garments themselves)

The pros agree that the blank is half the product. We recommend the studio launch with a curated list of proven blanks per category, each paired with a backup from a different mill and distributor, and keep that list editable by you.

For **t-shirts**, the decorator favorites are Comfort Colors 1717 (heavy, garment-dyed, vintage feel), Next Level 3600 (soft, retail fit), Gildan 5000/64000 (budget workhorses), and Bella+Canvas 3001 (retail fit — now SanMar-only nationally after the acquisition). American Apparel 2001 and Next Level 6010 are common alternatives. For **sweatshirts and hoodies**, the familiar names are Independent Trading Co. (popular with streetwear brands), Comfort Colors garment-dyed fleece, and Gildan 18500 at the budget end. For **hats**, Richardson 112 (trucker), Yupoong/Flexfit 6245CM (dad hat), Yupoong 6089 (snapback) and Flexfit 110 come up constantly as the best embroidery bases, because their structured crowns don't warp under stitching. For **beanies and jackets**, the studio should start with a short list chosen during Phase 1 from whatever the chosen decorator and distributor stock reliably; those categories vary most by supplier, and we did not want to lock in names without checking current availability.

Two cautions came from the research. First, **keep a backup for every hero blank** — the Bella+Canvas distribution change is exactly the scenario that hurts brands with one blank. Second, **order samples**: fabric weight, true color and fit can't be judged from a screen.

---

## 8. How the clothing actually gets made — production lanes

There are three realistic ways to turn a finished design into physical goods. The research strongly suggests using more than one.

### 8.1 Lane A — Print-on-demand (Printful first)

A print-on-demand (POD) company holds blank inventory, prints each item when it's ordered, and ships it. You hold no inventory and take no size risk. **Printful** runs its own facilities, has consistent quality, offers about 370+ products, branding extras (inside labels, pack-ins), roughly 2–5 day production, and a well-documented **v2 API**: browse the catalog and variants, see print techniques (DTG, embroidery, DTF, sublimation, cut-and-sew), placements and their options (thread colors, 3D puff, conflicting placements), generate mockups (asynchronously, with a webhook when done), estimate costs and shipping, create orders as drafts and then confirm them, and receive webhooks for stock, price, order and shipment changes. The limit is about 120 requests per minute. **Printify** is a marketplace of independent print providers with a far larger catalog and much lower base prices (a Gildan 64000 is about $6.21 there versus about $12.95 at Printful), but quality varies by provider. Printful and Printify announced a merger in late 2024 but still operate as separate brands. **Gelato** produces locally in 34 countries.

The weaknesses are margin (POD unit costs are two to four times bulk costs) and creative range (no specialty inks, limited techniques). One important legal detail: **Printful's Terms of Service (section 4.6) say Printful's mockups may only be used to sell Printful products**, and v1 mockup image links expire after 72 hours. So we must store mockups ourselves, and we need our own mockup renderer for anything not made by Printful.

**Best use:** online sales for the apparel company, one-offs, testing designs before committing to bulk, and long-tail sizes.

### 8.2 Lane B — Wholesale blanks + a local decorator (bulk)

For runs of a couple dozen or more, the economics change completely. Blanks are bought wholesale from **SanMar** or **S&S Activewear** and shipped directly to a local screen printer or embroiderer, who decorates and delivers. This is how most brands make their core inventory, and it unlocks every specialty technique in Section 4.

Both distributors can be automated. **S&S Activewear** offers a modern REST API (products, live inventory, pricing, orders with instant confirmation, tracking), plus FTP/EDI and PromoStandards. **SanMar** offers PromoStandards web services, flat-file FTP (Integration Guide v23.4) and its own SOAP web services (Web Services Integration Guide v24.3, PO Integration Guide 24.3); account setup goes through sanmarintegrations@sanmar.com. Both require a wholesale account, which the apparel LLC would hold.

The decorator side is usually not automated: most local shops accept a work order (PDF tech pack plus print-ready files) by email or through their own portal, and many run shop software such as Printavo. So the studio should produce a professional **work order / tech pack** the decorator can act on without a single follow-up question, and track the job's status manually or via email updates.

**Best use:** core inventory, staff uniforms, events (subject to the giveaway ban), anything with specialty inks, embroidery runs, hats.

### 8.3 Lane C — In-house DTF (optional, later)

A small DTF setup (printer, powder shaker, heat press) lets a shop make full-color transfers on demand for any fabric. It is the most accessible in-house method, but it adds equipment, maintenance, space and labor, and it raises a legal question if done on the licensed premises. **Recommendation:** don't plan for it now; revisit once Lanes A and B show real demand. The studio's DTF gang-sheet export (Phase 5) keeps this option open, and it also lets us buy pre-printed DTF transfers from transfer vendors and press them ourselves.

### 8.4 How the studio chooses a lane

The order builder will recommend a lane per order based on quantity, technique and garment: tiny or mixed-size online orders go to Lane A; anything over a threshold you set (we suggest 24 for embroidery and 36 for screen printing), or anything using specialty techniques, goes to Lane B. The designer can always override.

---

## 9. Build versus buy

Off-the-shelf shop management software exists — Printavo (about $109–$244+ per month plus per-user fees), DecoNetwork (about $169–$349+ per month, with online stores and a 3D design lab), YoPrint, InkSoft (online stores and a design studio), and newer entrants such as The Print Life (flat $49 per month, with one-click purchase orders to SanMar, S&S and AlphaBroder). These tools are built for **print shops that sell decoration services to many customers**. We are the opposite: a **brand that designs its own goods** and outsources production. Their pricing matrices, press scheduling and customer portals mostly don't apply, and none of them integrates with our inventory, brand kit, Digital Assets library, AI tools or permissions.

**Recommendation:** build the studio in our back office (as you asked), but **borrow the proven ideas** these tools share: per-decoration pricing matrices (colors × quantity × locations), a proof-approval step that automatically advances job status, blank purchasing grouped by supplier and sorted by size, multi-decoration orders on one document, a mockup studio and a DTF gang-sheet builder. If you later choose a local decorator who runs Printavo or similar, our work orders should drop cleanly into their process.

---

## 10. Recon — what we already have and can reuse

We reviewed the website and back-office editors to avoid rebuilding anything that exists. The good news: a lot of the "studio" experience already exists. The important finding is about how the current studio draws.

**The Banner Studio** (`src/components/admin/banner-studio/*`, about 2,000 lines across the main panels) is a polished editor with a live canvas, layers panel, arrange bar (align/distribute/order), text box panel with effects and curved text, image panel with image effects, shape panel, warnings panel, media library picker, a docked tool layout (`useStudioDock`), keyboard nudging, smart snap guides with equal-spacing readouts (`src/lib/cms/banner-guides-core.ts`), curve math (`banner-curve-core.ts`), arrange math (`banner-arrange-core.ts`), and an undo/redo history that groups rapid changes. However, it renders using **HTML and CSS**, not a drawing canvas — which is exactly right for website banners and wrong for print files, because a printer needs a high-resolution PNG at 300 DPI or a vector SVG/PDF at exact physical inches. **So the apparel studio needs a new true-canvas engine, but it can reuse the Banner Studio's panels, interaction patterns, guide math, curve math, history model and look-and-feel**, so the team feels at home immediately.

**The Brand Hub** (`src/components/admin/brand/BrandHubEditor.tsx`, `ColorWheel.tsx`, `src/lib/brand/brand-kit-core.ts`) already stores brand colors, presets, logos and saved designs. The apparel studio will read logos and colors from it and add a "thread and ink palette" mapping (brand color → nearest Pantone → nearest thread color).

**Digital Assets** (the renamed Media Library, `src/lib/media/*`) already handles uploads, folders, classification, upload policy, file-signature checks, image dimensions and sharp-based optimization. Apparel art lives there in an "Apparel" folder, and the library picker drops straight into the studio. We'll add DPI-at-size reporting.

**The marketing AI tools** (`src/lib/marketing/flux-*.ts`, `midjourney-*.ts`, `canva-core.ts`, `creative-ai.ts`) can generate concept art. We'll add apparel-specific presets (vintage tee graphic, embroidered-badge style, puff-print lettering, etc.) and pipe results through "reduce colors" and "vectorize" steps.

**Non-cannabis inventory** (`src/app/admin/inventory/noncannabis/*`, `src/lib/noncannabis/*`, migrations 0076/0111/0112) already has products with SKU, size, color and gender, an adjustments ledger, vendor invoices, cost fill, intake, a merch catalog view and Code128 barcode labels (`src/lib/printing/code128-core.ts`). The naming helpers (`src/lib/naming/noncannabis-core.ts`: `buildNonCannabisName`, `buildSku`) generate convention-following names and SKUs. Finished apparel can be received here **with an entity flag** so apparel-company inventory is never offered on the dispensary POS.

**Help and guidance infrastructure** (`help-content.ts`, the concierge knowledge base, `ImageSpecHelper`, the Banner Studio `WarningsPanel`) gives us the pattern for the tips-and-warnings experience.

| Need | Reuse | New work |
|---|---|---|
| Canvas engine | Interaction patterns, keyboard model, guide/curve/arrange math | Fabric.js canvas with physical-inch coordinates and print export |
| Panels | Layers, Arrange, Text, Image, Shape, Warnings, LibraryPicker, dock | Apparel-specific panels (Garment, Method, Placement, Threads/Inks) |
| Undo/redo | BannerStudio history grouping model | Wire to Fabric object state |
| Brand | Brand kit colors and logos | Pantone/thread mapping |
| Assets | Digital Assets upload/folders/optimize/picker | DPI-at-size, vector intake |
| AI art | Flux/Midjourney/Canva clients | Apparel presets, color reduction, vectorize |
| Inventory | noncannabis products, ledger, SKUs, labels | Entity flag, size-run receiving |
| Help | WarningsPanel, help content, concierge KB | Apparel rules engine and tips library |

---

## 11. The recommended system, module by module

### 11.1 Garment template catalog

Everything starts with an accurate digital model of each blank. A template stores the brand and style (e.g., Comfort Colors 1717), category, fabric content and weight, available colors (with hex values for preview), available sizes, the supplier SKUs for each color and size at each distributor and at Printful, and — crucially — the **print areas** for each placement: their real-world size in inches, their position, obstacles (seams, zippers, pockets, pouch, drawstrings, mesh), which methods are allowed there, and how the area scales across sizes (a small and a 3XL don't take the same print). Each template also has flat-lay and photo views (front, back, sides, hat front/side/back) for the canvas and mockups. Printful templates can be imported from its catalog API; wholesale blanks are created from S&S/SanMar catalog data plus our own measurements, verified with a physical sample.

### 11.2 The design canvas

**Engine choice: Fabric.js**, pinned to a specific major version. The 2026 comparison we found (Orshot) is clear on the trade-offs: Fabric.js has built-in on-canvas text editing and can export **SVG** (vector), which is essential for print-ready files; Konva fits React slightly more naturally but cannot export SVG and has no built-in text editing. Neither library includes undo, multi-page or PDF, so those come from our own code (and our existing history model). In Next.js the canvas loads client-side only, and every image is loaded with cross-origin settings so exports never fail.

The canvas works in **real inches**, not pixels. The designer picks a garment, color and placement, and sees the garment with the print area drawn as a dotted safe zone, obstacles shaded, and a ruler. Tools include text (with curved/arched text, outlines, stacked lockups), images, shapes, the brand logo library, AI art, halftone and distress effects designed to be print-safe, knock-out, and a color-separation view that shows each ink or thread as its own layer. Multiple placements per garment (front, back, sleeve, neck) are tabs in one design. A design can be previewed on every color of the blank at once.

### 11.3 The helper engine — tips, tricks and warnings

This is what will make the studio feel "expert." It is a pure-logic rules engine (tested like our other `*-core.ts` modules) that looks at the design, the garment, the placement and the chosen method, and produces three kinds of messages: **Blockers** (the job will fail — e.g., an image that is 90 DPI at print size, text under 0.25" in embroidery, art outside the print area, art over a zipper), **Warnings** (it will work but look worse or cost more — e.g., seven thread colors, 18,000 estimated stitches, a gradient going to screen print, white ink on a dark tri-blend via DTG, a huge solid DTF block that will feel heavy), and **Tips** (pro suggestions — e.g., "this logo would look great as 3D puff on a structured cap," "try discharge ink on this black Comfort Colors tee for a vintage feel," "add a back-neck hit," "your color count suggests screen printing will be cheaper above 48 pieces"). Every message explains *why* in plain English and, where possible, offers a one-click fix (resize, reduce colors, thicken lines, switch method).

The rule families: resolution at print size; minimum text height and line weight by method; color and thread counts with cost implications; estimated stitch count for embroidery (from fill area and outline length); gradients and photographic detail versus method; print area bounds and obstacles; hat curvature and the six-panel center seam; fabric-method compatibility (discharge only on reactive-dyed cotton, sublimation only on light polyester, DTG best on cotton); underbase on darks; contrast between ink and garment color; and **compliance content checks** for the WAC 314-55-155 themes (youth-appeal imagery, over-consumption language, alcohol/tobacco/vehicle imagery, curative claims, leaf imagery), implemented as AI-assisted flags that a person must acknowledge rather than automatic rejections.

Alongside the live rules, a **tips library** (searchable, short articles with pictures) covers each method, each specialty ink, each patch type, placement, blank selection, size curves and finishing — written from this research.

### 11.4 Mockups

Two renderers. For Printful products, call Printful's mockup task API, then copy the finished images into Digital Assets immediately (their links expire). For everything else, our own renderer: a photo of the actual blank, with the design warped onto it using a displacement map (so prints follow fabric folds) and the garment recolored with a multiply blend, rendered server-side with sharp, which is already installed. This keeps us clear of Printful's terms when showing non-Printful goods. A commercial PSD-render API (for example SudoMock, at roughly $0.002–$0.05 per render) is a fallback if we need photo-studio quality quickly.

### 11.5 Proofs and tech packs

Before anything is produced, the studio generates a **proof sheet**: mockups for each placement and color, exact dimensions and positions in inches from reference points (e.g., "3 in below collar, centered"), method and ink/thread colors (Pantone and thread numbers), garment style, colors and size breakdown, and any warnings that were acknowledged. It is approved in-app by someone with permission, and the approval is logged with a timestamp. For Lane B the same data becomes a **work order / tech pack PDF** plus a zip of print-ready files (vector SVG/PDF, 300-DPI PNGs per placement, color separations for screen printing, and an embroidery-ready art file for the digitizer), along with finishing instructions (neck labels, folding, bagging, hang tags).

### 11.6 Order builder, size runs and quoting

An order gathers one or more designed products and asks for quantities in a size grid (color × size). It can suggest a starting size curve from the industry data — roughly XS 1%, S 7%, M 28%, L 30%, XL 20%, 2XL 12%, 3XL 2%, or the simpler 1-2-3-3-1 ratio across S–2XL — adjustable by you and, over time, learned from our own sales history. Note that the Adair Group recommends skewing toward larger sizes, and sizing up on 100% cotton. The quote combines live blank costs (S&S/SanMar pricing APIs or Printful estimates), decoration cost from a pricing matrix you maintain per decorator (colors × quantity × locations, digitizing fee, specialty-ink add-ons, screen setup), shipping, and a target margin, then shows unit cost and suggested retail. The builder recommends a production lane (Section 8.4).

### 11.7 Submitting orders

For **Lane A**, the studio creates a Printful draft order through the v2 API, shows the cost estimate, and requires a human click to confirm (consistent with our standing rule that automated output is a draft until a person confirms). Webhooks then update status and tracking. For **Lane B**, the studio creates purchase orders for blanks — S&S through its REST order API, SanMar through PromoStandards or its PO web service — shipped directly to the decorator, and emails the decorator the work order. Again, nothing is placed without an explicit confirm, and every submission is logged with the supplier's response. If an API isn't approved yet, the studio produces a ready-to-send PO PDF/CSV as a fallback, so the pipeline works from the start and becomes automated as accounts are approved.

### 11.8 Receiving and inventory

When goods arrive, they're received against the order line by line (color × size), creating or updating items in the non-cannabis inventory with convention-following names and SKUs (e.g., `TEE-0007-BLK-L`), Code128 labels, landed cost per unit (blank + decoration + shipping, split across units), and the **owning entity**. Apparel owned by the apparel company is never shown on the dispensary POS or menu; uniforms are issued to staff through a simple "issue to employee" adjustment rather than a sale.

### 11.9 Data model (sketch)

All new tables use our standing rules: money in minor units, idempotent migrations that the owner applies manually, and drafts until a person confirms. Proposed tables: `business_entities` (licensee vs. apparel LLC); `apparel_blanks` and `apparel_blank_variants` (style, color, size, supplier SKUs, cost); `apparel_print_areas` (per blank, placement and size, with obstacles and allowed methods); `apparel_designs` and `apparel_design_versions` (the canvas JSON, placements, chosen method, acknowledged warnings); `apparel_products` (a design on a blank in specific colors — the sellable concept); `apparel_proofs` (rendered proof, approver, timestamp); `apparel_orders` and `apparel_order_lines` (size grid, lane, quote, status); `apparel_supplier_submissions` (request, response, supplier order ID, tracking); `apparel_decorators` and `apparel_price_matrices`; and an `entity_id` column on the relevant `noncannabis_products` rows for receiving. Print files and mockups live in Digital Assets.

### 11.10 Permissions and navigation

A new admin area, "Apparel Studio," under the non-cannabis inventory section, with permissions to view, design, approve proofs, quote, and submit orders (submission and approval separated, so one person can't design, approve and spend alone). Supplier API keys are stored per entity, using our existing integrations settings pattern.

---

## 12. Phased build roadmap

Each phase is a set of small slices, built and tested in our usual way, and each phase is usable by itself.

**Phase 0 — Compliance guardrails and decisions (small, first).** Add the switch that hides merch from the dispensary storefront by default; add the `business_entities` concept; capture your answers to Section 14; get the attorney review going. Nothing else depends on the attorney except where apparel is sold.

**Phase 1 — Garment catalog and rules engine.** Template data model and an admin screen to manage blanks, colors, sizes and print areas; seed the starter blanks (tee, hoodie, crewneck, structured cap, dad hat, trucker, beanie, one jacket) with their print areas from the charts in Section 6; build the pure rules engine with full tests; write the tips library. No canvas yet, but the advisor can already answer "will this file work on this garment with this method?" for uploaded art.

**Phase 2 — The design canvas.** Fabric.js canvas in real inches with garment views, safe zones and obstacles; text, image, shape, logo and Digital Assets tools; reuse of the Banner Studio panels, guides, curves, arrange and history; live warnings panel; multi-placement designs; color previews; save designs and versions.

**Phase 3 — Print-ready export, proofs and mockups.** Vector SVG/PDF and 300-DPI PNG export per placement; color separation view and export; our own mockup renderer; Printful mockups for Printful products; proof sheet and in-app approval; tech pack PDF and print-file zip.

**Phase 4 — Orders, quotes and submission.** Size-grid order builder with size-curve suggestions; pricing matrices per decorator; live blank pricing; lane recommendation; Printful draft-then-confirm submission with webhooks; S&S and SanMar purchase orders (API where approved, PDF/CSV fallback); decorator work-order email; status tracking.

**Phase 5 — Receiving and the "fancy" layer.** Receive into inventory with entity, SKUs, labels and landed cost; uniform issuing; specialty-technique tools (halftones, discharge and puff previews, patch designer for woven/PVC/leather/chenille, 3D puff guidance, tonal embroidery preview); AI art presets with color reduction and vectorization; DTF gang-sheet builder; stitch-count estimator refinements.

**Phase 6 — The apparel company's sales channel** (after the attorney weighs in). Depending on the legal answer, either a separate storefront for the apparel LLC that reads `apparel_products`, or a POD-connected shop. Sales data then feeds back into size curves and reorder suggestions.

---

## 13. Risks and how the plan handles them

**Legal risk** is handled by the entity-aware design, the storefront switch, compliance content checks, and an attorney review before any sales channel goes live. **Supplier change risk** (like the Bella+Canvas move) is handled by keeping a backup blank for every hero style and storing supplier SKUs per distributor. **Print quality risk** is handled by the rules engine, physical samples before bulk runs, and written proof approval. **Inventory risk** is handled by starting with POD and small runs, using real size-curve data, and learning from sales. **API risk** (accounts not approved, rate limits, expiring mockup links) is handled by PDF/CSV fallbacks, queued requests within Printful's 120-per-minute limit, and copying all mockups into our own storage. **Technical risk** from canvas library upgrades is handled by pinning Fabric.js and keeping our design format (stored JSON) under our control, with export logic in tested pure modules.

---

## 14. Decisions only you can make

1. **Entity:** Will you form (or do you have) a separate LLC for apparel, and will you engage a cannabis attorney to confirm the questions in Section 1.3?
2. **Storefront merch:** Do you approve hiding the current Greenway merch from the dispensary storefront until the attorney confirms?
3. **Production lanes:** Start with Printful (Lane A) plus a local decorator (Lane B)? Do you already have a preferred Washington screen printer/embroiderer?
4. **Distributor:** Open wholesale accounts with S&S Activewear, SanMar, or both? (SanMar is now the exclusive national wholesaler for Bella+Canvas.)
5. **Starter blanks:** Approve the shortlist approach in Section 7, with a sample order before launch?
6. **Uniforms first?** Should the first real job be staff uniforms (clearly allowed) to prove the pipeline end to end?
7. **Thresholds:** Confirm the default quantities that switch an order from POD to bulk (we suggest 24 for embroidery and 36 for screen print).
8. **Approval rules:** Who may approve proofs and who may submit paid orders?

---

## 15. References

All URLs below were visited during this research (October 2026).

**Legal and regulatory**
- RCW 69.50.357 — https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.357
- WSLCB Cannabis Advertising FAQs — https://lcb.wa.gov/enforcement/cannabis_advertising_faqs
- WAC 314-55-155 (as amended eff. July 4, 2026) — https://apps.leg.wa.gov/wac/default.aspx?cite=314-55-155
- Gleam Law, new cannabis advertising rules in Washington — https://www.gleamlaw.com/blog/cannabis-law/new-cannabis-advertising-rules-in-washington

**Print-on-demand and APIs**
- Printful API v2 docs — https://developers.printful.com/docs/v2-beta/
- Printful API v1 docs — https://developers.printful.com/docs/
- SudoMock, "Printful Mockup Generator: How It Works, API Limits and Terms" (Jun 2026) — https://sudomock.com/blog/printful-mockup-api-pricing-2026
- Printful vs Printify comparisons — https://www.gelato.com/blog/printful-vs-printify ; https://merchtitans.com/blog/printful-vs-printify ; https://printify.com/printify-vs-printful
- Printful/Printify merger — https://www.bregal.com/news/printful-and-printify-announce-merger-for-accelerated-growth-in-the-global-market ; https://www.gelato.com/blog/printful-and-printify-merger

**Distributors and blanks**
- SanMar integration offerings — https://cdns.sanmar.com/resources/electronicintegration/integrationofferings
- PromoStandards member spotlight: SanMar — https://promostandards.org/member-spotlight-sanmar
- ASI: SanMar completes acquisition of Bella+Canvas (Jun 2026) — https://members.asicentral.com/news/industry-news/june-2026/sanmar-completes-acquisition-of-bellapluscanvas
- Bella+Canvas announcement — https://www.bellacanvas.com/bella-canvas-sanmar-acquisition-complete
- RVA Threads, what SanMar/Bella means — https://rvathreads.com/blogs/rva-threads-screen-printing-blog/sanmar-bella-canvas-what-it-means
- DTF Dallas, Bella+Canvas leaving S&S — https://dtfdallas.com/blogs/news/bella-canvas-leaving-ss-sanmar-update
- SOYT, best Richardson/Yupoong/Flexfit hats for embroidery — https://www.showoffyourthreads.com/blogs/news/best-richardson-yupoong-flexfit-hats-for-bulk-embroidery-orders

**Decoration, art and placement**
- Printful hat logo size and placement guide — https://www.printful.com/blog/hat-logo-size-and-placement-guide
- Printful t-shirt design placement guide — https://www.printful.com/blog/t-shirt-design-placement-guide
- Gelato embroidery design guidelines — https://support.gelato.com/en/articles/8996221-embroidery-design-guidelines
- French Press Custom, artwork prep for screen printing — https://www.frenchpresscustom.com/blog/how-to-prepare-your-artwork-for-screen-printing-complete-guide
- French Press Custom, DTG vs DTF — https://www.frenchpresscustom.com/blog/dtg-vs-dtf-printing-which-digital-method-is-right-for-you
- French Press Custom, screen printing ink types — https://www.frenchpresscustom.com/blog/screen-printing-ink-types-plastisol-water-based-discharge-and-puff-explained
- Vision Print Designs, DTF vs DTG vs screen vs HTV — https://www.visionprintdesigns.com/blogs/blog-posts/dtf-vs-dtg-vs-screen-printing-vs-htv-comparison-guide
- ScreenPrinting.com (Ryonet), mistakes printing for premium brands (Feb 2026) — https://www.screenprinting.com/blogs/news/4-mistakes-to-avoid-when-printing-for-high-end-premium-brands
- S2S Digitizing, custom hat patches guide — https://s2sdigitizing.com/blogs/custom-hat-patches-guide

**Sizing**
- The Adair Group, shirt order size distribution — https://www.theadairgroup.com/blog/shirt-order-size-distribution-what-sizes-to-order-for-t-shirts
- RushOrderTees, ordering sizes for groups — https://www.rushordertees.com/blog/how-to-order-sizes-for-group-t-shirts

**Software landscape**
- The Print Life, 2026 shop software guide (vendor-authored, read with that in mind) — https://theprintlife.com/best-screen-printing-software
- DecoNetwork vs Printavo — https://www.deconetwork.com/deconetwork-vs-printavo
- YoPrint, Printavo alternatives — https://www.yoprint.com/blog/6-best-printavo-alternatives

**Canvas engines**
- Orshot, Konva vs Fabric.js (Sep 2026) — https://orshot.com/blog/konva-vs-fabric-js
- Konva, choosing a canvas library — https://konvajs.org/docs/guides/best-canvas-library.html
- PkgPulse, Fabric.js vs Konva vs PixiJS (2026) — https://www.pkgpulse.com/guides/fabricjs-vs-konva-vs-pixijs-canvas-2d-graphics-2026

**Community**
- r/streetwearstartup — https://www.reddit.com/r/streetwearstartup
- r/SCREENPRINTING, Bella+Canvas to be SanMar exclusive — https://www.reddit.com/r/SCREENPRINTING/comments/1ukqunm/bella_canvas_to_be_sanmar_exclusive
