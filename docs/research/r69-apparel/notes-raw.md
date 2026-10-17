# R69 Apparel Studio — Raw Research Notes (Oct 2026)

## Printful API v2 (developers.printful.com/docs/v2-beta)
- Catalog products → variants (always order by catalog_variant_id). Techniques: dtg, embroidery, dtfilm, sublimation, cut-sew, uv, digital.
- Placements per product (front, back, sleeve_left/right, embroidery_chest_left, embroidery_front, embroidery_back, label_inside...). `layer_options`: thread_colors (fixed palette e.g. #FFFFFF 1801 White, #000000 1800 Black, 1951 Gold, 1987 Orange, 1751 Kelly Green), 3d_puff. `conflicting_placements`.
- Variant placement_dimensions (e.g. Gildan 2XL front 23.39x33.11 in) ; mockup styles print_area 12x12 in at 150 dpi.
- Mockup Generator v2: async task → webhook `mockup_task_finished` or poll.
- Orders: create (draft) → confirm. Order estimation task (costs + retail). Shipping rates endpoint.
- Price varies by technique/placement; first placement discounted; bulk discounts (e.g. 8% at 25+).
- Size guides endpoint (measure_yourself / product_measure / international).
- Webhooks: catalog_stock_updated (~5 min), catalog_price_changed, order_created/updated/failed/canceled, shipment_sent/delivered, order_put_hold, approval sheets.
- Rate limit 120 req / 60 s leaky bucket. Files library. "Sync products" not in v2 (use v1 for store products).

## S&S Activewear (api.ssactivewear.com/V2)
- REST JSON/XML: categories, styles, products (SKU-level), inventory by warehouse, specs, brands, orders (POST places order, instant confirmation), tracking, invoices, returns. Basic auth = account # + API key (My Account).
- Also Data Library Excel, ~1GB image zip, FTP EDI (inventory every 15 min), PromoStandards (Inventory 2.0, Order Status, Shipment Notification, Product Data, Media, PPC pricing, PO).
- Integrated with DecoNetwork, ShopVox, ShopWorks, YoPrint, Printavo etc.

## Hats — Printful hat logo guide (Sep 4 2026)
| Hat | Front area | Logo height | Notes |
|---|---|---|---|
| Structured cap / snapback | 4–5 in wide | ≤2.25 in | buckram keeps from puckering |
| Trucker | ≤5 in wide | ≤2 in | mesh back: avoid embroidery |
| Dad hat (unstructured) | 3.5–4 in | 1.75–2 in | |
| Bucket | ~5 in | 1.75–2 in | |
| Beanie | 5 in | 1.75–2 in | lowercase ≥0.25 in, uppercase ≥0.3 in; knit stretches |
| Side | 2–2.5 in | 1–1.25 in | minimalist |
| Back above closure | 2.25–3 in | 0.75–1 in | arched text suits |
- Center 0.5–1 in above brim; use 80–90% of the practical width.
- Embroidery: min letter 0.25 in, min line 0.05 in, ~15,000 stitch cap for hats, typically ≤6 thread colors (some unlimited), nothing < 1/16 in. No gradients/photos → use DTF/DTFlex.

## Gelato embroidery guidelines
- Min text/line height 0.25 in (6.4 mm), thickness 0.05 in (1.3 mm); thinner → run stitch.
- Vector PDF or PNG ≥150 DPI; solid shapes, no distressed/textured, no photos.
- Garment stretched in hoop → stitched design slightly smaller than file; design slightly larger.
- Big filled backgrounds blow stitch count → scale graphic down up to 50%.
- Side areas: ≤10 characters per line. Non-compliant files auto-modified or rejected.

## Printful T-shirt placement guide (May 14 2026)
- Left chest print: top ~3 in below neckline, ~2 in from armpit; 2.5x2.5 to 5x5 in.
- Center chest: 3–3.5 in below collar; 6x6 to 10x8, 8x8 most common.
- Full front: 12x16 standard (Printful upgrading some DTG to 15x18); 3–4 in below collar.
- Embroidery: digitization one-time fee per design. Left chest max 4x4; center chest 4x4; large front 10x6 (leave open space on stretch fabrics).
- Back DTG max 10x12 to 12x16 by product. Sleeve ~4x3.5 (AOP up to 20x12 wrap).
- Inside label 3x3 area (logo ≤3x1.13), fonts ≥10pt, PNG sRGB ≥150 DPI transparent; outside label 3x3 ($2.49).
- Seam-to-seam = AOP (sublimation on poly / direct-to-fabric cut-sew on cotton); stay in safe area, don't cross seams/collar.
- Common mistakes: ignoring size per garment size, skipping mockups, complex art in small areas, low-res for big prints, crowding collar/shoulder/side seams.
- File format: PNG transparent at actual print size, sRGB IEC61966-2.1, ≥150 DPI (higher for big/detailed).

## French Press Custom — screen print art prep (Sep 2026)
- Vector best: AI > EPS > SVG > PDF(vector) > PSD 300dpi > PNG 300dpi.
- Raster ≥300 DPI at print size (12 in wide chest → ≥3600x4200 px). px/300 = max inches. Never upscale. Web logos 72 dpi = not print-ready.
- Spot colors / Pantone; each color = a screen; typical 1–6 colors; WHITE counts as a color (underbase); gradients in Canva → 8+ screens.
- Canvas: chest 11–12 in wide x 14 tall max; left chest 3.5–4 in wide; back up to 14x17.
- Outline fonts; min text 0.25 in (~18pt); thin scripts risky; one color per named layer ("White Underbase"); flatten shadows/glows into solids.
- Hand-drawn: scan 600 dpi, threshold, vectorize (line ≥1pt) or keep raster for halftones/DTG.
- Pricing sample (LA): screen 1-color front 100–199 pcs $3.77/pc, 450–999 $2.17/pc (decoration only). Min 36/design; 2–3 weeks after art approval. Embroidery min 24.
- DTF: 12–49 $4.50, 100–249 $3.00, 250+ $2.20 + $15 setup per location. DTG light garment: 12–30 $15, 51–100 $8, 251+ $5; no min.

## DTG vs DTF (French Press Custom, Sep 2026) & Vision Print Designs (Jan 2026)
- DTG: ink into fibers, softest hand on 100% cotton/high-cotton; dark needs pretreat + white underbase (inconsistent white = top DTG issue); can fade on darks; 1–3 min/garment; no min.
- DTF: printed on PET film + hot-melt powder, pressed 300–330°F; works on nearly any fabric (poly, nylon, blends, canvas, leather, hats, bags); brightest white on darks; most durable; noticeable thin film hand; 60+ presses/hr; gang sheets; can pre-print and stock transfers.
- Screen print: lowest unit cost at volume (36–100+), most durable, specialty inks (puff, metallic, glow, discharge); setup per color; gradients via halftones; design changes = new screens.
- HTV: names/numbers, simple; thick hand, can crack/peel.
- Rule of thumb: <36 pcs cotton → DTG; dark/poly/mixed/hats → DTF; ≥36–50 pcs few colors → screen print; logos on hats/beanies/jackets/polos → embroidery.

## SanMar / Bella+Canvas (2026)
- SanMar integration paths: PromoStandards web services; flat-file FTP (Integration Guide v23.4); SanMar Web Services SOAP (WS Integration Guide v24.3) + PO Integration Guide 24.3. Contact sanmarintegrations@sanmar.com.
- SanMar closed acquisition of Bella+Canvas late June 2026; becomes exclusive national wholesaler; S&S sells through remaining Bella stock only. Alternatives: Comfort Colors 1717, Next Level 6010/3600, American Apparel 2001. Lesson: never marry one blank (RVA Threads, Jul 7 2026).

## Printful vs Printify
- Merger announced Nov 2024; brands still run separately (Apr 2026).
- Printify = marketplace of print providers, variable quality, 1,300+ products, cheaper (Gildan 64000 ~$6.21 vs Printful ~$12.95).
- Printful = in-house facilities, consistent, ~370+ products, branding (inside labels, pack-ins), 2-5 day production.
- Gelato = local production in 34 countries.

## Printful mockup API (sudomock.com, Jun 2026)
- v2: POST /v2/mockup-tasks, poll GET /v2/mockup-tasks?id= or mockup_task_finished webhook. Not real time; first poll >= 10s.
- 120 req/min general; mockup endpoints lower (unpublished). v1 image URLs expire after 72h -> must copy to our storage.
- Printful ToS 4.6: Printful mockups may only be used to sell Printful products. => Need our own mockup renderer for non-Printful channels (own photo + displacement/multiply color overlay; or PSD API like SudoMock $0.002-0.05/render).

## WA legal (critical)
- RCW 69.50.357(1)(a): retail outlets may sell only cannabis, cannabis products, paraphernalia. $1,000/violation.
- LCB Advertising FAQ (lcb.wa.gov/enforcement/cannabis_advertising_faqs):
  - "A licensee is not permitted to sell t-shirts from their retail store or business website. A separate business is necessary."
  - "Neither selling nor giveaways of branded merchandise are permissible."
  - Separate entity (separate LLC, close-by) may sell branded merch: Yes.
  - Soft goods may be sold from a "parent" website; paraphernalia must be sold from licensed location.
  - Employee uniforms with logo OK. Leaf in logo OK but not on signage/ads. Cross-promo with neighbor business OK. Branded paraphernalia OK.
- WAC 314-55-155 (eff. 7/4/26): (5) no promotional giveaways of branded/unbranded merch (except incidental paraphernalia < $1). (2)(a) no youth appeal (cartoons, toys), no over-consumption, no alcohol/tobacco/vehicles/curative claims. (2)(c) "21+" on advertising. (7) four warnings >=10% of largest type except outdoor. No plant/product depictions on outdoor ads.
- Repo risk: src/lib/merch/merch-catalog.ts sells branded apparel through the dispensary storefront cart (category "merch"), used by MerchProductCard, MerchDetailPanel, InteractiveMenuBrowser, menu/products/[id]. Must be gated/removed pending attorney review.

## Canvas library (Orshot, Sep 27 2026)
- Fabric.js: inline text editing built in; toSVG() for vector output; v7 defaults center origin; breaking changes v6/v7 -> pin version.
- Konva: react-konva fits React; no SVG export; no built-in text editing. Polotno SDK built on Konva (commercial).
- Neither ships undo, pages, PDF, server rendering. Next.js: dynamic(..., {ssr:false}); set crossOrigin to avoid tainted canvas.

## Shop management software (theprintlife.com 2026 guide; vendor-biased)
- Printavo $109-244+/mo + $19/user; DecoNetwork $169-349+/mo (multi-store, 3D design lab, distributor catalogs); YoPrint $99-299 (3-10 user caps); InkSoft (online stores/design studio); The Print Life $49 flat (PromoStandards POs to SanMar/S&S/AlphaBroder sorted XS->5XL).
- Common features to learn from: pricing matrices (colors x qty x locations), proof approval -> auto status advance, blanks procurement aggregated by supplier/size, multi-decoration master invoices, mockup studio, DTF gang-sheet builder.

## Specialty inks (French Press Custom, Sep 2026)
- Plastisol: base, opaque, 50+ washes, 320F. Water-based: soft, poor on darks, +$0.50-1/color/pc. Discharge: zero hand, reactive-dyed cotton only (not poly, not white), +$0.50-1. Puff: bold shapes only, +$1.25-2/location. Metallic +$2-4, glow +$1-1.50, foil +$3-5, high-density (sharp raised), suede.
- Combos: plastisol + puff accent; discharge body + plastisol pop; water-based + metallic spot.
- Choose by garment color -> fabric -> hand feel -> detail -> budget.

## Patches / hats (S2S Digitizing; SOYT)
- Patch types: embroidered (classic), woven (fine detail, near-photographic), PVC (rubber, 3D, weatherproof), leather (embossed/laser, premium), chenille (fuzzy, varsity), sublimated (photo), velcro (swappable). 3D puff embroidery for bold raised logos.
- Top blank hats: Richardson (112 trucker), Yupoong/Flexfit (6245 dad, 6089 snapback, 110). Structured crowns embroider best. Placements: front center, side, back arch, sewn patch. Typical B2B 24-pc min, 5-8 business days, digitizing fee.

## Size runs (Adair Group / RushOrderTees)
- US distribution: XS 1%, S 7%, M 28%, L 30%, XL 20%, 2XL 12%, 3XL 2%.
- Simple ratio 1-2-3-3-1 (S-M-L-XL-2XL), skew larger; cotton shrinks -> size up; add 1-2 XS/3XL.

## Premium brand expectations (ScreenPrinting.com / Superior Ink, Feb 2026)
- Private-label neck tags, hem tags, folding/bagging, retail-ready presentation matter as much as print.
- Blank is part of the product (drape, cut, hand). Realistic capacity-based lead times; QC checkpoints.
