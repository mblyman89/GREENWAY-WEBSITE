# Product Enrichment green helper + industry-specific nav icons

## Verbatim request (Msg H)
"this is looking really good. I like it a lot. will you add a green helper box to
the product enrichment page. then, and this is super unnecessary but I want to
anyways, replace all of the little visual icons that appear next to all the pages
in the drop down tabs to be more industry specific if possible and if not, to be
change to be what your average top quality pos back office would have. the icons
we have are lame, no offense. please research then update the icons and fix the
enrichment page. please proceed, follow the standing rules."
+ uploaded screenshot showing Product Enrichment with NO green helper at the top
(this is the "no published menu yet" empty state).

## Findings
- HelpPanel = the green helper box (src/components/admin/ux/HelpPanel.tsx).
- products/page.tsx MAIN branch already has green box + HelpPanel.
- The TWO empty-state branches (supabase-not-configured, no-published-menu)
  have NO green box -> that's what the screenshot shows.

## Plan
### Part 1 — Enrichment green helper
- [x] Add HelpPanel green box to the "no published menu" empty state (defaultOpen)
- [x] Add HelpPanel green box to the "supabase not configured" empty state

### Part 2 — Nav icons (all dropdown items)
- [x] Research: top POS/cannabis back office icon conventions
- [x] Replaced all 54 icons in admin-nav-data.ts with a coherent, distinct,
      industry-appropriate set (cannabis 🌿🧾🛡🧪🩺🏥; POS 🛒📈👥🚚💳💰💵📥).
      No dup icons within a group; removed lame monochrome glyphs.
- [x] Kept emoji swap (no icon-font dependency added)

### Verify + ship
- [x] tsc / eslint / build all clean (exit 0)
- [ ] Branch + PR (do NOT auto-merge unless asked)

## Notes
- Standing rules: ground in fact, drafts-only AI, cents, CCRS+DOH, handoff-ready.
- PR #248 (settings + AI KB) still OPEN/unmerged — build on main, keep separate.
