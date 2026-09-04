# Inventory page — smarter search, filters and sorting

Michael — this is the plain-English version of what changed on
**Back office → Inventory**. Nothing here is a plan or a promise; every
sentence describes code that is written, wired and tested.

---

## The problem you reported

You typed something into the search bar and got nothing back, and the list only
found the product when you typed its name exactly. That was real, and it had a
specific cause rather than being a vague "search is weak" situation.

The old page searched by pasting whatever you typed into a single database
"contains" check, as one unbroken phrase, against only three columns: the
product name, the lot code, and the POS product key. Three consequences followed
from that one line of code. First, your words had to appear together, in that
order, with nothing in between, so searching `gummies guava` could never find
*Cantina Gummies - Guava 10 Pack 400mg*, because the real name has the word
"Guava" separated from "Gummies" by nothing you typed. Second, the vendor, the
brand and the lab results were attached to each row only **after** the database
had already chosen which rows to show, so it was structurally impossible to
search or filter or sort by vendor, brand, THC or CBD — the page did not know
those values at the moment it was deciding. Third, there was no tolerance for a
slip of the finger: one wrong letter and you got an empty table.

## What the search does now

It breaks what you type into separate words and requires each word to appear
*somewhere* in the row, in any order, in any of twelve fields — lot code, POS
key, product name, strain, brand, vendor, category, LCB inventory type, strain
type, status, unit of measure, and notes. Those fields are weighted, so a hit on
the lot code counts for more than a hit in the notes, and the best matches rise
to the top of the list.

Each word can match in five different ways, and the page prefers them in this
order: the whole field is exactly your word; the field starts with it; some word
inside the field starts with it; your word appears anywhere at all, even buried
in the middle of a longer word; or, last, your word is a near-miss for a real
word. So `ream` finds *Blue D**ream***, and `guava` finds the gummies, and
`gg4` finds *GG 4* even though the real name has a space in it.

Typos are handled deliberately and conservatively. The page **first** searches
strictly, with no guessing at all. Only if that finds absolutely nothing does it
run a second, forgiving pass — and when it does, it tells you so with a
"showing closest matches" note, so you always know whether you are looking at
exact answers or the system's best guess. This two-stage design exists for a
concrete reason that we measured rather than assumed: *resin* and *rosin* are
exactly as similar to each other as *dreem* is to *dream* (both score 0.65 on
the similarity scale). No single tolerance setting can forgive the typo without
also confusing the two real, different products. Searching `resin` therefore
returns resin and never rosin, because the strict pass succeeds and the
forgiving pass never runs. Very short words — three letters or fewer — are never
fuzzy-matched, because at that length a "typo" is indistinguishable from a
completely different word and would drag half the shelf into your results.

An empty search box means "no filter", never "no rows". A search that genuinely
matches nothing still returns nothing — the system will not invent a desperate
guess just to avoid an empty screen.

## Filters

There is a **Filters** panel above the table. It stays collapsed until you open
it, and it shows a count of how many filters are currently active.

Twelve of the filters are **checklists** built from your own live inventory:
Vendor, Brand, Type, Category, LCB inventory type, Strain, Strain type, Size,
Unit, Status, Lab, and Received-date source. Each choice shows how many lots
carry that value, and each list includes an **(Unset)** entry so you can hunt
down exactly the lots that are *missing* a vendor, or a brand, or a strain type.
Ticking two vendors shows lots from either vendor; ticking a vendor and a type
narrows to lots that are both. The choices are always drawn from your whole
inventory rather than from the currently-filtered view, so you can switch from
one vendor to another without first clearing what you already picked.

Ten filters are **yes / no / unknown** selectors: has a COA, is a sample, is
medical, is low-THC liquid, was otherwise taken, has an expiry date, has a
received date, has a cost, has a strain type, and lab passed. The third option
matters and is not decoration. In this system a blank value means *we do not
know*, and it is never silently reported as "no". A lot with no lab result on
file is not a lot that "failed" and not a lot that "passed" — it is unknown, and
you can now list exactly those.

Five filters are **number ranges** with a low and a high box: THC %, CBD %,
quantity on hand, quantity sold, and unit cost. Both ends are inclusive, so a
minimum of 20 includes a lot sitting at exactly 20. A lot with no value on file
is *excluded* from a range rather than treated as zero, because unknown potency
is not the same as zero potency.

Two filters are **date ranges** — received between two dates, and expires
between two dates — plus a shortcut for "expiring within the next N days".

Every filter you apply appears as a removable chip above the table, so you can
always see at a glance why the list looks the way it does, and drop any single
one without disturbing the rest. There is a "Clear everything" action, and it
also shows up in the empty state if a combination of filters leaves you with no
rows.

## Sorting

Every meaningful column header is now clickable — seventeen of them: Product,
Lot code, Vendor, Brand, Type, Strain, Strain type, Size, COA, THC, CBD,
Received, On hand, Sold, Cost, Expires and Status.

The first click sorts in the direction that is actually useful for that column,
rather than mechanically A-to-Z everywhere. Text columns start A-to-Z. THC, CBD,
on-hand, sold, cost and received date start **highest / newest first**, because
that is what you asked for — "price high low, thc high low". Expiry date starts
**soonest first**, because the useful question is what is about to expire.
Clicking the same header a second time reverses it, and a third click clears the
sort and returns you to the default order. The header shows an arrow for the
current direction, and screen readers are told the sort state too.

Two details worth knowing. Lots with an **unknown** value always sink to the
bottom, in *both* directions — a lot with no THC on file will never top a
"highest THC" list, and it will not jump to the top when you reverse the column
either. And milligram-dosed products (edibles, tinctures) are ranked separately
from percentage-dosed products (flower, concentrate), because 10 mg and 10 %
are not the same quantity and sorting them into one column would be
meaningless.

Your filters, your search text and your sort all live in the page address, so
you can bookmark a view you use often, or paste it to someone else, and it will
come back exactly as you left it. Changing a filter always returns you to page
one, so you are never dropped onto an empty page seven of a smaller result set.

---

## How this was checked

The full test suite is **557 files and 14,178 tests**, all passing. Slice 13
adds 80 dedicated tests plus 513 assertions embedded in the new code itself.

Beyond that, the code was tested by **deliberately breaking it**, 28 different
ways, one at a time — loosening the typo tolerance, reversing a sort direction,
letting unknown values count as "no", removing the page-one reset, and so on —
and confirming that the tests *notice*. Twenty-seven of the twenty-eight were
caught immediately.

The twenty-eighth was not, and rather than wave it through it was investigated
by brute force: 44,044 combinations were checked to determine whether that line
of code could ever change an answer. It cannot — another line immediately below
it already covers every case involving a real character — so it is a duplicate
rather than an untested gap, and the proof is recorded next to the code.

That investigation was worth doing, because it turned up a genuine latent bug
that no test and no review had caught: a search term consisting of a single
space would have matched nearly every product on the shelf, since a space
really does appear in almost every product name. It was unreachable through the
page as it is wired today, but the flaw was real and is now fixed and pinned by
tests so it cannot come back.

---

## Files, if you or anyone else ever needs them

The logic lives in six new self-contained modules under
`src/lib/inventory/` — `inventory-search-core.ts`, `inventory-filter-core.ts`,
`inventory-sort-core.ts`, `inventory-list-core.ts`, `inventory-url-core.ts` and
`inventory-page-core.ts` — with the panel and the clickable headers in
`src/components/admin/inventory/`. The recon that preceded the work, including
the exact file and line numbers of the original defect, is in
`docs/slice-13-inventory-filtering-recon.md`.
