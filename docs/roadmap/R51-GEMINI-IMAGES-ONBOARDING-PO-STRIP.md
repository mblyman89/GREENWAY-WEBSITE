# R51 — Gemini Product Images at Onboarding, Image Memory, PO Pipeline Bar

> **THE BIBLE FOR R51.** Read before every slice; check again before every commit.
> If it is not in here, it is not in scope. Base: main `10e98d4e`.

---

## 0. Owner's request (verbatim, recorded 2026-10-15)

> I need your help enhancing my product onboarding process in my intake pipeline. I would like to give
> Google Gemini the ability to search for product images as well as product info. I want to be able to
> attach images on the onboarding page. The system is very smart, I want the image assignment to happen on
> onboarding, which means the kb needs to remember past attachments to products. It needs to be able to
> recommend ones from the content media page, both unpublished and published images, with a confidence
> level. I need this ability for both products I intake as well as the one time Cultivera import. I want to
> upgrade the Gemini api to have the most enterprise grade solution and execution for the best most
> accurate results. Next on the list for this first round is adding the page progression bar to the
> purchase order page like all the other pages have in the top section of the page. Clone the repo, read
> agents.md and then begin auditing the code and researching the internet for enterprise grade solutions
> that are professional and expert level. Please go above and beyond for me. Follow the standing rules and
> never guess, never assume. Please only do the bare minimum testing, I will do the main testing of the
> results. We need to save credits and money. I trust your ability to get it right with the foundation
> that we built and established for you to build on top of. Commit work often, the sandbox is very
> unstable. Protect the work as best you can. Thank you!

## 1. Items

| # | Item | Status |
|---|------|--------|
| 1 | PO pages get the one pipeline bar (`CatalogStageStrip current="order"`) | DONE (S1) |
| 2 | Gemini searches for product IMAGES as well as info | S2–S4 |
| 3 | Attach images on the onboarding page (intake drafts + Cultivera rows) | S2–S4 |
| 4 | KB remembers past image attachments per product | S2–S4 |
| 5 | Recommend images from Content → Media (published AND unpublished) with confidence | S2–S4 |
| 6 | Gemini API upgraded to the most enterprise-grade, accurate path | S2 |

Testing budget: owner-mandated **bare minimum** (tsc 0, eslint 0 on touched files, one small pure
self-test per core). The owner does the main testing.

## 2. Research log (grounded — see §4 sources; all read 2026-10-15)

