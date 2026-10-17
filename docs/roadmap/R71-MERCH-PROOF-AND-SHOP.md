# R71 — Merch Studio: Proof & Export (Slice 3) and the Greenway Glass & Goods shop (Slice 4)

Follows `docs/roadmap/R70-MERCH-STUDIO.md` (Slices 1–2). The seller of every item is **Greenway Merchandising LLC (dba Greenway Glass & Goods)**, never the cannabis licensee.

## 1. Owner request (verbatim)

> "Thank you! So the strategy is to keep everything on the main site, with a distinctly different check out process on a subdomain? I want the shopping experience to be seamless for the customer, in fact, they should have no idea they are on a different domain or platform or system or whatever. We take precautions to protect ourselves, while at the same time providing a frictionless shopping experience. Is there any other strategic ways of setting this up for best results and successful outcomes. This merch branch of sales will be tiny. To put it into perspective, I sell about 200k of cannabis per month and at most 3k of non cannabis paraphernalia. So merch will probably be less than that. With a different company, different ein, different ubi, subdomain identity, different bank account, etc. can we do this as envisioned reliably and sustainably? Or are we still at high risk of cc shut down? I still want to build this as fed regulation changes on cannabis are starting to change become more real. In the summary report, please break this down more for me. Let's jump right in to slice 3 and slice 4. … Go above and beyond for me, add as much additional value as you can to this new feature system. … Put yourself in the creative genius shoes and ask yourself, what do I need to design and create awesome apparel I can sell to my customers. Then document all those choices and build it that way, with purpose."

## 2. Slice 3 — Proof & Export (what a prepress desk would hand the printer)

New studio tab **🖨️ Proof & Export**, between Design and Artwork Check.

### 2.1 Design choices (and why)

| Choice | Why (source) |
|---|---|
| **One PNG per Printful *file type*, not per studio placement.** Full-front + left-chest on DTG become ONE `front` file. | In Printful's catalog the DTG left-chest file id `default` has type `front` — Printful prints them as one file. Sending two files of the same type is impossible. (Printful catalog `files[]`, verified for all 11 blanks.) |
| The largest frame in a merged group owns the area; smaller frames are offset by their real garment position. Art outside the owner's area is a **blocker**. | Printful crops anything outside the print area (`limit_to_print_area`). Catches the classic "left-chest logo sitting above the front print area" mistake. |
| **Transparent PNG, sRGB, 300 DPI**, with an `sRGB` chunk and a `pHYs` chunk written into the file. | Printful DTG file guide: PNG with transparent background (a JPG prints a white box), sRGB IEC61966-2.1, ≥150 DPI, best not above 300. The pHYs chunk makes Photoshop / Printful read the true print size. |
| Trimmed to the art (+0.05″ pad; text gets +0.12 em for italic/script overhang) and placed with Printful's `position` object `{area_width, area_height, width, height, top, left}`. | Printful Orders/Mockup API position object. Small files upload faster; position keeps the exact placement. |
| DPI steps down only when the file would exceed **16,777,216 px** (12×16″ → 295 DPI) and says so. | iOS Safari / WebKit canvas cap. Still ~2× Printful's 150 DPI minimum. |
| **Rendered in the browser**, not on the server. | The browser already has the exact fonts (next/font + owner uploads) and the artwork (IndexedDB). Fonts are embedded into the SVG as data: URLs before rasterising, so the PNG uses the real typeface. Verified in Chromium: `@font-face` embedded, PNG chunks `IHDR, sRGB, pHYs, IDAT`, 300 DPI. |
| Alpha measured after render; **> 18 % semi-transparent inked pixels warns** on DTG/DTF; any element below 100 % opacity warns. | Printful "Transparency in DTG printing": semi-transparent areas print with gaps, worst on dark garments. |
| Embroidery threads go on the item `options` using the catalog's **real** option id (`thread_colors_chest_left`, `thread_colors`, …). When the product lists none (e.g. Yupoong 6089M), the file gets `auto_thread_color` + the thread codes in `notes`. `embroidery_type` only when listed. | Never invent an option id (standing rule). Option ids generated from the public catalog (`PRINTFUL_OPTION_IDS`). |
| **ZIP** = every PNG + `README.txt` (sizes, positions, threads) + `proof-sheet.html` + `design.json` backup. STORE-only zip writer (PNG is already compressed), no new dependency. | Everything a human printer (or a second POD vendor) needs, in one file. |
| **Proof sheet** (printable, letter): each file on the garment colour, art size, *distance below the neckline / back neck seam / above the brim*, offset from centre, threads, file name, check counts, the sample checklist and an "Approved for sale by / date" line. | What you hold next to the physical sample with a ruler. |
| **Sample checklist** (placement, size, colour in daylight, fit, labels show Greenway Glass & Goods, wash test, hand-feel, stitch quality, thread match, ribbing stretch, photograph the sample). Ticks saved per design. | Printful: order a sample before selling (20 % off samples). Apparel returns are dominated by fit; wash durability drives repeat buys. |
| **Photo mockups** via Printful's mockup generator (up to 6 colours per run). Files go to a **private** bucket (`merch-files`, migration 0281) and Printful gets 1-hour signed links. | Printful API `POST /mockup-generator/create-task/{id}` + `GET /mockup-generator/task`. Rate limit 2/min new stores, 10/min established — the UI says so. Fails closed without `PRINTFUL_API_TOKEN`. |
| **Order-item JSON preview** (`files[]` + `options[]`) — exactly what Slice 4 sends. | No surprises at order time. |

