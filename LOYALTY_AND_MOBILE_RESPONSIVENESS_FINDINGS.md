# Loyalty Submission Access and Mobile Responsiveness Findings

## Date
Investigation performed during the current Greenway preview session.

## Immediate answer: where loyalty submissions go
The Greenway loyalty form currently posts to the internal Next.js API route:

`/api/loyalty-signup`

When a submission succeeds in the preview environment, it is appended to this local JSONL file inside the project:

`storage/loyalty-signups.jsonl`

Each line is one signup record. The record includes the submitted name, birthday, phone, email, contact preference, selected store, consent flags, signature, timestamp, generated ID, and notification status.

A preview-only review page has also been added here:

`/admin/loyalty-signups`

Preview URL:

`https://01cur.app.super.myninja.ai/admin/loyalty-signups`

Important security note: this review page is intentionally marked as preview/internal. It must not be published in production without staff authentication, IP restriction, or replacement by a secure CRM/POS/email workflow. Cannabis-related customer information is sensitive and should not be exposed on a public admin page.

## What was found in storage
The local preview storage file exists and currently contains one test signup created during development verification:

`Preview Customer`

The signup the owner attempted from the public preview was not present in `storage/loyalty-signups.jsonl` at the time of this investigation. That means the submitted form either did not fully submit, did not reach the current preview server, failed validation, or was interrupted by the interaction/performance issue being reported.

## How to inspect submissions right now
For this preview session, use the review page:

`https://01cur.app.super.myninja.ai/admin/loyalty-signups`

Alternatively, from the project workspace, inspect the raw file:

`greenway-site/storage/loyalty-signups.jsonl`

Because the raw file contains personal information, do not commit it, publish it, or share it casually. The file is now listed in `.gitignore`.

## Notification status behavior
The current signup system supports an optional webhook environment variable:

`LOYALTY_SIGNUP_WEBHOOK_URL`

If this variable is not configured, successful signups are still stored locally, but their `notificationStatus` is:

`webhook-not-configured`

That is expected in the current preview. It means the signup was stored, but no live email, SMS, POS, or staff notification was sent. This is intentional until Greenway chooses a real production workflow.

## Mobile/hamburger responsiveness investigation
The hamburger menu was tested on the running local preview. The automated browser was able to click the hamburger button and the menu opened. Main site routes also returned HTTP 200 successfully:

- `/`
- `/menu`
- `/specials`
- `/locations`
- `/loyalty`
- `/price-match`
- `/faq`
- `/blog`
- `/about`

This means the full site is accessible and the hamburger is not completely broken in the running environment.

## Likely causes of slow or unreliable mobile interaction
The issue appears to be a combination of preview-environment latency and front-end interaction risks rather than a missing route.

### 1. The exposed URL is tunneling to a Next.js development server
The public preview URL is served through an exposed sandbox port. The app is currently running in Next development mode, not an optimized production server. Development mode can be noticeably slower, especially on mobile over a tunnel. First taps may trigger compilation, hydration, or delayed client-side code execution.

### 2. The mobile menu uses a portal, full-screen overlay, backdrop blur, and full-screen drawer
`MobileNavigation.tsx` renders the drawer into `document.body` with `createPortal`. When open, it creates a full-screen fixed overlay, a full-screen background button, and a full-screen drawer. This does work, but it is more complex than necessary on mobile and can feel sticky or delayed on slower devices.

### 3. The background page remains visible to the accessibility tree
When the menu opens, the browser tool still sees underlying page form inputs in the accessibility tree. Visually the drawer appears, but underlying elements are still discoverable. This may not directly block taps, but it is a sign that focus/inert management is incomplete. A production-quality drawer should hide or inert the background content while the dialog is open.

### 4. Heavy visual effects may contribute to lower-end mobile lag
The site uses sticky headers, backdrop blur, radial gradients, shadows, and full-screen overlays. These look good, but on a tunneled dev preview or weaker mobile browser they can make taps and scroll feel sluggish.

### 5. There was a duplicate attempted dev server
A second `npm run dev` attempt tried to start on port 3001 because port 3000 was already in use. The main live preview is still port 3000 and routes are working, but duplicate dev server attempts can confuse testing and logs. Keeping a single stable server is preferable.

## Recommended fix roadmap

### Priority 1: Make preview inspection more reliable
Run the site in production preview mode for user review instead of Next dev mode:

1. Stop dev server.
2. Run `npm run build`.
3. Run `npm run start -- --port 3000` or equivalent.
4. Expose port 3000 again.

This should reduce hydration/compilation delays and make the hamburger/menu feel more realistic.

### Priority 2: Simplify and harden the mobile drawer
Refactor `MobileNavigation.tsx` so the mobile drawer has fewer moving pieces and better interaction behavior:

- Add explicit `z-index` to the drawer above the backdrop.
- Use a non-button backdrop element or ensure the backdrop cannot overlap drawer content.
- Add `pointer-events-none` to the outer wrapper and `pointer-events-auto` only to the backdrop and drawer.
- Remove or reduce `backdrop-blur` on the mobile overlay.
- Add focus management so keyboard and screen-reader focus moves into the drawer.
- Mark the rest of the app inert or hidden to assistive technology while the menu is open.
- Change active link state so Home is not always highlighted on every route.

### Priority 3: Add a clear form success and error experience
Although the API storage path works, the owner’s attempted public submission did not appear in the storage file. Improve the form UX so a user cannot miss whether submission succeeded:

- Scroll the user to the success message after submit.
- Make success message sticky or place it immediately above the button as well as above the form.
- Add a visible failure message if the API rejects or times out.
- Disable the button during submission and re-enable it reliably.
- Consider adding a small “submission reference ID” copy button.

### Priority 4: Add a secure staff notification path
Local JSONL storage is acceptable only for preview. For real operations, choose one of these:

- Email notification through a transactional provider.
- Secure webhook to Slack, Zapier, Make, Airtable, Google Sheets, or a CRM.
- Direct integration to the POS/loyalty provider if supported and approved.

Until then, keep the language as “captured for staff review and manual POS entry,” not “automatically added to POS.”

### Priority 5: Secure or remove the preview admin page before production
The new `/admin/loyalty-signups` page is useful for preview review but unsafe as a public production admin page. Before launch, either:

- Add authentication and authorization,
- Restrict it to internal networks,
- Move review into a secure third-party tool,
- Or remove it entirely and rely on secure notifications.

## Current status
The site routes are reachable, the hamburger opens in automated testing, and the loyalty API can store submissions. The user-reported issue is credible because the public exposed dev preview can be slow and the mobile drawer/form interactions need hardening. The next best engineering slice is to stabilize preview mode and simplify/fix the mobile navigation overlay before continuing with additional page features.