**R1 — Model.** The Interactions API model list names `gemini-4-argon` ("Our new frontier model, built to
solve the hardest problems with depth and precision … knowledge work"), GA 2026-10-13. Its model page lists
Search grounding, URL context, Structured outputs, Thinking, Batch/Flex/Priority. `gemini-3.8-flash` is "Our most
intelligent Flash model". The app already picks the model from `AI_MODEL_HEAVY`, so the upgrade is an env
change, and nothing is hard-coded. [S1][S2]

**R2 — Request fields we were not using.** CreateInteraction accepts `system_instruction` (a separate
field, instead of gluing the system text onto the user text), `response_format` (JSON schema enforcement),
`service_tier` (`flex|standard|priority|deferred`), `generation_config.seed`, `thinking_level`
(`minimal|low|medium|high`) and `tools` including `google_search` and `url_context`. [S2]

**R3 — Structured output + tools together.** Gemini 3+ models may combine structured outputs with the
built-in tools (Google Search, URL context). The current schema is
`response_format: {type:"text", mime_type:"application/json", schema:{…}}`, and the answer is read
from `output_text`. [S3][S4]

**R4 — Api-Revision.** The May-2026 migration guide says the new `steps` schema became the default
on May 26. The legacy schema was removed June 8, 2026, and after that the "Api-Revision header [is]
ignored". So sending it today does nothing, and we do not send it. Our parser already reads `steps`. [S4]

**R5 — URL context.** `{type:"url_context"}` lets the model fetch up to 20 URLs per request (34 MB
each). It reads HTML, PDF **and images (png/jpeg/bmp/webp)**. Each URL comes back as a `url_context_result`
with a status (success / error / unsafe). This lets Gemini *open* a candidate product photo and
check it is the product, instead of guessing from a URL string. [S5]

**R6 — Image search: not used.** The API reference lists `google_search.search_types: ["image_search"]`
("Image bytes are returned"). But the image-generation guide limits image search to the image models
(Nano Banana 2.1 / 3.1 Flash Image), and it uses the results as *generation context* that is not
returned to the caller. Forum threads (Mar–Apr 2026) also report image grounding returning nothing.
So it cannot give a text model a list of product-photo URLs, and we do not depend on it. Product image
URLs come from `google_search` web results + retailer/brand pages, verified via `url_context`. [S2][S6][S7]

**R7 — Cost.** Gemini 3+ grounding bills per search query (5,000 free per month, then $14 per 1,000).
URL-context content is billed as input tokens. The owner's monthly budget guard (`getBudgetStatus`)
already runs before every call. [S3][S5]

**R8 — Asset↔product linking practice (PIM/DAM).** Akeneo's Asset Manager links assets to products
with "product link rules" built from asset attributes. Those attributes are usually taken from the
filename or asset code ("most of you use a naming convention … the SKU of the product corresponding to
the asset"), and once made, the link is stored on the product. We use the same signal (asset title,
filename, alt text and tags against product words). The difference is AGENTS.md's drafts-only rule: a
match is a **recommendation with a confidence %** that a person attaches, never an automatic link.
A link a person confirms is remembered by identity key, so later intakes and the Cultivera import
get it back first. [S8]

## 3. Design

**D1 — Gemini upgrade (`src/lib/ai/provider.ts`, additive).**
- The Gemini branch sends `system_instruction` separately.
- Tools are `google_search` + `url_context`. `AI_GEMINI_URL_CONTEXT=off` turns url_context off.
- Optional `service_tier` from `AI_GEMINI_SERVICE_TIER`. It is not sent when unset. `priority` is the
  enterprise choice.
- Optional `seed` from `AI_GEMINI_SEED`.
- Callers may pass a JSON schema (`opts.jsonSchema`) that becomes `response_format`. A 400 that
  mentions the schema retries once without it, so a model that refuses the combination still answers.
- Recommended env: `AI_MODEL_HEAVY=gemini-4-argon`, `AI_THINKING_LEVEL=medium` (or `low` while on
  Vercel Hobby's 300 s limit).

**D2 — Images from Gemini.** The lookup prompt asks for `image_candidates` as *direct* product-photo
URLs from the brand, retailer or menu pages it actually read. With url_context on, it is told to open
each one and keep only those that show THIS product. The result is the existing reviewable
`image_candidates` list (no new storage of grounded results). On the onboarding row, each candidate
gets **Import & attach**, which goes through `importImageFromUrl`: SSRF guard, MIME sniff, content-hash
dedupe, saved as a media **draft** with license pending-review.

**D3 — Image memory (migration 0279, idempotent).** `product_image_memory` holds identity_key, media
asset id, last pos_product_key, source (`library|import|memory` (a Gemini-found photo is stored as `import`)), times confirmed, first/last
confirmed by and at, and a unique (identity_key, media_asset_id). It is written each time a person
attaches an image on onboarding. Recall also reads what is already on record without the table:
product_enrichments and kb_products rows sharing the identity key. Recall still works before the owner
applies 0279; it just has fewer memories.

**D4 — Recommendations with confidence (`src/lib/catalog/image-recommend-core.ts`, pure).**
Every pickable library asset (draft + published, never archived) is scored for the draft:
- **remembered** (a person attached it to this identity before): 97%, the same constant as R32
  remembered picks.
- **on the card already** (current gallery at the suggestion key): shown as attached.
- **name match**: the share of product-name words found in the asset text (title, filename, alt text,
  tags), plus a brand/vendor bonus. A brand that disagrees halves the score. A category word adds a
  little.
- The score is shown as a % with band **High ≥ 80 / Medium ≥ 55 / Low ≥ 35**. Below 35 is not shown.
  Draft and rights-pending badges are honest.

**D5 — Onboarding UI.** On every draft row (intake and Cultivera re-onboard rows share the page), a
"Product images" panel shows:
- remembered images, then recommendations with confidence badges, each with **Attach**;
- an "Import from web" URL box for Gemini's candidates.

The action (`inventory.manage`) re-reads the draft on the server. It resolves the key with
`suggestionTargetKey` (the same key the S07 door uses) and attaches to the product_enrichments gallery
(the `attachMatchedMedia` pattern). When the draft has a `kb_product_id` it also attaches to that KB
product. It records the usage, writes memory and audits `catalog_draft.image_attached`.

## 4. Sources

- [S1] Gemini 4 Argon model page — https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
- [S2] Interactions API reference (CreateInteraction, Tool.GoogleSearch.search_types, UrlContext, service_tier) — https://ai.google.dev/api/interactions-api
- [S3] Grounding with Google Search — https://ai.google.dev/gemini-api/docs/google-search
- [S4] Interactions breaking changes, May 2026 (steps, response_format, Api-Revision timeline) — https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026
- [S5] URL context tool — https://ai.google.dev/gemini-api/docs/url-context
- [S6] Image generation guide (image search limited to image models) — https://ai.google.dev/gemini-api/docs/image-generation
- [S7] Google AI Developers Forum threads on image-search grounding returning no data (Mar–Apr 2026), found by forum search — https://discuss.ai.google.dev
- [S8] Akeneo, "About the product link rules" — https://help.akeneo.com/serenity-build-your-catalog/36-serenity-about-the-product-link-rules
