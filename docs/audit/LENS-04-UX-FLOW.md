# Lens Pass 4 — UX, Flow & Visual Design

**Scope:** how the back office FEELS to use — button consistency and color
language, readability/contrast, keeping your place (filters, search, sort)
when you navigate, active-state visibility, list truncation honesty, page
clutter, and the flow furniture (sticky bars, confirm dialogs, scroll
restore). Owner's brief: fix the white-text buttons, use the brand colors
boldly (green / orange / gold / red, plus a possible purple or orange
accent), stop pages from forgetting your filters when you go back, declutter
where it pays, and make the whole system "flow, smoothly, like a lazy river
ride."

**Basis:** every claim verified by scripted sweeps and by reading the code
at main commit `9f9880ba` (branch `lens-04-ux-flow`). File:line anchors are
as-of that commit. Standing rule: NEVER GUESS — nothing here is inferred.
Additionally, every visual claim was verified by BUILDING static HTML
harness pages from the real design tokens, rendering them in a browser,
and inspecting the screenshots — see `docs/audit/lens4-visuals/`.

**Fix policy (owner's direction):** ALL fixes deferred until every lens pass
is done; this pass only documents. New findings are logged in `FINDINGS.md`
as GW-029…GW-035. The mechanical, code-level execution plan for the fixes
(the exact mapping tables and code patterns) lives in
`DESIGN-SYSTEM-SPEC.md` so the fix slices can be executed without
re-deriving anything.

---

## 1. The headline discovery: the state architecture is already RIGHT — only the links throw the state away (GW-029)

This was the owner's #1 pain ("almost everywhere in the back office…
filters are reset… this kills workflow"), and the sweep found something
genuinely good underneath it:

- **All 143** admin `page.tsx` files are **server components** (0 client
  pages).
- **102 of them** read their filters/search/sort/tab from the URL via
  `searchParams` — meaning the address bar already IS the state. Press the
  browser Back button and the filters come back, because they were never
  anywhere else.
- Only **8 client components** hold filter-ish `useState`, and one of them
  (`CycleCountSheetTools.tsx`) already syncs to the URL correctly. The 7
  that lose state on unmount are listed in §2.3.

So the architecture is the industry-recommended one (state in the URL — the
pattern behind every enterprise back office and the express recommendation
of the React Router / TanStack ecosystem for list screens). **The entire
problem is the LINKS:**

- Every one of the **33 "Back to …" links** in the admin is a bare href
  (`/admin/orders`, `/admin/products`, …) — **0 of 33** carry a query
  string. Full list in §2.1.
- The row links INTO detail pages (e.g. `orders/page.tsx:182`) don't pass
  the current query along, so even a smart back link would have nothing to
  restore.
- Breadcrumb links to list routes are bare for the same reason.

**Consequence:** filter Orders to "New", search "sarah", open an order,
click "Back to orders" → filter and search gone. Repeat for every item in
the queue. Working a 20-order morning means re-applying the same filter 20
times.

**Fix shape (deferred, spec'd in `DESIGN-SYSTEM-SPEC.md` §5):** one
mechanical pattern — list pages append `?back=<urlencoded current query>`
to row links; a tiny shared `BackLink` server component reads it back and
restores the full list URL. No client state, no storage, works with
everything already built. This is the single highest-leverage flow fix in
the whole pass.

### 1.1 Why "state in the URL" is the right call (research)

- Nielsen Norman Group, "User Control and Freedom" (Heuristic #3): users
  need a clearly marked emergency exit that does not cost them their work;
  Back is the most-used recovery mechanism on the web and MUST behave.
  (nngroup.com/articles/user-control-and-freedom)
- NN/g, "Maintain Consistency and Adhere to Standards" (Heuristic #4): the
  Back button carrying you to *the page as you left it* is a web-wide
  convention; violating it makes users distrust navigation.
  (nngroup.com/articles/consistency-and-standards)
- The URL-as-state pattern is the standard remedy in the React data-table
  ecosystem (TanStack Table discussions on filter/sort persistence all
  converge on "put it in the search params") — and this codebase already
  did that part. Only the in-app links regress it.

---

## 2. The full evidence inventories

### 2.1 All 33 bare "Back to …" links (each one wipes list state)

| # | File:line | Points to | Label |
|---|-----------|-----------|-------|
| 1 | `src/app/admin/purchasing/page.tsx:94` | `/admin/catalog` | ← Back to Product Intake Hub |
| 2 | `src/app/admin/purchasing/menus/[id]/page.tsx:83` | `/admin/purchasing/menus` | ← Back to Vendor Menus |
| 3 | `src/app/admin/purchasing/menus/[id]/item/[itemId]/page.tsx:74` | `/admin/purchasing/menus/${id}` | ← Back to {vendorLabel} |
| 4 | `src/app/admin/purchasing/menus/growflow/[id]/page.tsx:96` | `/admin/purchasing/menus` | ← Back to Vendor Menus |
| 5 | `src/app/admin/vendors/merge/page.tsx:96` | `/admin/vendors` | ← All vendors |
| 6 | `src/app/admin/vendors/import/page.tsx:122` | `/admin/vendors` | Back to vendors |
| 7 | `src/app/admin/knowledge-base/page.tsx:71` | `/admin/catalog` | ← Back to Product Intake Hub |
| 8 | `src/app/admin/knowledge-base/harvest/review/page.tsx:253` | `/admin/knowledge-base/harvest` | ← Harvest Console |
| 9 | `src/app/admin/knowledge-base/harvest/history/page.tsx:39` | `/admin/knowledge-base/harvest` | ← Back to Harvest Console |
| 10 | `src/app/admin/registers/exceptions/page.tsx:92` | `/admin/registers` | Back to Register Activity |
| 11 | `src/app/admin/registers/devices/page.tsx:50` | `/admin/registers` | Back to Register Activity |
| 12 | `src/app/admin/staffing/clock/page.tsx:84` | `/admin/staffing` | Back to the full time clock |
| 13 | `src/app/admin/inventory/page.tsx:117` | `/admin/catalog` | ← Back to Product Intake Hub |
| 14 | `src/app/admin/inventory/drafts/page.tsx:96` | `/admin/catalog` | ← Back to Product Intake Hub |
| 15 | `src/app/admin/inventory/intake/page.tsx:171` | `/admin/catalog` | ← Back to Product Intake Hub |
| 16 | `src/app/admin/inventory/noncannabis/[id]/label/page.tsx:60` | `/admin/inventory/noncannabis` | ← Back to non-cannabis inventory |
| 17 | `src/app/admin/vendor-payments/page.tsx:78` | `/admin/catalog` | ← Back to Product Intake Hub |
| 18 | `src/app/admin/content/seo/page.tsx:53` | `/admin/content` | ← Site content |
| 19 | `src/app/admin/menu-imports/version/[versionId]/page.tsx:72` | `/admin/menu-imports` | ← All menu updates |
| 20 | `src/app/admin/menu-imports/[id]/page.tsx:96` | `/admin/menu-imports` | ← All imports |
| 21 | `src/app/admin/orders/[id]/page.tsx:74` | `/admin/orders` | Back to orders |
| 22 | `src/app/admin/products/page.tsx:47` | `/admin/catalog` | ← Back to Product Intake Hub |
| 23 | `src/app/admin/products/page.tsx:93` | `/admin/catalog` | ← Back to Product Intake Hub |
| 24 | `src/app/admin/products/page.tsx:282` | `/admin/catalog` | ← Back to Product Intake Hub |
| 25 | `src/app/admin/products/masters/page.tsx:97` | `/admin/catalog` | ← Back to Product Intake Hub |
| 26 | `src/app/admin/products/bulk-ai/page.tsx:88` | `/admin/products` | ← Back to products |
| 27 | `src/app/admin/products/[key]/page.tsx:63` | `/admin/products` | ← All products |
| 28 | `src/app/admin/discovery/page.tsx:382` | `/admin/catalog` | ← Back to Product Intake Hub |
| 29 | `src/app/admin/discovery/ccrs/page.tsx:452` | `/admin/discovery` | ← Back to Product Discovery |
| 30 | `src/app/admin/discovery/benchmarks/page.tsx:583` | `/admin/discovery` | ← Back to Product Discovery |
| 31 | `src/app/admin/discovery/import/page.tsx:206` | `/admin/discovery` | ← Back to Product Discovery |
| 32 | `src/app/admin/blog/new/page.tsx:34` | `/admin/blog` | ← Back to posts |
| 33 | `src/app/admin/blog/[id]/page.tsx:93` | `/admin/blog` | ← Back to posts |

The highest-traffic queues (orders #21, intake #15, drafts #14, register
exceptions #10, menu imports #19–20, discovery #28–31) are all on this
list — exactly where re-applying filters hurts most.

### 2.2 The button fragmentation numbers (GW-030 / GW-031 / GW-034)

Scripted classifier over `src/app/admin` + `src/components/admin`:

- **274 raw `<button>` elements** and **~91 button-styled `<Link>`/`<a>`**
  bypass the canonical `Button` component
  (`src/components/admin/ui/Button.tsx:45–55` — 5 solid variants, all with
  black ink: orange primary, green confirm, gold save, red danger, dark
  neutral).
- **92 white-text vs 85 black-text** among them — the exact inconsistency
  the owner reported, quantified.
- **39 transparent/outline "ghost" buttons** — the grey style the owner
  dislikes and the prior beautification round intended to retire.
- **29 hard-coded off-palette fills** — `bg-sky-400`
  (`vendors/[id]/page.tsx:223`), `bg-fuchsia-400` (`:261`, `:543`),
  `bg-[#5ec1ff]` (`:508`), `bg-red-600` instead of the brand red
  (`settings/reset/page.tsx:142`), a rogue lowercase green pill
  (`products/[key]/page.tsx:164`).
- **82 class sites hard-code the brand hex** (`#7ed957` / `#ff7f00` /
  `#ffd700`) instead of the CSS tokens (`globals.css:36–44`), so the
  palette can't be tuned in one place (GW-034).
- **89 files** carry at least one flagged element. Full machine-generated
  inventory preserved in the audit workpapers.

**The WCAG failures (GW-031):** 12 sites put WHITE text on the solid brand
green — **1.76:1** contrast, versus the 4.5:1 floor of WCAG 2.2 SC 1.4.3
(and even the 3:1 floor for large text / UI components, SC 1.4.11). Five of
the twelve are in the medical suite. Every canonical Button variant already
passes with black ink: green 11.95:1, orange 8.29:1, gold 14.97:1, red
6.86:1 — measured with the WCAG relative-luminance formula, not estimated.
The 12 sites:

```
src/app/admin/medical/page.tsx:67
src/app/admin/integrations/page.tsx:113
src/app/admin/integrations/page.tsx:140
src/app/admin/knowledge-base/faqs/page.tsx:93
src/app/admin/knowledge-base/about/page.tsx:93
src/app/admin/inventory/drafts/page.tsx:134
src/app/admin/inventory/intake/page.tsx:405
src/app/admin/vendors/[id]/page.tsx:155
src/components/admin/medical/GuidedIntakeWizard.tsx:447
src/components/admin/medical/MedicalPanel.tsx:107
src/components/admin/medical/CardPrintButton.tsx:14
src/components/admin/medical/DohProductRegistry.tsx:146
```

**The purple the owner asked about:** verified viable. Black ink passes on
`#c084fc` (7.95:1), `#a78bfa` (7.72:1), and `#d8b4fe` (10.9:1). The spec
proposes `--admin-purple: #c084fc` as a new `special` Button variant,
reserved for AI/automation actions — which simultaneously gives the
off-palette sky/fuchsia AI buttons a legitimate home. Visual proof:
`lens4-visuals/04-density-and-purple.png`.

### 2.3 The 7 client components that genuinely lose state (the only real `useState` leaks)

| Component | What's lost | Lines |
|-----------|-------------|-------|
| `src/app/admin/purchasing/new/builder-table.tsx` | sort key (`urgency`) | 515 |
| `src/app/admin/knowledge-base/SubstituteManager.tsx` | scope filter | 265 |
| `src/components/admin/ContentBlocksBrowser.tsx` | type filter | 254 |
| `src/components/admin/compliance/SampleHistoryClient.tsx` | sort order | 346 |
| `src/components/admin/marketing/MidjourneyBuilder.tsx` | active studio tab | 784 |
| `src/components/admin/marketing/IdeaNotebook.tsx` | idea status | 109 |
| `src/components/admin/blog/BlogEditorClient.tsx` | category | 548 |

Counter-example done right in the same repo:
`src/components/admin/inventory/CycleCountSheetTools.tsx` initializes all
three of its filters from `useSearchParams` and writes changes back —
the pattern the other 7 should copy (spec §5.4).

### 2.4 Active states that whisper (GW-032)

The active filter chip / tab style is a 14%-alpha green tint on a dark
surface — visible if you hunt for it, invisible at a glance:

- `src/app/admin/orders/page.tsx:138–143` (`bg-[var(--admin-accent-soft)]`)
- `src/app/admin/loyalty-signups/page.tsx:256` (`bg-[#7ed957]/15`)
- `src/app/admin/reports/page.tsx:88` (`bg-[#7ed957]/15`)
- `src/app/admin/reports/forecast/page.tsx:93,:137` (same pattern in gold:
  `bg-[#ffd700]/15`)
- `src/components/admin/reports/ReportTabs.tsx:46` (active tab)

The harness render (`lens4-visuals/03-orders-flow-current-vs-proposed.png`)
shows the before/after: a SOLID brand-green chip with black ink is
unmissable without shouting. NN/g's "Button States 101" makes the same
point: the selected state must be the visually loudest fact on the control.

### 2.5 Silent truncation (GW-033)

- `src/lib/orders/orders-store.ts:194` — `limit(filter.limit ?? 200)`
- `src/lib/inventory/store.ts:48` — `limit(opts?.limit ?? 500)`
- `src/lib/customers/store.ts:28` — 500

None of the three consuming pages shows a total, a pager, or a "more
exists" hint. The repo already contains both good patterns: products says
"Showing first 300 of N" (`products/page.tsx:426`) and vendors has a real
pager with "Showing X–Y of N" (`vendors/page.tsx:246`). At real retail
volume (hundreds of orders a week) the orders list clips within the first
month after cutover.

### 2.6 Underused flow furniture (GW-035)

`src/components/admin/ux/` usage counts (scripted):

| Component | Usages | Verdict |
|-----------|--------|---------|
| HelpPanel | **84** | wired — great |
| EmptyState | **44** | wired — great |
| Toast | **35** | wired — great |
| ScrollKeeper | admin-wide via layout | wired — great (scroll restore after saves) |
| ConfirmDialog | **1** | built, unused |
| InfoHint | **1** | built, unused |
| StickyActionBar | **0** | built, never used |

The six longest editor pages — exactly where Save scrolls off-screen — are
the natural first homes for StickyActionBar (spec §7).

---

## 3. Clutter review — the five longest pages, and which are worth thinning

Measured by line count and confirmed by reading:

| Page | Lines | Verdict |
|------|-------|---------|
| `src/app/admin/inventory/intake/[id]/page.tsx` | 909 | **Worth thinning.** The review screen stacks every section (identity, pricing, compliance, images, history) at full height; a sticky action bar (GW-035) plus collapsing the rarely-touched history/raw sections behind the existing HelpPanel pattern would cut perceived height ~40% without hiding anything. |
| `src/app/admin/purchasing/new/page.tsx` | 647 | **Worth thinning lightly.** The builder table is the page; the header explainer block above it can compress to one HelpPanel. Also holds a LOST sort state (§2.3). |
| `src/app/admin/discovery/ccrs/page.tsx` | 645 | **Leave.** Dense but task-shaped — it's a wizard with staged sections; length is the work, not clutter. |
| `src/app/admin/staffing/employees/[id]/page.tsx` | 603 | **Worth thinning.** Profile + pay + schedule + documents all expanded; the pay/document sections are occasional-use and can start collapsed. StickyActionBar candidate. |
| `src/app/admin/vendors/[id]/page.tsx` | 593 | **Worth thinning + it's the worst button offender** (7 flagged elements incl. sky/fuchsia/#5ec1ff). Fixing GW-030 here IS the declutter — the ad-hoc rainbow reads as noise. StickyActionBar candidate. |

Deliberate non-goals: the POS register (`RegisterShell.tsx`) was audited in
Lens 3 and its density is intentional (a register IS a dense screen); the
public site was out of scope for this pass per the owner's brief (back
office focus), except to note its token discipline is good.

---

## 4. Visual verification — what was actually rendered and inspected

Per the owner's request ("generate static pages you can look at so you can
fine tune them"), four harness sheets were built from the VERBATIM
`globals.css` tokens, served, screenshotted, and inspected:

1. **`01-buttons-current-vs-adhoc.png`** — the canonical Button (all 5
   variants, faithful reproduction of `Button.tsx:45–55`) next to faithful
   recreations of the ad-hoc styles found in the sweep (white-on-green,
   ghost outlines, sky/fuchsia, rogue lowercase). The white-on-green button
   is visibly illegible even on a calibrated screen — in a bright store it
   will be worse.
2. **`02-proposed-system.png`** — the proposed complete system: 5 existing
   variants + the new purple `special` variant + solid active chips +
   in-table chip buttons. Everything black-ink, everything tokenized.
3. **`03-orders-flow-current-vs-proposed.png`** — a realistic orders list,
   current vs proposed side by side: solid active chip, state-carrying
   back link annotation, colorful row actions. This is the "lazy river"
   target picture.
4. **`04-density-and-purple.png`** — the density question answered: solid
   green on EVERY row action is too loud (verified visually); the winning
   recipe is green-tinted chips in rows with ONE solid orange page-level
   CTA. Plus the three purple candidates with contrast ratios.

Harness sources are preserved at `docs/audit/lens4-visuals/harness/` so the
sheets can be re-rendered and iterated during the fix slices.

---

## 5. Verified GOOD (checked, working, keep as-is)

- **URL-state architecture** — 143/143 server pages, 102 reading
  `searchParams`; browser Back genuinely restores state today (§1).
- **Canonical Button** — correct contrast on every variant, consistent
  pill/uppercase grammar (`Button.tsx:45–55`).
- **Design tokens** — a real token system in `globals.css` (admin + POS +
  POS light mode); the light POS theme correctly re-tints to a deeper green
  `#178a5c` (`globals.css:169`) with white ink where that combination
  passes — token discipline works where it's used.
- **ScrollKeeper** — wired admin-wide; scroll position survives
  server-action saves (a previously owner-requested fix, confirmed still
  working).
- **HelpPanel ×84 / EmptyState ×44 / Toast ×35** — the hand-holding layer
  is genuinely wired, not shelfware.
- **Breadcrumbs, CommandPalette, WorkspaceTour, sticky AdminPageHeader** —
  present and functioning.
- **Good list patterns already in-repo** — products' "Showing first 300 of
  N" (`products/page.tsx:426`) and vendors' real pager
  (`vendors/page.tsx:246`) are the templates for GW-033.
- **CycleCountSheetTools** — the one client component that syncs filters to
  the URL; the model for the other 7.

---

## 6. Research base for the recommendations

- **WCAG 2.2, SC 1.4.3 (Contrast Minimum)** and **SC 1.4.11 (Non-text
  Contrast)** — the 4.5:1 / 3:1 floors behind GW-031; all ratios in this
  pass computed with the W3C relative-luminance formula.
- **Nielsen Norman Group, Usability Heuristic #3 (User Control and
  Freedom)** — recovery paths (Back) must be cheap and lossless → GW-029.
- **NN/g, Heuristic #4 (Consistency and Standards)** — one button grammar,
  one meaning per color → GW-030/GW-032.
- **NN/g, "Button States 101"** — selected/active states must dominate
  visually → GW-032.
- **Shneiderman, *Designing the User Interface* — the Eight Golden Rules**
  (notably "strive for consistency" and "reduce short-term memory load"):
  staff should never have to remember what a color means or re-remember a
  filter they already applied → GW-029/GW-030.
- **URL-as-state pattern** (React/Next.js ecosystem consensus; TanStack
  Table filter-persistence discussions) → GW-029/§2.3.

---

## 7. What happens next (per standing rules)

1. Remaining documentation passes: `TEST-PLAN.md` and
   `CUTOVER-CHECKLIST.md`.
2. Then fix slices, most-severe → least across ALL lenses (GW-010 first).
   Within this lens, the recommended fix order is:
   **GW-031** (12 one-line contrast fixes) → **GW-029** (BackLink pattern —
   biggest flow win) → **GW-030+GW-034** (button sweep, file-by-file, with
   the §3 mapping table) → **GW-032** (solid active chips) → **GW-033**
   (counts + pagination) → **GW-035** (sticky bars + confirm dialogs) →
   clutter thinning (§3).
3. Every fix slice follows the standing per-slice rules (fresh branch,
   full verification suite, PR, compliance green, squash-merge).
