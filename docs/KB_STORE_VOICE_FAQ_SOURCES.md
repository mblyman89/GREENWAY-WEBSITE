# KB Store Voice & FAQ Pack — Sources & Notes (Slice 4)

> **KB Hardening v2 — Slice 4 (LAST): store/brand facts + FAQ pack.**
> Purpose: teach the AI about **Greenway itself** (hours, address, payment,
> delivery, price match, loyalty, returns, mission, etc.) and give it a curated,
> owner-extendable FAQ pack to answer from — in our voice — so it never guesses a
> store detail. Product facts (strains/effects/formats/rules/terpenes) shipped in
> Slices 1–3 + 5; this is the "about us" layer.

**Compliance-first.** Every fact and FAQ answer passes the same `checkCompliance`
gate as all KB copy: no medical/therapeutic claims, no minor-appeal, no dosing
directives. Store facts are policy/marketing language only.

---

## Verified sources (nothing guessed)

### Owner-confirmed (this session, verbatim)
- **Hours:** 8:00 AM – 11:00 PM every day (closed Christmas Day per the site FAQ).
- **Address:** 4851 Geiger Rd SE, Port Orchard, WA 98367.
- **Phone:** 360-443-6988.
- **Payment:** Cash only; on-site ATM with a **$2.50** fee. No credit/debit for cannabis.
- **Delivery:** None — not legal in Washington. In-store pickup only, 21+ ID.

### Mirrored from the live customer site (verified in code)
- **`src/content/faq.ts`** — the committed FAQ list (hours, who-can-buy, payment,
  acceptable ID, out-of-state residents, purchase limits, on-site/public use,
  cross-state transport, see-before-buying, **returns (WAC 314-55-079: 15 days,
  original packaging + legible lot/batch ID + receipt)**, where-to-consume,
  public-use fine, resell, pesticides). Also DB-backed via `getFaqForRender()`
  from `@/lib/cms/faq-store` — the site shows DB rows if present, else this list.
- **`src/components/price-match/PriceMatchContent.tsx`** — the 8 price-match
  terms: loyalty members only; competitor price must be regular price (no happy
  hour / holiday / daily specials); **Port Orchard, WA** retailers only; identical
  vendor/brand + size; prices must include all WA + local taxes; verifiable via
  website/menu/phone; matched items can't be discounted further; all sales stay
  compliant.

### Live, not hard-coded
- **Loyalty earn rate** — lives in the owner-editable **`loyalty_config`** table
  (read via `getConfig()` in `src/lib/loyalty/loyalty-store.ts`:
  `pointsPerDollar`, `pointValueMinor`, `minRedeemPoints`). The seeded loyalty
  FAQ carries **no hard-coded rate**; `retrieval.ts` composes the live rate into
  the answer at grounding time (`buildStoreContext()` → `liveLoyaltySentence()`)
  so the concierge can never quote a stale number. Owner couldn't recall the
  rate; this design means they never have to.

---

## ⚠️ Site inconsistencies flagged (NOT propagated)

While grounding, two errors were found in the **static** FAQ list
(`src/content/faq.ts`) — a copy-paste from another dispensary. The Slice 4 seed
uses the **correct** grounded copy (from the price-match page + owner) and does
**not** carry these errors forward. Recommend the owner fix the site copy too:

1. The static FAQ price-match answer says **"Uncle Ike's"** (a different retailer)
   and **"Seattle i502 Pot Shops"**. The authoritative price-match page correctly
   says **Greenway Marijuana** and **Port Orchard, WA** competitors. The seeded
   FAQ uses the correct Greenway / Port Orchard wording.

*(Everything else in the static FAQ matched the price-match page and owner facts.)*

---

## What this slice added

- **Migration 0090** (`0090_kb_store_voice_faq.sql`, MANUAL, idempotent):
  - `kb_store_facts` — owner-extendable "about us" cards (`key`, `label`,
    `category`, `body`, `tags[]`, `sort_order`, provenance, drafts/status). Upsert
    on `key`.
  - `kb_faqs` — curated + owner-extendable Q&A (`slug`, `question`, `answer`,
    `category`, `tags[]`, `sort_order`, provenance, drafts/status). Upsert on `slug`.
  - Both: RLS `is_staff()`, `set_updated_at()` trigger, status check, indexes,
    `source='manual'` backfill. Non-destructive — curated edits never clobbered.
- **seed.ts** — `SeedStoreFact` + `SeedFaq` types; `SEED_STORE_FACTS` (6 confirmed
  facts) + `SEED_FAQS` (17 entries). All pass compliance **0 blocking**. (See the
  compliance note below re: price/loyalty warnings.)
- **store.ts** — counts (`storeFacts`, `faqs`), seed upserts (r10/r11, degrade
  pre-0090), full CRUD for both (`list*Full` / `listActive*` / `get*` / `upsert*`
  / `set*Active`).
- **retrieval.ts** — new **store-wide** `buildStoreContext()` (distinct from the
  per-SKU `buildGroundedFacts()`): loads active facts + FAQs (DB → seed fallback),
  stitches the **live** loyalty rate onto the loyalty FAQ, emits `kb:fact:<key>` /
  `kb:faq:<slug>` provenance. Intended for a future customer concierge (Slice 79).
- **health.ts** — `storeFactCoverage` + `faqCoverage`.
- **admin pages** — `/admin/knowledge-base/about` (store facts: add/edit/hide) and
  `/admin/knowledge-base/faqs` (FAQ: add/edit/hide), plus two KB landing nav cards.
  Owner can add facts (mission, about-us, parking, discounts, ADA, anything) and
  FAQs manually, exactly as requested.

## Compliance note (why Slice 4 carries 5 non-blocking warnings)

Unlike Slices 2/3 (0 blocking / 0 warnings), Slice 4's price-match and loyalty
copy trips **5 non-blocking "price/discount mention (heads-up)"** warnings — the
gate flags the literal words "price match" / "discount." That is unavoidable and
correct: those FAQs are *about* price matching. The flag is a **warn**, not a
**block**, meaning "a human should have reviewed the price mention" — the owner
explicitly confirmed this copy. **0 blocking** flags across all facts + FAQs.
