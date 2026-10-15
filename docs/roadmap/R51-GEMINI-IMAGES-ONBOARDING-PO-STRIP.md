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
| 2 | Gemini searches for product IMAGES as well as info | see §3 |
| 3 | Attach images on the onboarding page (intake drafts + Cultivera rows) | see §3 |
| 4 | KB remembers past image attachments per product | see §3 |
| 5 | Recommend images from Content → Media (published AND unpublished) with confidence | see §3 |
| 6 | Gemini API upgraded to the most enterprise-grade, accurate path | see §2 |

Testing budget: owner-mandated **bare minimum** (tsc 0, eslint 0 on touched files, one small pure
self-test per core). The owner does the main testing.

## 2. Research log (grounded — see §4 sources)

_Filled in as research lands._

## 3. Design

_Filled in as design is grounded._

## 4. Sources

_Filled in as research lands._
