# Greenway Back-Office Design System Spec (Lens 4 execution plan)

**Purpose:** the mechanical, code-level playbook for executing the Lens-4
fixes (GW-029…GW-035) without re-deriving anything. Every pattern below was
verified against main commit `9f9880ba` and visually validated in the
rendered harness sheets (`docs/audit/lens4-visuals/`). Fixes remain
DEFERRED until all documentation passes are done (owner's direction); when
the fix slices start, this document is the instruction set.

Section numbers are load-bearing: `FINDINGS.md` GW-029 points at **§5** and
GW-030 points at **§3**. Do not renumber.

---

## §1 — Tokens (one new token, nothing else changes)

The token system in `src/app/globals.css:36–44` is correct and stays.
Add ONE token to the admin block:

```css
--admin-purple: #c084fc;          /* AI / automation actions — black ink, 7.95:1 */
--admin-purple-soft: rgba(192, 132, 252, 0.14);
```

Verified contrast (WCAG relative luminance): black on `#c084fc` = **7.95:1**
(AA pass, both text and UI thresholds). Runner-up candidates if the owner
wants to tune later: `#a78bfa` (7.72:1), `#d8b4fe` (10.9:1) — both also
pass with black ink. Visual swatches: `lens4-visuals/04-density-and-purple.png`.

## §2 — Button component: one new variant, two new chip classes

### §2.1 New `special` variant (purple)

In `src/components/admin/ui/Button.tsx`:

```ts
export type ButtonVariant =
  | "primary"  // orange — main CTA
  | "confirm"  // green  — publish / approve / go
  | "save"     // gold   — save draft / settings
  | "danger"   // red    — destructive
  | "special"  // purple — AI / crawler / automation actions   ← NEW
  | "neutral"; // solid dark chip — secondary / cancel / back

// in VARIANTS:
special:
  "bg-[var(--admin-purple)] text-black shadow-[var(--admin-shadow-sm)] hover:brightness-110 active:brightness-95",
```

**Meaning (binding, extends the owner-approved color grammar in the
component's header comment):** purple = "the machine does something for
you" — AI enrichment, crawler runs, bulk-AI, Midjourney/Flux studio,
GrowFlow sync. This gives the current off-palette sky/fuchsia buttons a
legitimate brand home.

### §2.2 In-table chip classes (density-safe row actions)

Solid `md` Buttons in every table row are too loud (verified visually —
sheet 04, Option 1 rejected). For row-level actions use these two utility
class recipes (add as exported constants next to the Button, or as
`.btn-chip-*` classes in globals.css):

```
CHIP_ACTION  = "admin-focus inline-flex items-center rounded-full
                bg-[var(--admin-accent-soft)] px-3 py-1 text-[0.7rem]
                font-bold uppercase tracking-[0.08em]
                text-[var(--admin-accent)]
                ring-1 ring-[var(--admin-accent)]/40
                hover:bg-[var(--admin-accent)] hover:text-black transition"

CHIP_NEUTRAL = same but with --admin-surface-2 fill,
               text-[var(--admin-text)] and border-[var(--admin-border)]
```

Rule of thumb from the density sheet: **many tinted chips per screen, at
most ONE solid orange `primary` per page region.**

## §3 — Button migration mapping table (GW-030 / GW-031 / GW-034 sweep)

Sweep scope: 274 raw `<button>` + ~91 button-styled links across 89 files
(inventory preserved in audit workpapers). Apply this mapping file-by-file;
each row is deterministic — no judgment calls needed during the sweep:

| # | Current ad-hoc pattern (as found) | Replace with | Notes |
|---|-----------------------------------|--------------|-------|
| 1 | Solid green fill + `text-white` (the 12 GW-031 sites) | `<Button variant="confirm">` | Fixes 1.76:1 → 11.95:1. If the element must stay raw (e.g. `<label>` file-upload at `inventory/intake/page.tsx:405`), minimum fix: `text-white` → `text-black`. |
| 2 | Solid green fill + `text-black`, hex `bg-[#7ed957]` | `<Button variant="confirm">` | Also clears the GW-034 hex (e.g. `products/[key]/page.tsx:164,:284,:297`, `media/[id]/page.tsx:140`). |
| 3 | Solid gold fill `bg-[#ffd700]` | `<Button variant="save">` | e.g. `products/[key]/page.tsx:98`. |
| 4 | Solid orange fill `bg-[#ff7f00]` / `bg-[var(--orange)]` | `<Button variant="primary">` | |
| 5 | `bg-red-600` / `bg-red-500` + white text | `<Button variant="danger">` | Brand red `--admin-danger` with black ink (6.86:1) replaces Tailwind red (e.g. `settings/reset/page.tsx:142`). |
| 6 | `bg-sky-400`, `bg-[#5ec1ff]` (AI/import actions) | `<Button variant="special">` | `vendors/[id]/page.tsx:223,:508`. |
| 7 | `bg-fuchsia-400` (AI enrich/generate) | `<Button variant="special">` | `vendors/[id]/page.tsx:261,:543`. |
| 8 | Transparent/outline ghost (`border border-white/15 … text-white/80`) used as a REAL action | `<Button variant="neutral">` | The 39 ghost sites; neutral is the owner-approved "quiet" style — solid dark chip, never transparent. |
| 9 | Ghost outline used as row-level action inside a table | `CHIP_NEUTRAL` (§2.2) | Keeps table density. |
| 10 | Colored row-level action inside a table | `CHIP_ACTION` (§2.2) | Sheet-04 winning recipe. |
| 11 | Grey/dark nav chips in `AdminTopNav.tsx` and filter chips | LEAVE (nav) / see §4 (filter chips) | Navigation chrome is intentionally quiet; do not brandify the nav. |
| 12 | Lowercase / non-pill one-offs (`rounded-lg`, sentence case) | Nearest `<Button>` variant, size `sm` | Grammar: pill + uppercase everywhere actions live. |
| 13 | Any remaining raw brand hex in classNames (82 sites) | Swap hex → `var(--admin-accent|orange|gold|danger)` | GW-034; do in the same commit as each file's button migration. |

**Sweep order (worst-first, from the scripted inventory):**
`vendors/[id]` (7 flagged) → `products/[key]` (7) → `compliance/ccrs` (5)
→ `vendors` (5) → `media/[id]` (4) → remaining 84 files. Slice into PRs of
~10–15 files each so review stays sane.

**Acceptance per file:** zero `text-white` on solid brand fills; zero raw
brand hex; zero transparent-bordered action buttons; every action is either
a `<Button>` or a §2.2 chip.

## §4 — Active filter chips & tabs (GW-032)

Replace the 14%-tint active style with SOLID green + black ink. Pattern
(orders example, `orders/page.tsx:138–143`):

```tsx
// ACTIVE
"border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
// INACTIVE (unchanged)
"border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
```

Apply at: `orders/page.tsx:138–143`, `loyalty-signups/page.tsx:256`,
`reports/page.tsx:88`, `reports/forecast/page.tsx:93,:137`,
`components/admin/reports/ReportTabs.tsx:46` (active tab), and — inverse
case — `inventory/drafts/page.tsx:132–136` where the active chip is already
solid green but with `text-white` (make it `text-black`).
Visual proof: `lens4-visuals/03-orders-flow-current-vs-proposed.png`.

## §5 — The BackLink pattern (GW-029): state-carrying navigation

### §5.1 The shared component

`src/components/admin/ux/BackLink.tsx` (server component, no hooks):

```tsx
import Link from "next/link";

/**
 * BackLink — a "Back to …" link that restores the list page exactly as the
 * user left it (filters, search, sort, page) via a `back` search param.
 * Falls back to the bare route when no state was carried.
 */
export default function BackLink({
  fallback,          // e.g. "/admin/orders"
  back,              // the raw `back` searchParam value (urlencoded qs)
  children,
  className,
}: {
  fallback: string;
  back?: string | string[];
  children: React.ReactNode;
  className?: string;
}) {
  const qs = typeof back === "string" && back.length > 0 ? back : "";
  // Safety: only ever restore a query string, never a foreign path.
  const href = qs ? `${fallback}?${qs.replace(/^\?/, "")}` : fallback;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
```

### §5.2 List pages: carry the state into detail links

In each list page (server component, already has `searchParams`):

```tsx
const sp = await searchParams;                        // existing code
const qs = new URLSearchParams(
  Object.entries(sp).flatMap(([k, v]) =>
    v == null ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]],
  ) as [string, string][],
).toString();
const back = qs ? `?back=${encodeURIComponent(qs)}` : "";

// row link:
<Link href={`/admin/orders/${o.id}${back}`}>…</Link>
```

### §5.3 Detail pages: read it back

```tsx
const sp = await searchParams;
<BackLink
  fallback="/admin/orders"
  back={sp.back ? decodeURIComponent(String(sp.back)) : undefined}
  className="…existing classes…"
>
  Back to orders
</BackLink>
```

Also thread `back` through any detail-page sub-links that eventually return
to the list (e.g. "Print pick-ticket" → back to detail → back to list), and
through breadcrumb segments that point at list routes.

### §5.4 Rollout order (all 33 sites, from LENS-04 §2.1)

Work queues first — they're where re-filtering hurts:
1. orders (`orders/[id]:74` + row links `orders/page.tsx:182`)
2. inventory intake + drafts (sites #14–15) and intake review rows
3. register exceptions (#10) and devices (#11)
4. menu-imports (#19–20), discovery (#28–31)
5. products (#22–27), vendors (#5–6), purchasing (#1–4)
6. the rest (#7–9, #12–13, #16–18, #32–33)

### §5.5 The 7 client components with lost `useState` (LENS-04 §2.3)

Copy the in-repo good example
(`components/admin/inventory/CycleCountSheetTools.tsx`): initialize from
`useSearchParams()`, write changes back with
`router.replace(`?${params}`, { scroll: false })`. Apply to:
`purchasing/new/builder-table.tsx` (sort), `SubstituteManager.tsx` (scope),
`ContentBlocksBrowser.tsx` (filter), `SampleHistoryClient.tsx` (sort),
`MidjourneyBuilder.tsx` (tab), `BlogEditorClient.tsx` (category).
(`IdeaNotebook.tsx`'s state is per-record status, not a filter — exclude.)

**Acceptance:** filter → open detail → BackLink returns to the identical
list URL; browser Back does the same; a hard refresh of the list URL
reproduces the state.

## §6 — Honest lists: counts + pagination (GW-033)

Store changes — return totals alongside rows:

```ts
// orders-store.ts:194 area, inventory/store.ts:48, customers/store.ts:28
const { data, count } = await q
  .select("…", { count: "exact" })
  .range(offset, offset + limit - 1);
return { rows: mapRows(data ?? []), total: count ?? 0 };
```

Page changes — copy the two in-repo good patterns:
- Count line: `products/page.tsx:426` ("Showing first 300 of N…").
- Pager: `vendors/page.tsx:246` ("Showing X–Y of N" + page links).

Pagination param is `?page=2` — URL state, consistent with §5 (the `back`
param naturally preserves the page too). Apply to orders, inventory,
customers list pages.

## §7 — Flow furniture wiring (GW-035)

**StickyActionBar** (currently 0 usages) into the six longest editors:

| Page | Lines | Actions to pin |
|------|-------|----------------|
| `inventory/intake/[id]/page.tsx` | 909 | Approve / Save / Reject |
| `purchasing/new/page.tsx` | 647 | Create PO |
| `staffing/employees/[id]/page.tsx` | 603 | Save |
| `vendors/[id]/page.tsx` | 593 | Save / Publish |
| `promotions/[id]/page.tsx` | — | Save / Activate |
| `blog/[id]/page.tsx` | — | Save / Publish |

**ConfirmDialog** (currently 1 usage): route every destructive `danger`
action through it during the §3 sweep — delete vendor/product/post, reject
intake, reset (`settings/reset`), void. Replace bare `confirm()` calls.

**InfoHint** (currently 1 usage): opportunistic only — add where a field
label needs one-line context; not a sweep.

## §8 — Clutter thinning (LENS-04 §3 verdicts)

- `inventory/intake/[id]` (909): collapse history/raw sections by default;
  StickyActionBar carries the actions.
- `purchasing/new` (647): compress header explainer into a HelpPanel.
- `staffing/employees/[id]` (603): collapse pay + documents sections by
  default.
- `vendors/[id]` (593): the §3 button migration is the declutter.
- `discovery/ccrs` (645): leave — staged wizard, length is the task.

## §9 — Verification for every fix slice

Per the standing rules, plus lens-specific checks:
1. `npx tsx scripts/compliance/run-pure-selftests.ts`, `npx tsc --noEmit`,
   eslint on touched files, `vitest run`, crawler pytest.
2. Contrast: any NEW fill/ink pair must pass 4.5:1 (compute, don't
   eyeball — the harness has the formula).
3. Re-render the affected harness sheet if the system itself changed
   (new variant, new chip class) and visually inspect.
4. Grep acceptance per §3/§5 ("Acceptance" blocks above) on touched files.
