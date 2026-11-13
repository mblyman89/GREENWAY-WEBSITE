# SOP-22 — The Sunday Newsletter, the Blog, Culture Posts and AI Marketing Content

| | |
|---|---|
| **Version** | 1.9 (N-8c moving + interactive canvas built, D238 #1783; N-8b #1782; N-8a #1781; N-6 #1779; N-5 #1778; N-4 #1777; N-3 #1776; N-2 #1775; N-1 #1774; living document) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Blog & Newsletter** (`/admin/blog`, nav MKTG & ADV, permission `blog.manage`, `src/components/admin/admin-nav-data.ts` L98). **Email Newsletter** Send Center (`/admin/newsletter`, `blog.manage`, L99). **Marketing & Advertising** hub (`/admin/marketing`, `content.edit`, L96). **Digital Assets** (`/admin/media`, `media.manage`, L95). **Blog wording** (`/admin/blog/content`, `content.edit`, L148). **Regulatory Watch** (`/admin/compliance/regulatory`, `reports.view`, L133). The public pages `/blog`, `/blog/[slug]` and `/unsubscribe` |
| **Verified against** | `main@a4ccd7cb` (2026-11-12). Every claim below is pinned to a file and line at that commit. Law and platform rules were re-read on 2026-11-12 (Appendix A.2) |
| **Program records** | Findings `F-22-1` … `F-22-20` and `F-22-C` in `docs/sop-program/03-FINDINGS-LEDGER.md` · gaps `G-108` … `G-120` in `docs/sop-program/05-GAP-REGISTER.md` · plan rows `N-1` … `N-10` (Phase N, PROPOSED) in `docs/sop-program/06-FIX-PHASE-PLAN.md` · owner request D236 in `00-OWNER-REQUEST-VERBATIM.md` |
| **Scope (this version)** | The owner: *"I want to now work on the newsletter, blog, culture, and other misc marketing and advertising. I want extensive ai help building marketing and advertising content. We will send a newsletter out every Sunday. I want the ai to create blog and culture content."* No code was changed for this version |

> **This SOP is a living document (owner decision D41).** When a Phase N slice is built, the "As built" note goes into 00, the finding gets its "Resolved" line in 03, and this SOP gets a new version row in Appendix D.

> **D237 (owner approval):** every recommended option in Appendix C is approved, with one exception: **culture posts go on the existing `/blog` page as the existing CULTURE card** (the page already shows PRODUCTS, DEALS, CULTURE and NEWSLETTER cards: `src/lib/blog/posts.ts` L1, `src/components/blog/BlogCard.tsx` L8–12). There is no separate Culture tab or page.
>
> **Fixed in v1.1 (N-1):** every newsletter email now carries all four warnings at ≥10% of the largest type size; it carries one-click unsubscribe headers; saving a newsletter post keeps its PDF; hard bounces and spam complaints opt the address out automatically (audited); only the **owner or an admin** can send to the whole list. Items 1 and 3 below are kept for history and are no longer true.
>
> **Fixed in v1.2 (N-2):** a broadcast is now queued, one row per address, and sent in batches of 100 with an `Idempotency-Key`, in the background. A progress bar shows how many are sent; you can leave the page. Failed addresses can be retried without re-sending to anyone else. **Owner step:** apply migration `0362_newsletter_send_recipients.sql`; until then the send works the old way (one request, stay on the page).

> **Fixed in v1.9 (N-8c):** The canvas has **moving and interactive** pieces. Email cannot run scripts, so moving means animated GIFs and interactive means links that count. **GIF maker** (below the AI studio): pick 2 to 10 pictures from Media in order, the seconds per picture and the shape; the site joins them into a looping GIF sized for email (it lowers the colours, then the width, until it is light enough), saves it to Media and puts it in the selected Image section or a new one. Outlook for Windows shows only the first picture, so put the key message first. **Live countdown** section: set the end time; the timer picture is drawn by our site each time the email is opened, so it always shows the real time left (it ticks for a minute, then stops). The end time is printed under it in Pacific time for Outlook. **One-tap poll** section: a question with 2 to 4 answers; each answer is a link to our site tagged with the poll and the answer, so a tap is a vote. **Clicks by section** under the canvas shows, after the send, how many people tapped each section and the poll votes, from the email provider's click events. **View in your browser** now opens the hosted copy at `/newsletter-web/<slug>` (exactly the email, with the warnings; no scripts allowed) once the post is published; otherwise it falls back to the blog post. The send check flags a countdown with no end time and a poll with fewer than 2 answers as must-fix. **Owner step:** none. No migration.

> **Fixed in v1.8 (N-8b):** The newsletter canvas has an **AI studio** below the selected section (like Canva's AI). **Draft the newsletter** asks the AI (GPT or Gemini, whichever runs the site's AI) to write the headline, intro, up to three short notes, the button, the subject and the preview text from **this week's facts only**; add your own ask ("cozy fall feel, lead with the new vendor"). The card grids stay the facts. **Improve the selected section** rewrites that section (More professional, Shorter, Friendlier, Add a reason to come in, Fix grammar only, or your own ask); review quotes are locked because they are the customer's own words. **Suggest 5 subjects** gives subject and preview text pairs; click one to use it. Nothing the AI writes is used if it invents a price, percent or link that is not in the facts, uses a superlative ("best", "#1"), a health claim, or fails the compliance check. The **picture studio** edits the selected Image section, or makes a new picture when no picture is selected, with **GPT Image**, **Gemini (Nano Banana)** or **FLUX**: Remove background (GPT gives a see-through PNG; Gemini puts the product on white; FLUX cannot), Studio clean-up, Brighten and sharpen, Wide email banner, Seasonal backdrop, or your own ask. Every picture ask is screened (no one who looks under 21, no smoking or use, no cartoons, no health themes) and carries a safety note. Results are saved to **Media** as new files tagged `ai-generated`; the original is kept; press **Use it here** to swap it in, then run the send check. Every AI call checks the monthly AI budget, is logged in AI usage and is audited. **Owner step:** Optional, only for the picture studio: GPT Image uses `OPENAI_API_KEY` (or `AI_API_KEY` when it is an OpenAI key; model `AI_IMAGE_MODEL`, default `gpt-image-2`); Gemini pictures need `AI_GEMINI_API_KEY` (model `AI_GEMINI_IMAGE_MODEL`, default `gemini-nano-banana-2.1`); FLUX uses the key already in Settings > Integrations. Words need `AI_API_KEY` (already on the to-do list). No migration.

> **Fixed in v1.7 (N-8a):** Newsletters can be built **in the app** on the **newsletter canvas** (F-22-8, Q-22-5 (a)). On **Blog & Newsletter** press **New canvas newsletter** (or **Open the canvas** on any newsletter post). The canvas is a list of sections: header, headline, text, image, button, **QR code**, card grids (fresh drops, new vendors, deals, from the blog, culture, custom), review, hours, divider and spacer. **Fill from this week** builds the cards from the This week facts (below-cost deals are held back). **Make QR** turns any link into a QR image saved in Media. The preview shows desktop, phone and the plain-text part. The four warnings and the unsubscribe link are a **fixed footer** that cannot be removed or shrunk. **Run send check** measures the whole email: Gmail clips an email over 102 KB, so over that is a must-fix and over 90 KB is a heads-up; every image is fetched and checked (weight, width, WebP/SVG that Outlook or Gmail will not show, alt text, https only); subject and preheader length, buttons and QR links. **Compress images** makes email-sized copies (JPEG, PNG or GIF, at most 1200 px wide) in Media and swaps them in; your originals stay. Must-fix items block both the test email and the real send. When **Use this canvas as the email** is on, the broadcast and the queue send the canvas (HTML and a plain-text part, with a link to each block tracked by `utm_content`) instead of the PDF email; the Canva PDF stays optional. Saving the canvas voids an approval (N-3). **Owner step:** none. No migration (the canvas is stored in site settings).

> **Fixed in v1.6 (N-6):** **New post** has a **Culture news desk** (F-22-13). It drafts CULTURE posts (the existing CULTURE card on /blog, Q-22-7) from cited news only (Q-22-1 (a)): **Regulatory Watch** (WSLCB items that have a link), **Find news** (a live web search for federal, national and state cannabis news that runs only when a person presses the button, Q-22-6 (a); the results are shown with their sources and are not stored, and an item is kept only if the search really cited its link) and **Vendor wins** (the same search about one vendor or brand). The **health-topic guard** (F-22-14, WAC 314-55-155(2)(a)(vii)) blocks therapeutic wording outright (treats, cures, relieves, helps with sleep, medical benefits…). When the text touches health it must cite a source, carry the line *"Talk to your healthcare provider about any health question"* and may not link to products, the menu or deals. The desk adds the source link and the provider line to the body itself. The guard runs on the draft, on save, and again before any CULTURE post goes live: **Publish** is refused with the reasons, and a schedule fails with the reason in the schedule list. The post editor shows the guard result for every CULTURE post. **Owner step:** none beyond AI being configured; for Google-grounded search set `AI_MODEL_HEAVY` to a Gemini model and `AI_GEMINI_API_KEY` (it falls back to the OpenAI web search otherwise). Each Find news press costs one AI web lookup within your budget cap. No migration.

> **Fixed in v1.5 (N-5):** **New post** (`/admin/blog/new`) opens with **New post from…** (F-22-10, F-22-16). Pick a type (new vendor, fresh drops, review spotlight, sale, vendor day, holiday, culture), pick one item from this week's facts, add notes when asked, and press **Draft with AI**. The server re-reads the facts itself (the browser never sends them) and the AI gets only those facts. You get 5 headline options, an excerpt, a body in sections with headings and a call to action, and up to 3 pictures from Digital Assets (same vendor first). The rule checks and compliance flags show at once, before anything is saved. **Must fix:** superlatives (Q-22-9), a price or percent outside Sale and Vendor-day posts, or one that is not in the promotion (Q-22-8), and links that are not in the facts. A deal the below-cost check flags is held back and cannot be drafted. A review spotlight needs the review you picked, pasted word for word (Q-22-2 curated). A culture post needs a source link (Q-22-1). **Create draft post** saves a Draft only (audited `blog.create` with the template); a person reads it and publishes it. The body is still plain paragraphs, so a heading is saved as its own short paragraph until N-7. **Owner step:** AI must be configured (`AI_API_KEY` or `OPENAI_API_KEY`); no migration.

> **Fixed in v1.4 (N-4):** Blog & Newsletter (`/admin/blog`) now opens with a **This week at Greenway** card (F-22-11). It lists the vendors added in the last 7 days, the lots received in the last 7 days (fresh drops, grouped by vendor and type), the published deals running now and starting in the next 14 days (with their dates and offer, and a red flag on any deal the below-cost check catches), vendor days and clearance sales, and the dates in the next 30 days (US holidays, 4/20, 7/10 and the local events you type in the card's **Local events** box, one per line as `YYYY-MM-DD Name`). It only reads; nothing is written except your local events (audited). Deals flagged below cost are never handed to the AI (Q-22-8). **Owner step (optional):** add local events. No migration.

> **Fixed in v1.3 (N-3):** a blog post can be scheduled to publish or unpublish at a Pacific time from its **Schedule** panel; the 5-minute content-schedule cron does it (F-22-5). The Sunday newsletter has a cadence: **Ready for approval** → the owner or an admin presses **Approve and schedule** with a time → it publishes and sends by itself (F-22-9). A reminder email goes out (default Friday 9:00 AM Pacific) when nothing is ready. **Owner steps:** apply migration `0363_newsletter_approvals_blog_schedule.sql`, then set the Sunday send time in the Send Center (Q-22-4 names no time, so none is set and nothing sends by itself until you pick one). Item 2 below is kept for history and is no longer true.

> **The three things to know before anything else (v1.0).**
> 1. **(Fixed in N-1.) The email that went out before v1.1 was missing three of the four required warnings.** Washington treats a newsletter as advertising. WAC 314-55-155(7) requires all four warnings in every non-outdoor ad, at no less than 10% of the largest type size. The email wrapper prints only *"For adults 21+. Keep out of reach of children."* (`src/lib/cms/newsletter-send-store.ts` L234). The app's own campaign planner says email needs all four (`src/lib/marketing/campaign-rules-core.ts` L86, L96). This is finding **F-22-1 (S1)**, and slice **N-1** fixes it. Until then, put all four warnings in the Canva design itself (§4.6 step 2).
> 2. **(Fixed in N-3.) "Scheduled" on a blog post did nothing before v1.3.** Nothing ever published it (F-22-5). Since v1.3, use the post's Schedule panel (§4.3 step 9).
> 3. **Saving a newsletter post without uploading the PDF again removes its PDF.** The post then disappears from the Send Center (F-22-6). Until N-1, upload the PDF again every time you save a newsletter post, or open the Send Center afterwards to check it is still listed.

> **How to use this document.** §4.1 is the map. §4.2 is the weekly rhythm. §4.3 to §4.5 cover blog and culture posts with the AI as it works today. §4.6 and §4.7 cover the Sunday newsletter. §4.8 covers the Marketing hub. §7 covers the rules: Washington advertising law, email law, Google's rules and the AI rules. Appendix B has the audit and the roadmap. Appendix C has the questions for you.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures
   - 4.1 The map: where everything lives
   - 4.2 The weekly rhythm (Sunday newsletter cadence)
   - 4.3 Writing a blog post with the AI (today)
   - 4.4 The six blog post types: facts, headline, picture, checks
   - 4.5 Culture posts: news, vendors, strains and the medical-claims rule
   - 4.6 Building and sending the Sunday newsletter (today)
   - 4.7 After the send: stats, unsubscribes, bounces
   - 4.8 The Marketing & Advertising hub (strategist, idea notebook, planner)
5. Messages you may see, and what to do
6. Exceptions & troubleshooting
7. Controls & compliance
8. Forms
9. Quick reference
10. Glossary
- Appendix A: Source map and external sources
- Appendix B: Findings, gaps and the roadmap strategy
- Appendix C: Owner questions
- Appendix D: Revision history

---

## 1. Purpose & scope

This SOP explains how Greenway produces its marketing content every week, using the back office and the AI:

- **The Sunday newsletter:** one email to every opted-in loyalty member, every Sunday.
- **Blog posts** about the store:
  - new vendors joining the lineup;
  - fresh drops from last week;
  - top Google reviews;
  - a special sale;
  - a vendor day;
  - a holiday;
  - anything else the owner asks for.
- **Culture posts:**
  - current events and cannabis news, state and federal;
  - vendor achievements and their strains and products;
  - education about cannabis and health research, within the rules in §4.5.
- **Other marketing:** the Marketing & Advertising hub (the AI strategist, idea notebook and campaign planner) and the Creative Studio. The Creative Studio is covered in SOP-11b.

It covers today's procedure, everything the audit found to fix, enhance and harden, and the roadmap (Phase N) that turns the existing pieces into a "canvas". Here the canvas means one place where the AI assembles the week's facts, drafts the posts and the newsletter, picks pictures from Digital Assets, checks everything against the rules, and a person approves and sends.

**Not covered:** banners, FLUX and Midjourney (SOP-11b), merch (SOP-11), SEO beyond blog posts (SOP-21), Digital Assets housekeeping (SOP-12).

## 2. Roles & permissions

| Task | Permission | Roles today (`src/lib/auth/roles.ts`) |
|---|---|---|
| Write, edit, publish, delete blog and newsletter posts; AI drafts; AI ideas | `blog.manage` | owner, admin, manager, content_editor (L112) |
| Send a test newsletter | `blog.manage` | same (`src/app/admin/newsletter/actions.ts` L17) |
| **Broadcast the newsletter to the whole list** | `newsletter.broadcast` + the confirm tick | **owner, admin only** (D237, Q-22-3; `roles.ts` `newsletter.broadcast`). Managers and content editors see *"Only the owner or an admin can send a newsletter to the whole list. You can prepare it and send yourself a test."* (`newsletter-email-core.ts` `BROADCAST_GATE_MESSAGE`) |
| Marketing hub: strategist, idea notebook | `content.edit` | owner, admin, manager, content_editor (L111) |
| Blog page wording (headings, intro) | `content.edit` | same |
| Digital Assets | `media.manage` | see roles.ts |
| Regulatory Watch (WSLCB bulletins) | `reports.view` | see roles.ts |

**Rule:** the AI never publishes or sends anything. Every AI output is a draft that a person reads, edits and accepts (`src/lib/marketing/strategy-ai.ts` L14–17; accept gate `src/lib/ai/accept-gate.ts`).

## 3. Before you start

1. **Email is set up:** `RESEND_API_KEY` and `NEWSLETTER_FROM_EMAIL` (or `ORDER_EMAIL_FROM`) are set in Vercel (`newsletter-send-store.ts` L41–47). The Send Center shows "not configured" otherwise. The from-domain must be verified in Resend with SPF, DKIM and DMARC (§7.3).
2. **Engagement tracking (optional):** the Resend webhook points at `/api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`), so opens, clicks, bounces and complaints show in the stats.
3. **AI is set up:** `AI_API_KEY` or `OPENAI_API_KEY` is set (`src/lib/ai/provider.ts` L54). The default model is `gpt-4o-mini` unless `AI_MODEL` says otherwise (L57). Grounded web search (used by vendor research) needs the Gemini key (`geminiApiKey`, L741).
4. **Canva:** the "Open Canva" button goes to `NEXT_PUBLIC_CANVA_URL`, or canva.com if that is not set (`src/lib/marketing/canva-core.ts`). Point it at your newsletter template.
5. **Pictures:** product, vendor and lifestyle pictures are in Digital Assets. Today the blog cannot pick from the library (F-22-15), so download the picture you want first, then upload it as the hero (4 MB maximum, `src/app/admin/blog/actions.ts` L38, L166).

## 4. Procedures

### 4.1 The map: where everything lives

| What | Where | What it does today |
|---|---|---|
| Blog & Newsletter list | `/admin/blog` | All posts. Counts by status, including a **Scheduled** card. Since v1.3 (N-3) a post shows as Scheduled when its Schedule panel has a publish time, and the 5-minute cron publishes it then (F-22-5 fixed) |
| Post editor | `/admin/blog/[id]` | Title, title typography, category (PRODUCTS, DEALS, CULTURE, NEWSLETTER, `src/lib/cms/types.ts`), kind (article or newsletter), excerpt, body (plain paragraphs only), hero upload plus AI alt text, SEO fields, live preview (`src/components/admin/blog/BlogEditorClient.tsx`). For newsletters: a PDF upload and page images |
| AI on a post | the editor's AI panel | **Write body**: 2–4 paragraphs from title, category and topic only. **SEO**: title and description. **Alt text**. **Ideas**: 6 ideas, from evergreen, trend or local angles (`src/lib/cms/ai-blog.ts`, `ai-blog-ideas.ts`, `BlogIdeaAssistant.tsx`) |
| Send Center | `/admin/newsletter` | Lists **published newsletter posts that have a PDF** (`page.tsx` L80). Shows the recipient count, a test send, the broadcast (confirm tick, 1-hour cooldown, audit), 90-day engagement and the last 20 sends |
| Email Newsletter list | loyalty sign-ups | Members with consent, not opted out, status new or entered, de-duplicated by email (`newsletter-send-store.ts` L155–177) |
| Unsubscribe | `/unsubscribe?token=…` | One click from the email link marks the member opted out (`src/app/(site)/unsubscribe/page.tsx` L17–33) |
| Marketing hub | `/admin/marketing` | AI strategist (WA-compliant plan drafts grounded in the store profile and up to 15 published vendors, `strategy-ai.ts` L81–92), idea notebook, campaign planner by channel (newsletter, website, social, event…), competitive playbook |
| Creative Studio | `/admin/marketing/midjourney` | Pictures and video (SOP-11b) |
| Regulatory Watch | `/admin/compliance/regulatory` | Reads the WSLCB GovDelivery feed every day and writes AI briefings (`src/lib/regulatory/regulatory-ingest.ts` L1–41). This is the best state-news source already in the app |
| Public blog | `/blog`, `/blog/[slug]` | Every published post, in one list with no category filter (`src/app/(site)/blog/page.tsx`). The article shows the hero and the paragraphs (`[slug]/page.tsx` L128–129). The site footer carries the four warnings (`src/components/site/Footer.tsx` L232) |

### 4.2 The weekly rhythm (Sunday newsletter cadence)

This is the recommended week. It works today by hand. Phase N automates the fact-gathering and the drafting, but a person keeps the approve and send steps.

| Day | Job | Who | Where |
|---|---|---|---|
| **Monday** | Look back at last week: which vendors were added, which lots were received (fresh drops), which promotions ran, what is coming (sales, vendor days, holidays). Fill in Form 8.1, the weekly brief | Manager / content editor | The **This week at Greenway** card on Blog & Newsletter (since v1.4, N-4); Vendors, Inventory and Promotions for detail |
| **Tuesday** | Draft 1–3 blog posts from the brief (§4.3, §4.4). Draft 1 culture post (§4.5) | Content editor + AI | Blog & Newsletter |
| **Wednesday** | Read every draft against the Form 8.2 checklist. Fix, then publish the store posts | Manager | Blog & Newsletter |
| **Thursday** | Build the newsletter in Canva from this week's posts (§4.6). Export the PDF | Content editor | Canva |
| **Friday** | Create the newsletter post, upload the PDF, publish, **send a test** to two inboxes (Gmail and iPhone Mail). Read it on a phone | Content editor | Blog & Newsletter, Send Center |
| **Saturday** | Owner approval (reply "approved" or edits) | Owner | — |
| **Sunday, morning** | Broadcast (§4.6 steps 8–10). Since v1.3 it sends by itself at the approved time (§4.6, The Sunday way). Pick a fixed send time and keep it (Q-22-4) | Owner or admin | Send Center |
| **Following Sunday** | Read last week's opens, clicks and unsubscribes (§4.7) before planning the next one | Owner | Send Center |

**Why a fixed day and time:** subscribers learn when to expect it, and a predictable cadence keeps spam complaints down (§7.3).

### 4.3 Writing a blog post with the AI (today)

1. **Blog & Newsletter → New post.** Type a working title and choose the category:
   - **PRODUCTS** for vendors and drops;
   - **DEALS** for sales and vendor days;
   - **CULTURE** for news and education;
   - **NEWSLETTER** only for the Sunday email.

   Kind = **Article**. Save.
2. **Need an idea?** Open the **Idea assistant**. Choose Evergreen, Trends or Local and press **Suggest**. You get 6 ideas, each with a headline, hook and outline. The Trends ideas are season-aware and never invent news (`ai-blog-ideas.ts` L74). Use one as the title.
3. **Give the AI the facts in the Topic box.** Today the writer only sees the title, the category and what you type in **Topic** (`src/app/admin/blog/actions.ts` L296–300). It is told *"Do not mention price, stock, or specific inventory"* (`ai-blog.ts` L35). So paste the facts it needs, for example: *"New vendor: [name], from [city], known for [what they make]. First products on our shelf: [names]. Their story: [two lines from the vendor page]."* Without facts it writes general filler (F-22-10).
4. Press **Write body**. The draft appears as a **suggestion**. It is 2–4 plain paragraphs, about 500 tokens at most (`ai-blog.ts` L85). Read it. **Accept** puts it in the body, after the compliance check in the accept gate. **Reject** throws it away.
5. Edit by hand. Add what the AI could not know: product names, dates, the vendor-day time.
6. **Hero picture:** upload it (download it from Digital Assets first; F-22-15), then press **Suggest alt text**. The alt suggestion shows any compliance flags (`BlogEditorClient.tsx` L145).
7. Press **SEO**: accept or edit the SEO title (about 60 characters or fewer) and the description (about 155 characters).
8. Check the live preview on the right, then go through Form 8.2.
9. **Publish** (status = Published), or, since v1.3 (N-3), schedule it: open the post, go to **Schedule this to go live**, pick the Pacific date and time (5-minute steps) and press Schedule. The post shows as **Scheduled** and the 5-minute content-schedule cron publishes it at that time (audited, same calendar as SOP-11b). You can also schedule it to unpublish. Choosing the Scheduled status button by itself is refused, because a schedule needs a time.

### 4.4 The six blog post types: facts, headline, picture, checks

Every post type below follows the same rule: **facts from the back office, words from the AI, a picture from Digital Assets, checks by a person.** Since v1.4 (N-4) the facts are on the **This week at Greenway** card at the top of Blog & Newsletter. Since v1.5 (N-5) you do not copy them: on **New post**, use **New post from…**, pick the type and the item, and the AI is given only those facts (the table below is how to check its work).

| Type | Facts to gather (where, today) | Headline patterns (pick one, keep it truthful) | Picture | Extra checks |
|---|---|---|---|---|
| **New vendor joins the lineup** | Vendor page: name, city, story, philosophy (`vendors` table, `0099_vendor_product_philosophy.sql`); first products received | "Meet [Vendor]: [what they do best] Lands at Greenway" · "New on Our Shelves: [Vendor] from [City]" | Vendor logo or product shots in Digital Assets | No claims the vendor cannot back up; no "best in WA" unless there is a source |
| **Fresh drops (last week)** | Lots received in the last 7 days (Inventory, by received date, `0214_inventory_lot_received_date.sql`) and their products | "Fresh This Week: [n] New Drops from [Vendor A], [Vendor B]…" · "Just Landed: [Strain] and More" | Product photos | No "while supplies last" pressure that promotes over-consumption. Name strains and types, not effects |
| **Top reviews spotlight** | Google reviews you choose, by hand, today (no integration, F-22-12) | "What Our Customers Are Saying This Month" | Store photo (never a picture of the reviewer unless they gave permission) | **Google's rules (§7.4):** show the reviewer's name and a link to the review on Google, or get the reviewer's permission. Quote word for word. No review that mentions effects or health |
| **Special sale** | The promotion: name, dates (`promotions.starts_at`/`ends_at`, `0006_slice6_promotions.sql` L78–81), what is included | "[Sale name]: [x]% Off [Category] This [Day]" | Promotion banner from Branding | WAC 314-55-155(5)(g): no coupon below acquisition cost. Say the dates and "21+". No free cannabis (except the medical rule in (6)) |
| **Vendor day** | Vendor + date + time; the vendor-day markdown flag on the promotion (`PromotionForm.tsx` L281–284) | "[Vendor] Vendor Day at Greenway: [Date]" | Vendor assets | **No giveaways of branded merchandise** (WAC 314-55-155(5)); samples only as (5)(h) allows |
| **Holiday** | The holiday and your hours or deal | "Celebrate [Holiday] with Greenway" · "Our [Holiday] Hours and Specials" | Seasonal art from Creative Studio | No cartoons, toys or youth-appeal imagery, e.g. Halloween candy look-alikes (WAC 314-55-155(2)(a)(viii)). Nothing about driving to a party (2)(a)(v). No alcohol (2)(a)(iii) |

**What makes a headline captivating without breaking the rules:**
- Lead with the news: *new*, *fresh*, *this week*, the vendor's name.
- Use numbers: "5 New Drops".
- Use the reader's benefit in words the law allows: flavor, variety, craft, local, the deal.

Never write:
- over-consumption ("get wrecked", "stock up and blaze all weekend");
- health or cure words ("relief", "heals", "anxiety-free");
- youth appeal ("candy", "kids", cartoon references);
- anything false.

The compliance check flags many of these words (`src/lib/ai/compliance.ts`, `checkCompliance`). Words are not enough, though: read the picture too.

### 4.5 Culture posts: news, vendors, strains and the medical-claims rule

**Where they go (D237):** a culture post is a normal blog post with category **CULTURE**. It shows on `/blog` with the white CULTURE card, next to PRODUCTS, DEALS and NEWSLETTER (`BlogCard.tsx` L8–12). The editor already defaults new posts to CULTURE (`src/app/admin/blog/actions.ts` L101–102).

**Sources you can use today:**
1. **State news (WSLCB):** Regulatory Watch already collects every WSLCB bulletin and writes a briefing (`regulatory-ingest.ts`). Open the item, read the source link, and write a short "What it means for you" post. Link to the bulletin.
2. **Federal and national news:** you find it yourself today. Use reputable outlets and official sources (DEA, HHS, Congress.gov, the WA Legislature). The app's Idea assistant will **not** invent news (`ai-blog-ideas.ts` L74). N-6 adds a sourced news desk.
3. **Vendor achievements:** awards, new genetics, a feature in the press. Use the vendor's own announcement or the award organiser's page. Name the source in the post.
4. **Strain and product spotlights:** lineage, terpene names, grower story, how it is made. Describe flavor, aroma and process. **Do not describe effects as benefits.**

**How to write it with the AI (since v1.6, N-6):** on **New post**, open the **Culture news desk**, pick Regulatory Watch, Find news or Vendor wins, pick the item and press **Draft with AI**. The source link (and, on health topics, the provider line) is added for you, and the health guard checks it before it can go live. (Before v1.6 you pasted the facts and the link into Topic and added a "Source:" line by hand.)

**The medical-benefits rule (read this before any health topic).** WAC 314-55-155(2)(a)(vii) says no cannabis advertising may contain any statement or illustration that *"represents that the use of cannabis has curative or therapeutic effects."* The rule applies to **all** advertising by a licensee, in any medium, so it covers your blog and your newsletter. The app's AI rules already block therapeutic claims (`COMPLIANCE_SYSTEM`, `src/lib/ai/compliance.ts`). Until you answer Q-22-1, the safe practice is:
- **Do:**
  - report news *about* research or law, attributed and linked ("A study published in [journal] in [month] looked at …; the researchers said …");
  - explain the medical-card program and the tax exemption (your /medical page already does this within the rules);
  - say "talk to your healthcare provider".
- **Do not:**
  - say or imply that cannabis, a strain or a product treats, relieves, cures or helps any condition, including "sleep", "pain", "anxiety" or "stress";
  - put such a post next to a product or a deal;
  - let the AI write health copy from its own memory.

This is finding **F-22-14** (a compliance risk, S1). N-6 adds a stricter "health topic" check that requires a source and blocks product links in those posts.

### 4.6 Building and sending the Sunday newsletter (today)

The only workflow the app has today is *Canva → PDF → newsletter post → Send Center* (`src/app/admin/newsletter/page.tsx` L104). The email itself is a fixed wrapper, shown below. It holds the post title, a sentence and a **Read the newsletter →** button, plus a PDF button when there is one (`newsletter-send-store.ts` L204–242). The real content lives in the PDF and the blog page.

1. **Open Canva** (button in the Send Center). Start from your newsletter template.
2. **Design it.** Suggested sections, in this order:
   - this week's headline;
   - **Fresh drops**;
   - **New vendor**;
   - **This week's deals** (with dates and "21+");
   - **From the blog** (1–3 posts);
   - **Culture pick** (one sourced news item);
   - **Review of the week**;
   - store hours and address;
   - **the four warnings** at no less than 10% of the largest type size (§7.1). Since v1.1 the email itself always carries them (11 px against a 24 px headline, `EMAIL_FONT_PX` in `newsletter-email-core.ts`); keep them in the PDF too, because the PDF is advertising on its own.
3. **Export the PDF** (Canva → Share → Download → PDF Standard). Keep it under 4 MB.
4. **Blog & Newsletter → New post.** Category **NEWSLETTER**, kind **Newsletter**. The title becomes the email subject, as *"Greenway Marijuana: [title]"* (L203). Write a short excerpt and add 1–3 paragraphs in the body, because the blog page shows them.
5. **Upload the PDF** in the newsletter section. Optionally add page image paths, one per line.
6. **Publish.** Saving the post again keeps the PDF unless you upload a new one (fixed in N-1, F-22-6).
7. **Send Center → choose the newsletter → Test send** to your own address. Check that:
   - the subject is right;
   - the button opens the blog page;
   - the PDF opens;
   - the unsubscribe link is there;
   - it looks right on a phone.
8. **Broadcast (owner or admin only):** check the recipient count, then tick **"I confirm…"** and press **Send to everyone**. You cannot broadcast the same newsletter again for one hour (`BROADCAST_COOLDOWN_MS`, L252).
9. **You can leave the page (since v1.2, N-2).** The send is queued, one row per address in `newsletter_send_recipients`, and goes out in batches of 100 through Resend's batch endpoint, each batch with its own `Idempotency-Key` (`newsletter-queue-server.ts`, rules in `newsletter-batch-core.ts`). It starts right after you press Send, and the 5-minute content-schedule cron finishes whatever is left (`src/app/api/cron/content-schedule/route.ts`). A bar shows *"Sending: X of N sent…"* and the page updates itself every 15 seconds. An address already marked sent is never sent again. (Before migration 0362 is applied, the old way still runs: stay on the page until it finishes.)
10. Read the result in **Send history**: sent, partial or failed, with the counts.
11. **If some failed:** the owner or an admin presses **Retry failed** on that row. Only the failed addresses are queued again (with a new key); everyone who already has it is skipped. Each retry is audited (`newsletter.retry_failed`).

**The Sunday way (since v1.3, N-3).** Steps 8–9 can run by themselves on Sunday:

1. After step 7 (the test looks right), open the **Sunday newsletter** box in the Send Center and press **Ready for approval** on the newsletter (anyone with Blog access; audited `newsletter.ready`). The post does not have to be published yet.
2. **The owner or an admin** checks it and presses **Approve and schedule**. The time box starts at next Sunday at the set send time (Pacific); change it if you want. It must be in the future and within 60 days (audited `newsletter.approve`).
3. At that time the 5-minute content-schedule cron publishes the newsletter post if it is not published yet, then sends it to the loyalty list the same way as step 8 (queued in batches of 100). Audited `newsletter.scheduled_send`. Each approval sends once.
4. **Editing** an approved newsletter takes the approval back (it returns to Ready for approval, audited `newsletter.approval_voided`). The owner approves exactly what goes out.
5. **Back to draft** takes the ready mark or the approval away; it will not send.
6. If the send fails, the newsletter goes back to **Ready for approval** with the reason (audited `newsletter.scheduled_send_failed`). It is never retried by itself.
7. **Settings (owner or admin):** the Sunday send time (empty until you pick one, Q-22-4), and the reminder: on or off, day (default Friday), time (default 9:00 AM Pacific) and who gets it (empty = the store staff list). The reminder emails once that day only when no newsletter is ready, approved or sending (audited `newsletter.cadence_save`).

Code: `src/lib/cms/newsletter-cadence-core.ts` (rules, self-test 43), `newsletter-cadence-server.ts` (approvals, tick, reminder), table `newsletter_approvals` (migration 0363), `src/app/admin/newsletter/actions.ts`.

### 4.7 After the send: stats, unsubscribes, bounces

- **Send Center → Engagement (90 days):** delivered, opens, clicks, bounces and complaints per send. The data comes from the Resend webhook (`src/lib/cms/email-events/ingest-store.ts`, stored once per event).
- **Full report:** Reports → Customers → newsletter, with a CSV export (`src/app/admin/reports/customers/newsletter-export/route.ts`).
- **Unsubscribes** take effect immediately (`signups-store.ts` `unsubscribeByToken`).
- **Hard bounces and spam complaints opt the address out automatically** (N-1, `suppressBouncedAndComplained` in `ingest-store.ts`, audit action `newsletter.suppress`). Soft bounces, delays, opens and clicks never do. Gmail and Yahoo also show an **Unsubscribe** button now, because every email carries `List-Unsubscribe` + `List-Unsubscribe-Post` (one click, `POST /api/unsubscribe`).
- **What good looks like** (industry rule of thumb, not a law): keep spam complaints under 0.1%, and never reach 0.3%, which is Gmail's limit (§7.3).

### 4.8 The Marketing & Advertising hub (strategist, idea notebook, planner)

1. **Competitive playbook:** pick one play per category and run it on its cadence (weekly, monthly…).
2. **Campaign planner:** open a channel (Email newsletter, Website, Social, Event…) and work through its checklist. The newsletter checklist is the legal one:
   - opt-in list only;
   - 21+ statement;
   - all four warnings at 10% or more;
   - Washington residents;
   - a working unsubscribe;
   - no coupon below cost (`campaign-rules-core.ts` L78–96).
3. **AI strategist:** type a goal, for example "promote this week's vendor drop". You get a plan draft that is grounded in the store profile and your published vendors and scanned against the rules. A draft with a blocking flag cannot be saved (`strategy-ai.ts` L14–17).
4. **Idea notebook:** save the good drafts and work from them.
5. **Pictures:** Creative Studio (SOP-11b). Tick **"I checked the picture for minors appeal"** before you publish any banner.

## 5. Messages you may see, and what to do

| Message / sign | Meaning | Do this |
|---|---|---|
| Send Center lists **no newsletters** | Only *published* posts of kind *newsletter* with a *PDF* are sendable (`page.tsx` L80) | Publish the post, then upload the PDF again (F-22-6) |
| *"Tick the confirmation box before sending to everyone."* | The confirm tick was not ticked (`actions.ts` L57–58) | Tick it and send again |
| Broadcast refused, sent within the last hour | The 1-hour cooldown (`newsletter-send-store.ts` L316–330) | Wait. If the first send really failed, check the send history first, so nobody gets two copies |
| Result **partial** with "N recipient(s) failed to send." | Some calls to Resend failed (L405–414) | Since v1.2 each address has its own row. Press **Retry failed** on that send (owner/admin). Do not re-send to everyone |
| Send shows **sending** for a while | Queued in batches of 100 (v1.2). If the worker was cut off, the next 5-minute tick picks it up after a 4-minute lease | Wait; the bar keeps moving. Do not re-send. If it sits still for over 15 minutes, check that migration 0362 is applied and the content-schedule cron is running |
| "Not configured" in the Send Center | `RESEND_API_KEY` or the from address is missing (L41–47) | Set both in Vercel (Production), then redeploy. No spaces before or after the value (F-22-19) |
| AI button says AI is not configured | No AI key | Set `AI_API_KEY` or `OPENAI_API_KEY` |
| Alt text: *"… compliance flag(s) to review."* | The suggestion contains a watched word | Read it and change the words |
| A post with status **Scheduled** is not live | Before v1.3 nothing published it (F-22-5). Since v1.3 it goes live at the time in its Schedule panel | Check the time in the post's Schedule panel and that migration 0363 is applied. Before 0363, publish by hand |
| "You edited an approved newsletter, so it needs approval again before it can send." | The newsletter changed after it was approved (v1.3) | The owner or an admin approves it again in the Send Center's Sunday newsletter box |
| A newsletter went back to **Ready for approval** with "Last try failed" | The scheduled send failed (v1.3). It is never retried by itself | Read the reason, fix it, and approve it again with a new time |

## 6. Exceptions & troubleshooting

- **The PDF link vanished from a newsletter.** You saved the post without uploading the PDF again. The save writes an empty PDF and empty page images (`src/app/admin/blog/actions.ts` L201–226 → `src/lib/cms/blog-store.ts` L215–233). Upload the PDF again and save.
- **The email title shows odd characters** (for example `&amp;`, or the layout breaks after a `<`). The title goes into the email HTML unescaped (`newsletter-send-store.ts` L223, F-22-7). Avoid `<`, `>` and `&` in newsletter titles until N-1.
- **A member says they unsubscribed but still gets emails.** Check that their email address is not on two loyalty rows: the list is de-duplicated by email, but opt-out is stored per row. Opt out every row with that address.
- **A big list and a slow send.** Each email is its own call, 5 at a time, inside one request with no special time limit (F-22-3). The bigger the list, the closer it gets to the server's time limit. Since v1.2 (N-2) sending runs in the background in batches of 100 (Resend's batch limit), about 0.6 s apart, resuming on the next cron tick.
- **Gmail puts it in Promotions or Spam.** Check SPF, DKIM and DMARC on the sending domain in Resend. The missing one-click unsubscribe header (F-22-2) also counts against you at Gmail and Yahoo.
- **The AI wrote something generic or wrong.** It only knows what you put in Topic (F-22-10). Add the facts and run it again. Never publish facts you have not checked.

