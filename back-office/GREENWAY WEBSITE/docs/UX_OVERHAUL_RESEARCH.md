# Greenway Back Office — UX Overhaul Research & Design Principles

> **Why this exists:** The owner (a small family cannabis business, non-technical) wants the back office to feel like Squarespace/Wix — visual, see-what-you-edit, bulletproof, helper-rich, and AI-first (AI does the work, humans review). This document captures the research that grounds the overhaul, distilled into concrete principles and patterns we will apply slice-by-slice.
>
> **STANDING RULE (read every session):** Before touching any slice, re-read this file + `UX_OVERHAUL_ROADMAP.md` + `UX_OVERHAUL_CHECKLIST.md` + the master `BACK_OFFICE_BUILD_TODO.md`. Then walk the project tree (`find src/app/admin -name page.tsx`, `ls src/components/admin`, `ls src/lib`) and trace the logic flow for the page you're about to change so nothing already built is lost or duplicated.

---

## Sources consulted (Dec 2025)
- **NN/g — Designing Empty States in Complex Applications** (nngroup.com): empty states must communicate system status, teach, and provide a direct pathway to the next action. Never show a blank container; never show a misleading "No records" while loading.
- **Aspirity — How to Create a Good Admin Panel**: simple/clean UI, multi-column nav with the current module clearly labeled, tooltips next to complex controls, icons as guide marks, optimistic locking for concurrent edits, audit with soft-delete, role-based permission matrix, mobile-first (staff use phones/tablets at the counter).
- **Unlayer — 4 Approaches to Visual Editing in a Headless CMS**: (1) visual edit buttons / click-to-edit overlays, (2) live preview, (3) component composition, (4) full no-code builder. Best practice = **combine** approaches: inline buttons for small fields, live preview for structured pages, guardrails + roles + versioning throughout. Governance (audit, versioning, permissions) is mandatory once editing is visual.
- **Sanity — Overlays & click-to-edit**: the canonical implementation of "click the thing on the page to edit it." A preview iframe renders the real page; transparent overlays sit on editable elements; clicking an overlay focuses the matching field in the editor. Uses MutationObserver/IntersectionObserver/ResizeObserver to keep overlays aligned; hover shows a border + "edit" affordance.
- **Human-in-the-loop AI workflow** research (Glean, StackAI, Kontent.ai): AI generates → staged as a draft/suggestion with provenance → human reviews with a clear diff → Accept/Edit/Reject → only then published. Show confidence/compliance flags, keep a full audit trail, allow "regenerate with a steering note."

---

## The 10 design principles we will enforce everywhere

1. **See-what-you-edit (visual-first).** Wherever a change affects the public site, show a live preview of that page beside (or behind) the editor. Where feasible, let the user click the element on the preview to jump to its field (click-to-edit overlay, Squarespace-style). This is the headline feature of the overhaul.

2. **Never a blank or scary screen.** Every empty state must (a) say what this area is, (b) say why it's empty, (c) give a button that starts the obvious next task. Every error must be caught and rendered as a friendly, plain-language card with a "what to do next" and a "try again" — never a crash page. (The menu-import crash is exactly the anti-pattern we're killing.)

3. **Plain language, no jargon.** "Publish to the live site" not "commit version." "These are waiting for your review" not "pending queue." Write for someone who has never used a CMS.

4. **Guided, not gated.** A persistent "Getting started" checklist + setup status (which migrations are applied, is SMTP set up, is a menu published) so the owner always knows the system's true state and the single next action.

5. **Helper everything.** Hover tooltips on every non-obvious control; a collapsible "How this works" panel at the top of complex pages; an info "?" that opens contextual help; a global `/admin/help` page. Helpers are written once, reused via a shared component.

6. **AI-first, human-review-always.** Default to AI doing the work (drafting descriptions, SEO, alt text, blog bodies, vendor/brand/strain research, image suggestions). The human's job is a fast Accept/Edit/Reject with a clear before/after diff, compliance flags, and provenance. Add "AI does this for me" buttons anywhere a human would otherwise type from scratch. Bulk-review grids so one person can clear many AI drafts quickly.

6b. **Bulletproof / hard to break.** Destructive actions require confirmation and explain consequences; in-use assets can't be deleted; publishing is always staged behind a review + explicit "Publish" click; concurrent edits use optimistic locking ("someone else changed this — reload"). Roles hide what a user can't do; the server still enforces it.

7. **Show, don't tell, with visuals.** Replace bare numbers with charts (now that disk space allows a real charting library). Thumbnails everywhere (products, media, vendors, blog heroes). Status pills with consistent color semantics (draft=orange, published=green, archived=grey, error=red, warning=gold) — matching brand tokens.

8. **Consistent shell & wayfinding.** Sidebar always shows the current section highlighted; breadcrumbs on detail pages; a consistent page header (title, subtitle, primary action) with an optional help toggle; sticky save/publish bar so the action is always reachable. Mobile-responsive (counter staff on phones).

