# R74: the full dry run and migration day, in order

Written for Michael (R74 round 7): "please explain the full dry run not in test mode process. the full
sequence of events i will go through on migration day." Every button named here exists in the app
today (R74 S1-S12). The timed cutover checklist is still `docs/CUTOVER_WEEKEND_ONE_PAGE.md` (Admin ->
Menu Imports -> Cultivera cutover runbook). This page adds the R74 steps after Publish: rebuild the
manifests, the email step, onboarding by vendor, and Gemini.

## Why a dry run must be "real" (not Test mode) to see manifests

A Test-mode import never creates lots, so the manifest rebuild refuses it ("A test import never
creates lots, so there is nothing to re-home"). To watch the manifests, onboarding, COAs and Gemini
work, stage the import with **Test mode OFF**, then **Factory reset** afterwards. The factory reset:

- **wipes** the trial data: `inventory_lots`, `inbound_manifests`, `lab_results`, `catalog_product_drafts`,
  `menu_items`, `menu_versions`, `pos_imports`;
- **keeps** everything learned about products: the knowledge base (`kb_*`), `product_enrichments`,
  `product_fact_provenance` (who attached each fact), `product_image_memory` (the photos you picked),
  `lookup_jobs` (record of each Gemini batch) and `cultivera_mail_docs` (the harvested vendor emails;
  you will NOT need to harvest the mailbox again).

On migration day the same products arrive again. Onboarding fills each one from memory and the
knowledge base first (KB-first, attached facts with their source), so the Gemini work from the dry run
is reused, not paid for twice.

Before a real dry run:

1. **Leafly auto-sync must be OFF** (Admin -> Integrations -> Leafly; it only pushes when you switch it
   on). Otherwise the trial menu would go to Leafly.
2. The public website menu WILL show the trial products until the factory reset. Do it after the
   store has closed, or accept that the menu looks like Cultivera's for a while (it is Cultivera's).
3. Do not approve anything in Receiving during the dry run. The first receiving approval after a real
   Cultivera publish counts as "cut over", and a second real Cultivera upload is then refused until the
   factory reset.

## When can I run it?

**Now**, once S11 and S12 are deployed (check the green Vercel tick). Everything below exists. What is
still to come (W3: auto-Start after the rebuild, field survivorship, the category-pick finish gate, and
the workbook fix for your scanner error) makes the day shorter but is not needed to see it work.

## The sequence (dry run = migration day, except where noted)

### A. The mailbox (any day before; done once, kept by the reset)

1. Admin -> Menu Imports -> **Vendor mailbox** -> **Test the vendor mailbox**. It must say it signed in.
2. Press **Harvest the next batch**. Each press reads up to 47 emails, **newest first**, so each press
   reaches further back in time. The line under the button now says:
   "Emails kept run from <oldest> (oldest) to <newest> (newest). Last batch ran <time>."
3. Keep pressing until it says **Finished** and "The whole mailbox has been read". After that (R74 S18)
   press it whenever new vendor emails may have arrived: it lists the newest page, opens only emails not
   yet kept, and stops at the first page that was already fully kept ("Checked for new emails: none since
   the last press" / "up to date now"). If it says "press the button again", press until it does not.
4. Then press **Read everything in the background** once (R74 S20; for example before bed) and let the
   every-minute worker read every kept PDF and spreadsheet until the line says "Background reading
   finished". Or press **Read the kept PDFs and spreadsheets** by hand (five at a time, newest email
   first, about three minutes and up to 100 per press).
   Order: harvest everything first, then read. Reading in between is also fine; a read only works on
   files already kept.

### B. Fetch and publish Cultivera (dry run: after close; migration day: Sun 11/01 06:00)

5. Menu Imports -> set the count date, tick **Start fresh**, press **Fetch It All** (about 8 minutes;
   **Resume** on the run page if it stops).
6. Read the **go / no-go** on the run page. GO on every check, or fix what it names.
7. **Stage it with Test mode OFF** (within 90 minutes of the fetch finishing).
8. Fact review, then **Publish**. Then **Do the units balance?** must be green.
9. Migration day only: upload the count workbooks and apply (Count page), before opening.

### C. Rebuild the manifests (import page -> Rebuild Cultivera manifests)

10. Read the plan: real Cultivera transfers, rebuilt-from-received-date manifests, lots to move,
    exceptions. Tick "I reviewed this plan" and press **Apply rebuild** (**Resume rebuild** if it stops
    part-way). Only each lot's manifest changes; quantities, costs and the menu do not.
11. Click **Where each lot's manifest comes from** (the coverage report): Cultivera transfer / one
    emailed manifest / several emails (never guessed) / nothing (goes on `CV-UNMATCHED`), plus lots with
    no received date (CCRS clean-up).
12. In **Put the email-found lots on their manifests**, tick and press **Apply** (**Apply the rest** if
    it stops). This creates the emailed manifests and the ONE "Unmatched Cultivera stock" manifest.

### D. See the manifests (Receiving -> Cultivera manifests)

13. Admin -> Inventory -> Receiving -> **Cultivera** tab. Every manifest is listed. Use the **Source**
    chips (Cultivera transfer / Emailed manifest / Unmatched stock / Received-date group) and
    **Group by vendor**. Each vendor line links to **Onboard vendor**.

### E. Onboard and master by vendor (Product Onboarding -> Cultivera manifests by vendor)

14. Open a vendor. Press **Start every manifest from <vendor>** (press **Continue** until it says all
    started). Start attaches the vendor's lab results, archives and reads each COA, writes facts from
    the COA (potency, terpenes) and the Cultivera potency, links to the knowledge base, and creates the
    onboarding rows.
15. Press **Look up all N products from <vendor> with Gemini**. The every-minute worker looks them up
    (30 per run, up to `LOOKUP_PARALLEL_JOBS` manifests at once). Each answer is saved to the knowledge
    base.
16. Watch the **mastering panel**: products in onboarding, KB links, facts by source (lab certificate /
    Cultivera / Gemini / remembered / knowledge base / a person), facts by field, lots linked to a lab
    result + certificate kept, Gemini progress and the latest timeline notes. Refresh to see it move.
17. Approve products as normal. Each approval refreshes its live card.

### F. Dry run only: put it back

18. Admin -> Settings -> **Factory reset**. The trial lots, manifests, drafts and menu go; the knowledge
    base, provenance, photo memory, lookup records and harvested emails stay.

### G. Migration day only: open

19. Open at 08:00. Receiving is the only door. Change the Cultivera password when Cultivera is no longer
    needed. Daily drift check through 11/08 (see the one-page checklist).

## Vercel settings for quality lookups

Product Onboarding shows a **Gemini sprint** line near the top (R74 S21). Green means everything below is set correctly. Gold or red names the exact variable to change; change it in Vercel, redeploy, reload the page.

| Variable | Set to | Why |
|---|---|---|
| `AI_MODE` | `sprint` | **This is the "sprint" one.** Heavy tasks (the web-search lookup) use `AI_MODEL_HEAVY`. |
| `AI_MODEL_HEAVY` | your Gemini model (3.8 Flash is set) | A `gemini...` id switches on Google Search grounding. |
| `AI_THINKING_LEVEL` | keep `low` (or `medium`/`high` for deeper single-row lookups) | Only `minimal`/`low`/`medium`/`high`. NOT "sprint". The interactive row lookup. |
| `AI_BATCH_THINKING_LEVEL` | leave unset (= `high`) | The batch (vendor) lookup thinks hardest by default. |
| `LOOKUP_PARALLEL_JOBS` | optional, `4` (default) up to `8` | How many manifests Gemini works on at once. |