## 7. Controls & compliance

### 7.1 Washington advertising law (WAC 314-55-155, re-read 2026-11-12; RCW 69.50.369)

The blog, the newsletter, website banners and social posts are all **advertising**. The section's rules:

- **(2)(a) Never:**
  - (i) false or misleading;
  - (ii) promotes over-consumption;
  - (iii) alcohol;
  - (iv) tobacco or nicotine;
  - (v) motor vehicles or driving;
  - (vi) mimics LCB or state logos;
  - (vii) **curative or therapeutic effects**;
  - (viii) minors, or anything especially appealing to under-21s (toys, cartoons, characters).
- **(2)(c):** every ad carries a clearly visible 21+ statement.
- **(2)(d):** no marketing that targets people outside Washington.
- **(5):** no giveaways or branded merchandise, with narrow exceptions. Coupons may not price below acquisition cost (5)(g).
- **(6):** "free" or "donated" product is only for qualifying patients, under the medical endorsement.
- **(7):** every non-outdoor ad carries all four warnings at no less than 10% of the largest type size:
  - (a) *"This product has intoxicating effects and may be habit forming."*
  - (b) *"Cannabis can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug."*
  - (c) *"There may be health risks associated with consumption of this product."*
  - (d) *"For use only by adults 21 and older. Keep out of the reach of children."*