9. **Confidence through feedback.** Loading skeletons (not blank), optimistic UI where safe, success/error toasts after every action, "last saved" timestamps, and a visible preview of what the public will see before publish.

10. **Provenance & accountability.** Every write → audit entry (already enforced). Surface "last edited by / when" on records. AI suggestions always carry model + prompt version + source URL + timestamp.

---

## The visual-editor strategy for THIS stack (Next.js + Supabase, no headless CMS)

We are NOT adopting Sanity/DatoCMS. We replicate the *valuable* parts of their UX natively:

- **Live preview pane:** our public pages already render from published snapshots + a draft/preview path (blog, content blocks, promotions all have draft→publish). We add a **Next.js Draft Mode** preview route so the editor can see the *draft* version of a page in an iframe inside the admin, refreshing as fields change.
- **Click-to-edit overlays (progressive):** start with **Approach 1 (visual edit buttons)** — small "✎ Edit" affordances on previewed, content-managed regions (hero title, menu hero, footer warning, business hours, blog hero, vendor logo) that deep-link to the exact field editor. This is the highest-ROI, lowest-risk slice of the Squarespace feel and fits our "controlled content blocks, not a free-form builder" guardrail (which the owner explicitly wants to keep).
- **Live preview (Approach 2)** for blog posts, content blocks, promotions, product enrichment — side-by-side editor + iframe preview of the draft.
- **We deliberately AVOID Approach 4 (full no-code page builder).** The owner agreed nobody should be able to freely restructure/delete pages. Controlled blocks + visual editing of those blocks = the safe sweet spot.

---

## How this maps to our existing slices (we ADD a UX layer to each — we do not rebuild)

| Existing slice / page | UX overhaul additions |
|---|---|
| Global shell (`AdminSidebar`, `AdminPageHeader`, `StatCard`, `AdminSetupNotice`) | Shared **Tooltip**, **HelpPanel**, **EmptyState**, **ErrorBoundary/SafeData**, **ConfirmDialog**, **Toast**, **StatusPill**, **Skeleton**, **PreviewFrame** components + brand-consistent **chart library** wrapper. Setup-status / getting-started checklist. |
| Dashboard (`/admin`) | Fix slice checkmarks (data-driven), real charts, getting-started checklist, friendlier cards with tooltips. |
| Menu Imports (`/admin/menu-imports`) | **Crash fix (SafeData)**, friendly empty/error states, step-by-step "upload → review → publish" wizard with progress, plain-language diagnostics. |
| Media (`/admin/media`) | Visual grid polish, drag-drop dropzone, AI alt-text button, where-used visual, delete confirmation. |
| Vendors/Brands (`/admin/vendors`) | Logo thumbnails, profile completeness meter, **"Let AI research this vendor/brand"** button (feeds Slice 10 pipeline), live public-card preview. |
| Products (`/admin/products`) | Gap dashboard charts, thumbnail grid, **AI description/tags/alt-text** front-and-center, bulk AI review grid, live product-card preview. |
| Blog/Content/SEO (`/admin/blog`, `/admin/content`, `/admin/content/seo`) | **Live preview pane**, click-to-edit on content blocks, AI "write this for me," Google-style SEO preview (already exists — polish), helper panels. |
| Promotions (`/admin/promotions`) | Visual affected-products preview, conflict warnings as friendly cards, calendar/schedule visual, live sale-badge preview. |
| Orders (`/admin/orders`) | Big touch-friendly cards (counter use), status flow visual, sound/visual new-order alert, print ticket polish. |
| Loyalty (`/admin/loyalty-signups`) | Friendly queue, dedupe visual, empty/onboarding states. |
| Reports (`/admin/reports`) | Upgrade dependency-free charts → rich interactive charts; keep CSV export. |
| Users/Audit (`/admin/users`, `/admin/audit`) | Role explainer, permission matrix visual, friendly audit timeline. |

---

## Charting decision
Disk is now at ~73% (2.3 GB free). We can install a real chart library. **Recommendation: Recharts** (React-native, tree-shakeable, ~widely used, good docs) wrapped in a thin `src/components/admin/charts/` module that takes brand tokens, so the rest of the app imports our wrapper (never Recharts directly) — making it swappable and keeping styling consistent. Tremor is an alternative but pulls more peer deps; Recharts is the leaner, safer pick. Final choice confirmed with owner before install.

---

## Non-negotiable guardrails carried from the master plan
- AI = drafts only, human-validated before publish. No silent auto-publish.
- All `/admin` routes role-gated + `noindex`. Server-side permission enforcement (UI hiding is not security).
- Keep POS truth (price/stock) separate from marketing enrichment.
- WA cannabis compliance on all generated copy (no health/medical claims, no minor appeal, no dosing advice, required disclaimers).
- Every write → audit log. Soft-delete / in-use protection on destructive actions.
- Preserve front-end performance (published snapshots + caching + revalidation, not all-dynamic).
- Mobile-responsive admin.
