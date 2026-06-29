# Declutter pass + Site Content overhaul + AI research — Working TODO

> **STANDING RULE (every session):** Before doing anything, (1) `git checkout main && git pull`,
> (2) walk the file tree (`find src/app/admin -type f`, `ls back-office/`), (3) re-read this file +
> PROGRESS_TRACKER.md + ROADMAP_PAGE_BUILDER_VISION.md + relevant research/screenshots. AI output is
> drafts-only (employee validates before publish). Migrations applied MANUALLY by owner in Supabase
> SQL editor (keep idempotent). One PR per slice: squash-merge, delete branch, sync main. Push via
> `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git`. Never print token.

## Working dir note
- Repo at **/workspace/repo**. `cd` does NOT persist — always `cd /workspace/repo` first.
- Build: `./node_modules/.bin/next build` (NOT npx). Typecheck: `npx tsc --noEmit`. Lint: `npx eslint <files>`.
- `rm -rf .next` before/after builds (disk tight). ~2340 pages. Session name `fresh`.
- Headless screenshots: `/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome --headless=new --no-sandbox --screenshot=out.png --window-size=W,H "file:///workspace/..."`.

---

## OWNER REQUESTS (this round) — verbatim intent
1. **Declutter the back end** — it must be *employee-ready*. Remove developer noise:
   - [ ] Dashboard "Back office build progress" (Slice 1/2/3/4… cards) — REMOVE (BUILD_SLICES in setup-status.ts).
   - [ ] Audit any other "what slice we worked on" / internal dev language anywhere in the admin.
2. **Site Content overhaul** (the page currently titled "Footer Content"):
   - [ ] Rename "Footer Content" back to **Site Content**.
   - [ ] It should now hold the **About / Locations / Price Match** editable content (we moved those heroes to
         content blocks in Slice 3b) IN ADDITION to the footer blocks — so the owner edits site text in one place.
   - [ ] Confirm About/Locations/Price Match still belong under PAGES too, OR fold their text editing into Site Content.
         (Owner question: "is about, locations, price match meant to still be there [PAGES] and not in site content now?")
   - [ ] Give the Site Content page UI an overhaul to match the polish elsewhere (it's functional but plain).
3. **SEO editor** — go over in detail what it does + how to use it best; **bake that guidance INTO the page**
   (inline help / HelpPanel), so employees learn it in-context.
4. **Resend "Enable Receiving"** — advise (DONE in chat: leave OFF; site only needs sending; receiving would
   hijack MX and break personal inboxes; if ever needed, use a subdomain). Bake a short note into the admin's
   email/help area so nobody clicks Proceed by mistake.
5. **AI deep-dive (RESEARCH ONLY this round):** deep web research on best practices / expert techniques /
   masterful strategy for programming the AI so:
   - The webcrawler (crawl4ai, built LATER) has the best chance of scraping relevant, usable info.
   - The AI is **hyper-focused on cannabis & cannabis products**.
   - The AI is **hyper-focused on product enrichment** → meaningful edits/suggestions, not money wasted on
     rejected output.
   - Produce a **comprehensive roadmap for enhancing the AI features** BEFORE building crawl4ai.
6. **STOP after**: one more declutter pass (+ touch-ups + Site Content overhaul + SEO/Resend baked-in help) AND
   the AI research/roadmap. Present the GPT/AI plan and how it best powers crawl4ai. Do NOT build crawl4ai or
   the AI features yet.

---

## PLAN / SLICES

### Declutter Slice 4 — employee-ready cleanup + Site Content overhaul (PR — code) ✅ DONE (PR #81)
- [x] Remove "Back office build progress" from dashboard; deleted BUILD_SLICES + ProgressRow + SliceProgress type.
- [x] Sweep admin for dev-facing language. Reworded all user-facing "Supabase is not configured" / migration-number /
      "Slice N" strings across: orders, promotions, loyalty-signups, newsletter, vendors, reports, media, products,
      products/bulk-ai, blog, blog/new, pages/[slug], PromotionForm. New consistent copy: "The database isn't fully
      set up yet. Once your administrator finishes the one-time setup, …". Generalized setup-status migrations guide
      (dropped the 0009_ai_usage_ledger.sql filename). Left genuinely-admin bootstrap screen (AdminSetupNotice) and
      code comments as-is.
- [x] Rename Footer Content → **Site Content**; broadened it to footer + business + About + Locations + Price-Match
      blocks (excludes the 6 builder-heavy pages home/menu/loyalty/specials/vendors/faq to avoid duplication).
- [x] Overhauled Site Content UI: tokenized ContentBlocksBrowser (chips, toolbar, search, page-group headers via
      PAGE_LABELS), added "How Site Content works" HelpPanel.
- [x] Baked in **SEO editor** how-to: HelpPanel on the Site Content page ("What is the SEO editor…") + a fuller
      HelpPanel on /admin/content/seo ("How to write great SEO" + per-field explanations + cannabis compliance).
- [x] Baked in **Resend / email** note: setup-status SMTP tip + newsletter "How sending works" panel
      (leave Enable Receiving OFF; sending only; MX-hijack warning; use a subdomain if ever needed).
- [x] tsc=0, eslint=0 (also fixed a pre-existing `<a>`→Button eslint error in PromotionForm), build exit 0 (~2340 pp).

#### DECISION: About / Locations / Price Match — PAGES vs Site Content
- **They stay under PAGES** (each has a rich section/banner *builder* at `/admin/pages/<slug>`). That is NOT broken.
- **Their plain text blocks ALSO surface in Site Content** so the owner edits all site copy in one place. No
  duplication: Site Content shows the content-*block* text fields; PAGES manages the visual banners/section cards.

### AI Research (RESEARCH ONLY — produce docs, no feature code)
- [ ] Deep web research: LLM product-enrichment best practices, structured outputs / JSON schema / function
      calling, grounding & RAG, prompt strategy, eval/guardrails, cost control, cannabis-domain specifics &
      compliance (WA I-502 advertising rules), crawl4ai integration patterns (what to feed the model, how to
      validate scraped data before enrichment).
- [ ] Write **AI_ENHANCEMENT_ROADMAP.md**: target architecture (model choice, structured outputs, domain
      system prompts, retrieval/grounding, validation/guardrails, human-in-the-loop drafts, eval harness,
      cost/usage controls) + a phased slice plan + how the AI best powers crawl4ai.
- [ ] Present the plan to the owner; STOP.

---

## NOTES / DECISIONS LOG
- Resend Enable Receiving: **OFF** (advised owner in chat). Sending is verified & sufficient.