**Where the app stands:**

| Place | Status |
|---|---|
| Site footer | All four warnings (`Footer.tsx` L232) |
| Campaign planner | Lists all four for email (`campaign-rules-core.ts` L45–50, L86) |
| Newsletter email wrapper | **Does not** carry them (F-22-1) |
| Canva PDF | Carries them only if you put them in |

### 7.2 Email law (CAN-SPAM, 15 U.S.C. 7704)

What the law requires, and where the app stands:

| Requirement | Status |
|---|---|
| Accurate from and subject | Met: the subject is the post title |
| Physical postal address | Met: in the footer, L232 |
| A working opt-out | Met: per-member token link |
| Honor opt-outs within 10 business days | Met: immediate |
| Never sell or transfer opt-out addresses | Met: the app does not share them |

Consent is captured at loyalty sign-up (`loyalty-consent-core.ts`).

### 7.3 Gmail and Yahoo bulk-sender rules (in force since 2024)

Senders of about 5,000 or more messages a day to Gmail must:
- authenticate with SPF, DKIM and DMARC;
- support **one-click unsubscribe**: the `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058), handled within 2 days;
- keep the spam rate under 0.3%.

Yahoo's rules are similar. The app sends **no** `List-Unsubscribe` header (no match in `src/`; F-22-2). Your list may be under the threshold today. Build it anyway (N-1): it helps inbox placement at every size.

### 7.4 Google reviews

Google's Places API rules (re-read 2026-11-12) say:
- you may not copy and save user reviews;
- shown reviews must credit the author (name, photo, link);
- each review must link to the review on Google Maps;
- the page must say how the reviews were picked or ordered.

So for a blog or newsletter "review spotlight" there are two compliant paths, and Q-22-2 decides:
- **(A)** a live Google reviews block, shown with attribution and nothing stored;
- **(B)** reviews the owner picks and quotes word for word, with the reviewer's first name and a link to the review on Google, ideally with the reviewer's permission.

Never edit a review. Never use a review that mentions effects or health (§4.5). Avoid reviews from anyone who looks or sounds under 21.

### 7.5 AI rules (already built, keep them)

- **Drafts only:** the AI never publishes or sends.
- **Grounding:** the AI may only state facts it was given (`COMPLIANCE_SYSTEM`).
- **Compliance check:** every AI output is scanned against block and warn patterns (`checkCompliance`) plus your banned phrases (`kb_banned_phrases`). Blocking flags stop accept and save.
- **Audit:** AI runs are audited (`blog.ai.*`, `actions.ts` L307–313).
- **Grounded web search** (`generateWebSearch`, `provider.ts` L991) follows Google's grounding terms:
  - results are shown only to the person who asked;
  - nothing is cached;
  - only fields a person reviewed and saved are kept (`vendor-gemini-research-core.ts` L10–20).

  The news desk (N-6) must follow the same rules.

## 8. Forms

### 8.1 Weekly content brief (Monday)

| Item | Filled in |
|---|---|
| Week of (Mon–Sun) | |
| New vendors added (name, city, first products) | |
| Lots received last week, "fresh drops" (product, vendor, type) | |
| Promotions this week and next (name, dates, what is included, below-cost checked) | |
| Vendor days (vendor, date, time; no giveaways) | |
| Holidays or events in the next 14 days | |
| Reviews picked (reviewer first name, link, permission yes/no) | |
| Culture items (headline, source link, health topic yes/no) | |
| Posts to write (type, owner, due day) | |
| Newsletter send time (Sunday, time) | |

### 8.2 Pre-publish compliance checklist (every post and every newsletter)

| # | Check | Yes |
|---|---|---|
| 1 | Every fact checked against the back office or the cited source | |
| 2 | No health, cure, relief or therapeutic wording, and no effects sold as benefits | |
| 3 | No over-consumption, alcohol, tobacco, driving, or youth-appeal words **or pictures** | |
| 4 | "21+" visible | |
| 5 | Newsletter: all four warnings at ≥10% of the largest type size | |
| 6 | Sales: dates stated; no price below acquisition cost; no free cannabis | |
| 7 | Vendor day: no branded giveaways | |
| 8 | Reviews: word for word, attributed, linked, no health or effect mentions | |
| 9 | News: source named and linked | |
| 10 | Nothing aimed at people outside Washington | |
| 11 | Hero picture has alt text and no minors appeal | |
| 12 | Test email read on a phone (newsletter) | |

## 9. Quick reference

| I want to… | Go to | Notes |
|---|---|---|
| Get 6 post ideas | Blog post → Idea assistant | Evergreen, Trends or Local |
| Draft a post body | Blog post → AI → Write body | Paste the facts in Topic first |
| Draft a marketing plan | Marketing & Advertising → AI strategist | Save to the idea notebook |
| See state cannabis news | Regulatory Watch | WSLCB bulletins + briefings |
| Send the newsletter | Email Newsletter (Send Center) | Test first, tick confirm |
| See opens and clicks | Send Center → Engagement, or Reports → Customers | 90 days |
| Make a picture | Creative Studio | SOP-11b |

## 10. Glossary

- **Broadcast:** the send to the whole opted-in list (as opposed to a test).
- **Canvas (newsletter):** the in-app builder (N-8a, since v1.7). **Fill from this week** fills the sections from the week's facts and you edit, check and send. Canva is optional (attach its PDF if you like).
- **Culture post:** news, education or vendor-achievement content, as opposed to store news.
- **Fresh drops:** lots received in the last 7 days.
- **Grounded:** the AI writes only from facts it was handed (back-office data or cited sources), never from memory.
- **One-click unsubscribe:** the email header pair from RFC 8058 that lets Gmail or Yahoo show an "Unsubscribe" button.
- **Suppression:** never emailing an address again after a hard bounce or a spam complaint.

---

## Appendix A: Source map and external sources

### A.1 Source map (at `main@a4ccd7cb`)

| Area | Files |
|---|---|
| Send Center | `src/app/admin/newsletter/page.tsx` (324 lines), `actions.ts` (85), `src/lib/cms/newsletter-send-store.ts` (446), `src/components/admin/reports/NewsletterStatsSection.tsx` |
| Email events | `src/app/api/webhooks/resend/route.ts`, `sendgrid/route.ts`, `src/lib/cms/email-events/{normalize-core,verify-core,ingest-store}.ts`, migration `0050_newsletter_email_events.sql` |
| Data | `0005_slice5_cms.sql` (`blog_posts`, `newsletter_assets`), `0014_blog_title_typography.sql`, `0016_newsletter_sends.sql`, `0017` (opt-out, token), `0008_slice8_loyalty.sql` |
| Blog admin | `src/app/admin/blog/{page,actions}.tsx/ts`, `[id]`, `new`, `content`; `src/components/admin/blog/{BlogEditorClient,BlogIdeaAssistant}.tsx` |
| Blog AI | `src/lib/cms/ai-blog.ts`, `ai-blog-ideas.ts`; `src/lib/ai/{compliance,provider,accept-gate}.ts` |
| Blog store and public | `src/lib/cms/blog-store.ts` (350), `src/lib/blog/{posts,blog-content-core,title-style,format-date}.ts`, `src/app/(site)/blog/page.tsx`, `[slug]/page.tsx` |
| Schedule | `src/lib/cms/content-schedule-core.ts` (target kinds L32–38), cron `/api/cron/content-schedule` every 5 min (`vercel.json`) |
| Marketing | `src/app/admin/marketing/{page,actions}`, `src/lib/marketing/{strategy-ai,campaign-rules-core,competitive-playbook-core,ideas-store,canva-core,ad-check-core,creative-ai}.ts` |
| Reusable for Phase N | `src/lib/regulatory/regulatory-ingest.ts` (WSLCB feed), `provider.generateWebSearch` (L991), `src/lib/vendors/vendor-gemini-research-core.ts`, `src/lib/media/{library-picker-core,library-picker-server,media-describe-core}.ts`, `src/lib/vendors/store.ts` `listVendors`, promotions (`0006`), lots received date (`0214`) |
| Help | `src/lib/admin/concierge-kb.ts` topic `blog-newsletter` (says "scheduling"; true since v1.3, N-3 added the blog Schedule panel and the Sunday approval facts) |

### A.2 External sources (read 2026-11-12)

- WAC 314-55-155 Advertising (eff. 2026-07-04): https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-155
- RCW 69.50.369: https://app.leg.wa.gov/RCW/default.aspx?cite=69.50.369
- FTC, CAN-SPAM Act compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Google, Email sender guidelines: https://support.google.com/a/answer/81126
- RFC 8058, one-click unsubscribe: https://www.rfc-editor.org/rfc/rfc8058
- Google Places API policies (reviews attribution, no caching): https://developers.google.com/maps/documentation/places/web-service/policies
- Resend, Send Batch Emails (up to 100 per call, `headers`, `Idempotency-Key`; attachments not supported in batch): https://resend.com/docs/api-reference/emails/send-batch-emails

---

## Appendix B: Findings, gaps and the roadmap strategy

### B.1 Findings (full text in 03)

| ID | Sev | Type | Finding | Pin |
|---|---|---|---|---|
| F-22-1 | **S1** | DEFECT | Newsletter email lacks the four WAC 314-55-155(7) warnings (only "For adults 21+. Keep out of reach of children.") | `newsletter-send-store.ts` L231–236; rule in `campaign-rules-core.ts` L86, L96 |
| F-22-2 | S2 | GAP | No `List-Unsubscribe` / `List-Unsubscribe-Post` header; the unsubscribe page is a GET page only | `newsletter-send-store.ts` L270–281; `unsubscribe/page.tsx` L17–33 |
| F-22-3 | S2 | WEAKNESS | Broadcast runs inside one server action, one email per call, 5 at a time, no per-recipient record, no resume, no batch API, no idempotency key | L384–414 |
| F-22-4 | S2 | GAP | Hard bounces and complaints are stored but never suppress the address | `ingest-store.ts`; no `email_opt_out` write in webhook path |
| F-22-5 | S2 | DEFECT | Blog "Scheduled" status never publishes; `blog_post` is not a schedule target; the list and the concierge imply it works | `content-schedule-core.ts` L32–38, L295; `blog-store.ts` L193–203; `blog/page.tsx` L49, L116; `concierge-kb.ts` L278 |
| F-22-6 | S2 | DEFECT | Saving a newsletter post without a new PDF erases `pdf_media_id` and `page_media_ids`; the post drops out of the Send Center | `blog/actions.ts` L201–226; `blog-store.ts` L215–233; `newsletter/page.tsx` L80 |
| F-22-7 | S3 | DEFECT | Post title inserted into email HTML unescaped | `newsletter-send-store.ts` L223 |
| F-22-8 | S2 | GAP | No newsletter canvas: the email body is a fixed sentence + button; no sections, preheader or plain-text part; Canva PDF is the only design path | L204–242; `newsletter/page.tsx` L104 |
| F-22-9 | S2 | GAP | No Sunday cadence: no scheduled send, no reminder, no "ready for approval" state | (absence) |
| F-22-10 | S2 | GAP | AI blog writer is ungrounded (title, category, topic only; "Do not mention price, stock, or specific inventory"; 500 tokens) | `ai-blog.ts` L35, L85; `blog/actions.ts` L296–300 |
| F-22-11 | S2 | GAP | No "this week at Greenway" facts feed, although the data exists (vendors `created_at`, lot received date, promotions window, vendor-day flag) | `0003` L38, `0214`, `0006` L78–81, `PromotionForm.tsx` L281 |
| F-22-12 | S3 | GAP | No Google reviews source; Google's terms forbid storing reviews | (no match in `src/`); Places policies |
| F-22-13 | S2 | GAP | No news desk for culture posts; WSLCB feed and grounded web search exist but aren't wired to the blog | `regulatory-ingest.ts`; `provider.ts` L991; `ai-blog-ideas.ts` L74 |
| F-22-14 | **S1** | RISK | "Medical benefits" content collides with WAC 314-55-155(2)(a)(vii); no health-topic guard beyond the general check | WAC; `compliance.ts` |
| F-22-15 | S3 | GAP | Hero is upload-only (no Digital Assets picker, 4 MB); body is plain paragraphs (no headings, inline images, product cards, links) | `blog/actions.ts` L38, L166; `BlogEditorClient.tsx` L34; `[slug]/page.tsx` L128–129 |
| F-22-16 | S3 | WEAKNESS | Body/SEO AI compliance flags are computed but not shown at generate time | `ai-blog.ts` L86–94; `blog/actions.ts` L289–317 |
| F-22-17 | S3 | WEAKNESS | Every `blog.manage` role (including content_editor) can broadcast to the whole list | `newsletter/actions.ts` L52; `roles.ts` L112 |
| F-22-18 | S3 | GAP | Public blog has no category filter or Culture section | `(site)/blog/page.tsx` |
| F-22-19 | S4 | WEAKNESS | Email config does not trim values; a misleading comment about recipients | `newsletter-send-store.ts` L41–47, L274–278 |
| F-22-20 | S3 | GAP | No Article structured data (JSON-LD) on blog posts | no `ld+json` under `src/app/(site)/blog` |
| F-22-C | — | STRENGTH | What already works (B.2) | — |

### B.2 What already works (keep it)

- **Recipients:** consent-only, opt-out respected, de-duplicated (`newsletter-send-store.ts` L155–177). Each email carries its own unsubscribe token.
- **Send safeguards:**
  - a test send;
  - the confirm tick;
  - the 1-hour duplicate cooldown;
  - an audit row on every broadcast;
  - every message tagged with the send and post ids, so engagement ties back to the campaign.
- **Engagement events:** signature-verified and stored once per event (`ingest-store.ts`). 90-day stats and a CSV export.
- **AI guardrails:**
  - `COMPLIANCE_SYSTEM`;
  - `checkCompliance` plus your banned phrases;
  - drafts only, with the accept gate;
  - audit;
  - a strategist grounded in the store profile and vendors.
- **The campaign planner** carries the real WAC and CAN-SPAM checklist per channel.
- **Pieces Phase N can reuse:**
  - the Regulatory Watch WSLCB feed;
  - grounded Gemini web search with Google-terms handling;
  - the Digital Assets library picker (used on products);
  - AI picture descriptions;
  - the 5-minute content-schedule cron;
  - the Canva button;
  - the Creative Studio and the advertising check (SOP-11b C-8).

### B.3 Gaps (full text in 05)

| Gap | What | Findings | Slice |
|---|---|---|---|
| G-108 | Four warnings + 21+ in every newsletter email (≥10% type rule) | F-22-1 | N-1 |
| G-109 | One-click unsubscribe headers + POST endpoint | F-22-2 | N-1 |
| G-110 | Keep the newsletter PDF on save; escape the title; trim config | F-22-6, F-22-7, F-22-19 | N-1 |
| G-111 | Suppress hard bounces and complaints; broadcast gate (Q-22-3) | F-22-4, F-22-17 | N-1 |
| G-112 | Background, batched (100), resumable, idempotent sending with per-recipient record and progress | F-22-3 | N-2 |
| G-113 | Blog scheduling through the 5-minute cron; Sunday scheduled send with "ready for approval" | F-22-5, F-22-9 | N-3 |
| G-114 | "This week at Greenway" facts feed (new vendors, fresh drops, promotions, vendor days, holiday calendar) | F-22-11 | N-4 |
| G-115 | Grounded AI content engine: post-type templates, headline options, longer structured drafts, auto-picked library images, flags shown | F-22-10, F-22-16 | N-5 |
| G-116 | Culture news desk: WSLCB + sourced web news, vendor achievements, health-topic guard | F-22-13, F-22-14 | N-6 |
| G-117 | Rich post body (blocks), library picker for hero and inline images, Culture filter, Article JSON-LD | F-22-15, F-22-18, F-22-20 | N-7 |
| G-118 | Newsletter canvas (sections, AI fill, preview desktop/phone, preheader, plain text, PDF optional) | F-22-8 | N-8 |
| G-119 | Reviews spotlight (per Q-22-2) | F-22-12 | N-9 |
| G-120 | Help: helper, concierge topics corrected and added, "Sunday checklist" page | F-22-5 (concierge wording) | N-10 |

### B.4 The roadmap strategy (Phase N, APPROVED D237)

**The order:**
1. Make what goes out today legal and safe (N-1, N-2).
2. Make time work: scheduling and the Sunday cadence (N-3).
3. Give the AI real facts (N-4), then teach it to write each post type (N-5) and culture (N-6).
4. Build the rich post (N-7) and the canvas (N-8) on top.
5. Add reviews (N-9) and help (N-10).

Every slice keeps the rule that a person approves before anything is published or sent.

| Order | Slice | What it delivers | Gaps | Depends on |
|---|---|---|---|---|
| **N-1** | **Send hardening** (small, first) · **BUILT (D237, #1774)** | All four warnings + 21+ in the email footer (pure footer core with a self-test that the four strings match `REQUIRED_WARNINGS` and the type size is ≥10% of the headline size). `List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post` headers. A POST one-click endpoint. Title and URL escaping. Keep the existing PDF and pages unless a new file is uploaded or "Remove" is ticked. Trim env values. Hard bounce or complaint → `email_opt_out` (audited). Broadcast limited per Q-22-3 | G-108 … G-111 | Q-22-3 |
| **N-2** | **Reliable sending** · **BUILT (D237, #1775)** | `newsletter_send_recipients` table (one row per address, status). Resend batch endpoint, 100 per call, with an `Idempotency-Key` per batch. A cron worker sends and resumes. A progress bar in the Send Center. "Retry failed only". The send never double-sends | G-112 | N-1 |
| **N-3** | **Scheduling + Sunday cadence** · **BUILT (D237, #1776)** | `blog_post` publish/unpublish as a schedule target (the same audited 5-minute cron and calendar as SOP-11b). Newsletter states: draft → ready for approval → approved → scheduled (Sunday, set time) → sending → sent. A reminder on Friday if nothing is ready. The owner approves on the phone | G-113 | N-2; Q-22-4 |
| **N-4** | **"This week" facts feed** · **BUILT (D237, #1777)** | A pure core + server reader that returns last week's new vendors, lots received (fresh drops, grouped by vendor and type), promotions active and next 14 days (with dates and the below-cost check), vendor days, and a holiday and cannabis-calendar list (US holidays, 4/20, 7/10, local events you add). Shown as a card on Blog & Newsletter and given to the AI | G-114 | — |
| **N-5** | **Grounded AI content engine** · **BUILT (D237, #1778)** | "New post from…" picker with 7 templates: new vendor, fresh drops, review spotlight, sale, vendor day, holiday, culture. Each sends only the feed facts for that item. Prompts for 5 headline options + excerpt + structured body (headings, short paragraphs, call to action) within the WAC rules. Suggests 3 pictures from Digital Assets (vendor and product links, AI descriptions). Shows the compliance flags in the draft. Drafts only | G-115 | N-4; Q-22-8 |
| **N-6** | **Culture news desk** · **BUILT (D237, #1779)** | Sources: Regulatory Watch items (WSLCB), grounded web search for federal and national cannabis news (shown to the asker with sources; only reviewed text is saved), vendor achievements from vendor research. Each culture draft carries its source links. A **health-topic guard**: if the text touches health, it needs a cited source, adds the "talk to your healthcare provider" line, blocks product and deal links in that post, and blocks therapeutic wording outright | G-116 | N-5; Q-22-1, Q-22-6 |
| **N-7** | **Rich posts** | Block body (heading, paragraph, image from library, product card, quote, call-to-action button, source list), stored backward-compatible with today's `text[]` paragraphs. Digital Assets picker for hero and inline images. Culture and Store filters on `/blog`. Article JSON-LD | G-117 | Q-22-7 |
| **N-8** | **Newsletter canvas** · **N-8a BUILT (D238, #1781)** · **N-8b AI studio BUILT (D238, #1782)** · **N-8c motion + interactive BUILT (D238, #1783)** | An in-app email builder made of sections:<br>• header;<br>• headline;<br>• fresh drops;<br>• new vendor;<br>• deals;<br>• from the blog;<br>• culture pick;<br>• review;<br>• hours;<br>• the fixed footer with the warnings and unsubscribe.<br>"Fill with AI" uses the week's feed and posts. Desktop and phone preview, preheader, plain-text part, test send. The Canva PDF stays available as an optional "View as PDF" link | G-118 | N-1 … N-5; Q-22-5 |
| **N-9** | **Reviews** | Per Q-22-2: (A) a live Google reviews block with attribution and nothing stored, and/or (B) a "Curated reviews" list (quote, first name, Google link, permission tick) usable in posts and the canvas | G-119 | Q-22-2 |
| **N-10** | **Help** | Helper on Blog & Newsletter and the Send Center. Concierge `blog-newsletter` corrected, plus new `newsletter-sunday` and `culture-posts` topics. A "Sunday checklist" strip (Forms 8.1 and 8.2 in the app) | G-120 | after each slice |

**Interim (until built):** follow §4.2–§4.7 by hand, put the four warnings in the Canva design, upload the PDF again on every save, publish by hand, and opt out bounces and complaints by hand.

## Appendix C: Owner questions

| # | Question | Options (recommended first) |
|---|---|---|
| Q-22-1 | **Medical benefits content.** WAC 314-55-155(2)(a)(vii) bans therapeutic claims in all advertising. How should culture posts handle health? | (a) **Cited news and research reporting only, no product links, the "talk to your provider" line, no claims (N-6 guard).** (b) Skip health topics entirely. (c) Something else (needs legal advice) |
| Q-22-2 | **Google reviews.** | (a) **Curated: you pick reviews, quoted word for word with first name and link, with permission when possible.** (b) A live Google block (needs a Google Maps Platform key and billing; nothing stored; attribution rules). (c) Both |
| Q-22-3 | **Who may broadcast to the whole list?** | (a) **Owner and admin only; managers and content editors can prepare and test.** (b) Keep it as is (anyone with `blog.manage`). (c) A second person must approve |
| Q-22-4 | **Sunday send time and automation.** | (a) **AI drafts by Thursday; you approve; it sends automatically at a fixed Sunday time (please name the time, Pacific).** (b) Someone presses Send on Sunday. (c) Fully automatic (not recommended) |
| Q-22-5 | **Canvas vs Canva.** | (a) **Build the in-app canvas (N-8); keep Canva PDF as an optional link.** (b) Keep Canva as the main design tool and only improve the email wrapper |
| Q-22-6 | **AI web search for news** costs per lookup (within your AI budget cap). OK to use it for the culture desk? | (a) **Yes, on demand only (a person presses "Find news").** (b) Yes, plus a weekly automatic digest. (c) No; Regulatory Watch and manual sources only |
| Q-22-7 | **Where does Culture live on the website?** | **Answered D237:** on the existing `/blog` page as the existing **CULTURE** card (not a tab, not a separate page). All other questions: the recommended option (a) is approved; Q-22-4 send time not named yet, so it is a setting |
| Q-22-8 | **Prices and deals in AI posts.** The AI is told never to mention price or stock today. | (a) **Allow prices and dates in Sale and Vendor-day posts only, taken from the promotion (never typed by the AI), with the below-cost check.** (b) Keep prices out of posts |
| Q-22-9 | **Vendor claims** (awards, "best", potency records). | (a) **Only with a source link; the AI never adds superlatives.** (b) Allow the vendor's own wording |

## Appendix D: Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-11-12 | Recon, audit and roadmap (D236). Verified at `main@a4ccd7cb`. 20 findings (F-22-1 … F-22-20) + F-22-C: 2×S1 (F-22-1, F-22-14), 10×S2, 7×S3, 1×S4. Gaps G-108 … G-120. Phase N (N-1 … N-10) PROPOSED. Questions Q-22-1 … Q-22-9. No code changed |
| 1.1 | 2026-11-12 | **N-1 send hardening built (D237, #1774).** Four warnings in every newsletter email at ≥10% of the largest type (G-108); `List-Unsubscribe` + one-click `POST /api/unsubscribe` (G-109); PDF kept on save, title escaped, config trimmed (G-110); hard bounce / complaint → `email_opt_out` audited, broadcast owner/admin only via `newsletter.broadcast` (G-111). Culture = CULTURE card on `/blog` (D237). Test `tests/compliance/d237-newsletter-n1-send-hardening.test.ts`; self-test `__runNewsletterEmailCoreTests` (35) |
| 1.3 | 2026-11-12 | **N-3 scheduling + Sunday cadence built (D237, #1776).** Migration 0363: `content_schedule` accepts `blog_post` (publish/unpublish through the 5-minute cron; Schedule panel on the post; Scheduled status set by the schedule, the bare button refused) and table `newsletter_approvals` (service role only, RLS on, FK only to `blog_posts`). Sunday cadence: Ready for approval (Blog access) → Approve and schedule with a Pacific time (owner/admin) → the cron publishes and sends; edit voids the approval; a failure returns to Ready, never retried by itself. Settings in `site_settings` `newsletter_cadence`: Sunday send time (empty, Q-22-4), reminder default Friday 9:00 AM, once a day via `compliance_reminder_log` (G-113, F-22-5, F-22-9). Test `tests/compliance/d237-newsletter-n3-schedule-cadence.test.ts`; self-test `__runNewsletterCadenceCoreTests` (43) |
| 1.4 | 2026-11-12 | **N-4 "This week" facts feed built (D237, #1777).** Pure core `src/lib/cms/this-week-feed-core.ts` (window, offer text in cents, deal classification, holiday and cannabis calendar, local events parser, AI fact lines that leave out below-cost deals) and server reader `this-week-feed-server.ts` (lots paged and checked, vendors and promotions bounded, below-cost audit). Card `ThisWeekFeedCard.tsx` on `/admin/blog`; local events saved in `site_settings` `blog_calendar_events` (audited `blog.local_events_save`). No migration (G-114, F-22-11). Test `tests/compliance/d237-newsletter-n4-this-week-feed.test.ts`; self-test `__runThisWeekFeedCoreTests` (44) |
| 1.5 | 2026-11-12 | **N-5 grounded AI content engine built (D237, #1778).** Pure core `src/lib/cms/post-templates-core.ts` (7 templates, items from the This-week feed with below-cost deals held back, notes rules, prompt, output normalizer, owner-rule checks: superlatives, prices/percents only in Sale and Vendor-day and only as in the promotion, dates, links; picture ranking) and server `post-templates-server.ts` (re-reads the feed, `generateJSON`, `checkCompliance`, Digital Assets pictures, the final check on save). Actions `loadTemplateItemsAction`, `draftFromTemplateAction` (audited `blog.ai.template_draft`), `createPostFromDraftAction` (refuses must-fix; creates a Draft). Picker `NewPostFromPicker.tsx` on `/admin/blog/new`; the This-week card links to it. No migration (G-115, F-22-10, F-22-16). Test `tests/compliance/d237-newsletter-n5-grounded-ai.test.ts`; self-test `__runPostTemplatesCoreTests` (43) |
| 1.6 | 2026-11-12 | **N-6 culture news desk + health-topic guard built (D237, #1779).** Pure core `src/lib/cms/culture-desk-core.ts` (health detection, therapeutic wording blocked, source required, provider line, product/menu/deal links blocked on health, `withGuardLines`, WSLCB items to news, Find-news prompt and the cited-only parser) and server `culture-desk-server.ts` (Regulatory Watch read bounded with `.range`, `generateWebSearch` on demand, culture draft through the N-5 culture template, the guard for saved posts). Actions `listDeskNewsAction`, `findNewsAction` (audited counts only, `blog.culture.find_news`), `draftCultureAction` (`blog.culture.draft`), `createCulturePostAction` (CULTURE Draft; refuses must-fix). Guard on Publish (`setPostStatusAction`, audited `blog.culture_guard_refused`) and on the scheduled publish (`applyBlogPostChange`). Desk `CultureNewsDesk.tsx` on `/admin/blog/new`; guard panel on the post editor. No migration (G-116, F-22-13, F-22-14). Test `tests/compliance/d237-newsletter-n6-culture-desk.test.ts`; self-test `__runCultureDeskCoreTests` (44) |
| 1.7 | 2026-11-12 | **N-8a newsletter canvas, send checks, compression and QR built (D238, #1781).** Pure core `src/lib/cms/newsletter-canvas-core.ts` (block model and normalizer, email-safe table render with the fixed warnings + unsubscribe footer, plain text, UTM per block, `checkCanvas` with the Gmail 102 KB clip, image weight/format/width/alt checks, `planEmailCompress`, `cardsFromFeed`, `isProbeableUrl`) and server `newsletter-canvas-server.ts` (stored in `site_settings` key `newsletter_canvas:<postId>`, image probe with a timeout and size cap, sharp compression into new Media copies, QR PNG, Fill from this week, test send). Actions in `src/app/admin/newsletter/canvas/actions.ts` (`blog.manage`; audited `newsletter.canvas.create/save/compress/qr/upload/test_send`); editor `NewsletterCanvasEditor.tsx` on `/admin/newsletter/canvas/[id]`. Broadcast (`sendNewsletter`) and the queue send the canvas when it is on, and refuse must-fix items. No migration (G-118, F-22-8). Test `tests/compliance/d237-newsletter-n8a-canvas.test.ts`; self-test `__runNewsletterCanvasCoreTests` (82) |
| 1.8 | 2026-11-12 | **N-8b canvas AI studio built (D238, #1782).** Pure core `src/lib/cms/newsletter-ai-core.ts` (`checkAiCopy`: no invented money/percent/links, no superlatives or health words; `canvasFacts` with below-cost deals held back; `buildLayoutPrompt`/`normalizeLayout`/`applyLayout` (ai-note blocks + button; cards untouched); `editableWords`/`buildImprovePrompt`/`applyImproved` (review locked; only word fields change); `buildSubjectPrompt`/`normalizeIdeas`; picture presets, shapes, `checkImageAsk` (WAC 314-55-155 themes), `IMAGE_SAFETY_SUFFIX`, GPT Image edit/generate bodies (transparent PNG for Remove background), Gemini Interactions body, response parsers) and server `newsletter-ai-server.ts` (budget guard, AI usage ledger, `checkCompliance`, sharp input resize, results saved to Media; FLUX via `flux-client` with browser polling). Actions `src/app/admin/newsletter/canvas/ai-actions.ts` (`blog.manage`; audited `newsletter.canvas.ai_build/ai_improve/ai_subjects/ai_image/ai_image_flux_ready`); panel `CanvasAiStudio.tsx` in the editor's tool slot. No migration (G-118). Test `tests/compliance/d237-newsletter-n8b-ai-studio.test.ts`; self-test `__runNewsletterAiCoreTests` (60) |
| 1.9 | 2026-11-12 | **N-8c moving and interactive canvas built (D238, #1783).** Pure core `src/lib/cms/newsletter-motion-core.ts` (seven-segment countdown SVG without fonts, `countdownFrameSeconds`, `parseCountdownQuery` (at most a year ahead), `countdownImageUrl`, `planGifBuild` (2-10 frames) and `gifRetry`, `pollContent`/`blockOfUrl`, `canvasClickReport`) and server `newsletter-motion-server.ts` (`buildCanvasGif` with sharp `join.animated` into Media, `countdownGif`, `canvasClicksFor` from `newsletter_email_events` paged, `webVersionFor`). New canvas blocks `countdown` and `poll` in `newsletter-canvas-core.ts` (render, plain text, checks, `pollTarget` keeps votes on our site). Routes `/api/newsletter/countdown` (no-store GIF) and `/newsletter-web/[slug]` (CSP default-src none). Action `buildGifAction` (audited `newsletter.canvas.gif`); `CanvasGifMaker.tsx`, `CanvasClickReport.tsx`. No migration (G-118). Test `tests/compliance/d237-newsletter-n8c-motion.test.ts`; self-tests `__runNewsletterMotionCoreTests` (49), canvas core now 90 |
| 1.2 | 2026-11-12 | **N-2 reliable sending built (D237, #1775).** Migration 0362 `newsletter_send_recipients` (one row per address, service role only, no FK, emptied with `newsletter_sends` by a TRUNCATE trigger) and the `sending` status + `claimed_at` lease on `newsletter_sends`. Resend batch endpoint, 100 per call, `Idempotency-Key` per batch and round; retry on 429/5xx/network up to 3 tries; worker started after Send and resumed by the 5-minute content-schedule cron (no new cron). Progress bar, auto-refresh, **Retry failed** (owner/admin, audited). Inline fallback until 0362 is applied (G-112, F-22-3). Test `tests/compliance/d237-newsletter-n2-reliable-sending.test.ts`; self-test `__runNewsletterBatchCoreTests` (42) |
