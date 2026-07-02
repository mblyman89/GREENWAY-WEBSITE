# Cycle-count filter flicker fix + admin fancy wordmark

Owner report (verbatim): "the new cycle count open session page ... has the new
sort and filter options, but there is something wrong ... if I try to use a sort
or filter, it immediately closes the drop down and flickers. The scan box kind
of looks like it gets highlighted briefly when I try to use a filter." + "Please
also replace the top left greenway title with the fancy greenway marijuana title
we use for the website."

## Diagnosis (grounded — read the actual files)
CycleCountScanner's scan input had `onBlur={() => setTimeout(() => focus(), 50)}`
to keep a USB wedge scanner landing in the box. On the open-session page the
scanner and CycleCountSheetTools (filters/sort) are siblings. Clicking a filter
`<select>` blurred the scan box → the timeout stole focus back → the open native
dropdown closed (flicker) and the scan box highlighted briefly. Pure focus war.

## Fix
- Scanner onBlur is now focus-aware: it only re-grabs focus when the user clicks
  EMPTY space, never when focus moves to another control. Uses `relatedTarget`
  + a document `pointerdown` capture guard (`interactingElsewhere`) to cover the
  native-<select> `relatedTarget === null` edge case.
- Wordmark: AdminTopNav top-left now renders the site's fancy script wordmark
  image (`greenwayBusiness.assets.wordmark` = /brand/greenway-marijuana-
  wordmark-transparent.png) instead of plain cursive "Greenway", keeping the
  gold "Admin" pill. Single source of truth with the public Header.

## Tasks
- [x] Read CycleCountScanner, [id]/page.tsx, CycleCountSheetTools (diagnose)
- [x] Fix scanner focus-steal (relatedTarget + pointerdown guard)
- [x] Find website fancy wordmark (Header.tsx -> business.ts asset), verify file
- [x] Swap AdminTopNav Wordmark to the image
- [x] Verify: tsc --noEmit clean; npm run build BUILD_DONE_EXIT=0 (routes present)
- [ ] Branch + PR + (owner) squash-merge