### 2.2 Files

- `src/lib/merch-studio/print-export-core.ts` — pure planning, Printful mapping, PNG tagging, CRC-32, zip, proof sheet, mockup body, variants. `__runPrintExportTests()` (102 checks) in `run-pure-selftests.ts` and vitest.
- `src/components/admin/merch-studio/print-export.tsx` — browser renderer (React → SVG → fonts embedded → canvas → tagged PNG), downloads, signed upload.
- `src/components/admin/merch-studio/ProofPanel.tsx` — the tab.
- `src/app/admin/merch-studio/proof-actions.ts` — signed upload tokens, mockup task create/poll (staff `content.edit`).
- `src/lib/merch-studio/printful-client.ts` — server-only Printful v1 client (Bearer + optional `X-PF-Store-Id`, 20 s timeout, fails closed).
- `supabase/migrations/0281_merch_print_files_bucket.sql` (+ rollback) — private `merch-files` bucket, PNG only, 50 MB cap.
- Generator (`scripts/merch/refresh-printful-catalog.py`) now also emits `PRINTFUL_FILE_TYPES`, `PRINTFUL_OPTION_IDS`, `PRINTFUL_VARIANTS` (1,368 variant ids with price + stock). Existing colours/sizes unchanged byte-for-byte.

### 2.3 Environment (only needed for mockups)

- `PRINTFUL_API_TOKEN` — private token from **Greenway Merchandising LLC's** Printful account.
- `PRINTFUL_STORE_ID` — only if the token is account-level.

## 3. Strategy research notes (October 2026) — for the owner and the attorney

These are research notes, not legal advice.

**Card networks and processors**

- **Stripe** restricted list includes "Cannabis products; Cannabis dispensaries and related businesses". Stripe's FAQ allows a business that removed all unsupported items to keep processing for the rest. (support.stripe.com prohibited/restricted FAQ.)
- **Transaction laundering** (LegitScript): "the processing of payments through a merchant account underwritten by a payment provider on behalf of a different merchant, which is not known to, approved by or underwritten by the payment provider." This is what a *hidden* merchant looks like to a network — and it carries Visa/Mastercard fines. https://www.legitscript.com/transaction-laundering
- **Visa Core Rules (18 Apr 2026) §5.8.4.1 Merchant Website Requirements:** customer-service contact; the Merchant Outlet country "clearly and prominently" on the checkout screen or within the checkout sequence ("A link to a separate web page does not meet this requirement"); address for cardholder correspondence; multiple-shipment policy.
- **Visa VIRP / Mastercard MMP** require acquirers to monitor merchant websites on an ongoing basis, **including related domains**. https://ballerine.com/blog/mmp-virp-merchant-monitoring
- **Visa and Mastercard have not changed their cannabis prohibitions** after medical rescheduling (HLG, https://www.cannabisindustrylawyer.com/credit-card-processing).

**Federal status**

- DEA final rule (April 22, 2026, effective April 28, 2026) moved FDA-approved and **state-medical-licensed** marijuana to Schedule III. Adult-use: 11-day hearing June–July 2026, ALJ recommendation pending; recreational marijuana is still Schedule I. (Gibson Dunn, "DEA Downschedules State Medical Marijuana to Schedule III…"; Morgan Lewis, Sept 2026.)

**Washington LCB (Cannabis Advertising FAQ, https://lcb.wa.gov/enforcement/cannabis_advertising_faqs)**

- "A licensee is not permitted to sell t-shirts from their retail store or business website. A separate business is necessary to sell items beyond what is allowed under the law."
- "May we sell t-shirts hoodies and other soft goods from our 'parent' website…? You may sell the soft goods from the parent website. The paraphernalia must be sold from the licensed location."
- "Could a separate entity (separate LLC, operating close-by) sell branded merchandise? Yes."
- Giveaways / distribution of branded merchandise are banned (WAC 314-55-155(4)).
- **These answers pull in different directions — ask the attorney which governs a merch shop linked from the licensee's site.**

**Existing site conflict found:** `src/lib/merch/merch-catalog.ts` (Logo Tee, Hoodies, Hat, Beanie, Socks, Lanyard) is sold through the **cannabis** menu, cart and pickup checkout. That matches the FAQ's "licensee is not permitted to sell t-shirts from their … business website". Recommendation: remove it (or move it into the LLC shop) before the new shop launches. Not changed in R71 — owner decision.

## 4. Slice 4 — the shop

See §5 (written with Slice 4).
