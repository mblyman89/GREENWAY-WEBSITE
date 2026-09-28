# Cultivera cutover runbook: publish Cultivera first, then receive

**Slice S18** (bible chapter 7.3 / 7.4; findings F-041, F-074, F-076, F-088).
In the app: **Admin → Menu Imports → "Cultivera cutover runbook"**
(`/admin/menu-imports/cutover`). This file is the long form; the page is the
checklist you tick through on the day.

> The Cultivera upload is a **one-time event**. After it, every product
> enters Greenway through receiving (AGENTS.md rule 11). This runbook exists
> because the order of that one day matters, and until S18 no document
> described it (F-076).

---

## Why the order matters (read once)

Every menu update from receiving is a **snapshot**: the menu that is live
right now, carried forward, plus the products you just approved (F-041).

- If the Cultivera upload is **published first**, the next receiving update
  carries every Cultivera product plus the new one. Correct.
- If a receiving update is published **while the Cultivera upload is still
  waiting**, it is built without the Cultivera products. Publishing Cultivera
  afterwards replaces it, and the receiving products are gone from the menu
  unless they happened to be copied into the upload (F-074: drafts approved
  *before* the upload are copied in; drafts approved *after* it are not).

So: **upload → review → publish Cultivera → check the lots → start receiving.**

## What the app now does for you (S18 guard)

The guard is on by default (`INTAKE_CUTOVER_GUARD`, see the env ledger). It
only ever acts while a **real** Cultivera upload (Test mode off) is staged.

| Situation | What happens |
|---|---|
| You approve a received product while a real Cultivera upload is staged | The menu update is saved but **held**. The delivery's timeline and the Publish page say: *"Your one-time Cultivera menu is uploaded but not published yet. Publish it under Menu Imports first — then every receiving update publishes itself on top of it."* |
| Someone presses Publish on a receiving update while Cultivera waits | Refused, with the reason. Nothing changes. |
| You publish the Cultivera upload | Every delivery with a waiting receiving update (up to 10 per click) is **rebuilt on top of the live Cultivera menu** and publishes itself. The page tells you how many. Anything past 10 is listed on the cutover page with a Rebuild button. |
| Someone presses Publish on an old held update after Cultivera is live | It is never published as-is (it predates Cultivera). Its delivery is rebuilt on the live menu instead. |
| A second **real** Cultivera upload after cutover | Refused (bible 7.4). Test-mode uploads stay allowed for rehearsals. |
| Test-mode upload staged | Never holds anything (bible S18.8). |
| The guard cannot read the database | It does nothing: no hold, no refusal. It can make publishing safer; it can never lock you out. |

Switching the flag off (`INTAKE_CUTOVER_GUARD=off`) restores the pre-S18
behaviour exactly.

## The runbook (do these in order)

Each step says **where**, **what to check**, and **why it matters**.

1. **Pause approvals (recommended).** Don't approve products on Product
   Onboarding until step 5 is done. *Why:* the first update carries only what
   is live (F-041). The guard makes this safe anyway (approvals wait instead
   of publishing), but pausing keeps the day simple.
2. **Upload PRODUCTS.xlsx + INVENTORIES.xlsx** on **Admin → Menu Imports**
   with **Test mode off**. *Check:* the upload's page shows the item, variant
   and vendor counts you expect from Cultivera. *Tip:* rehearse first with
   Test mode on; Clean Slate removes rehearsals without touching real data.
3. **Resolve the fact review** for the upload (the upload's page →
   *Open fact review*). *Why:* uncertain facts go to a human, never to
   customers.
4. **Publish the upload** from its page. *Check, right after:*
   - The green "Published" banner, and a second note if any receiving
     updates were rebuilt on top of it.
   - **Compliance inventory lots** on the upload's page: one lot per Barcode
     (F-074). If the page offers *Backfill lots*, press it (safe to repeat).
   - The public `/menu` shows the Cultivera cards.
   - **Admin → Menu Imports** now opens with *"Initial Cultivera import
     completed <date> (N products, N lots planned)"* and the subtitle *"Menu
     updates from receiving publish automatically. Your one-time Cultivera
     import was completed on <date>."* (S21). The upload form is folded
     behind **Show one-time import tools** (closed by default; Test-mode
     rehearsals are still in there). The date is the store's calendar date
     (Pacific). "Lots planned" is the lot plan saved with the upload, so it
     should match the lots you checked above; a count the upload did not
     record is shown as *not recorded*, never as 0.
5. **Check nothing is waiting.** Open **Admin → Publish Menu**. There should
   be no waiting update of either kind. Open the cutover page: "Still to
   rebuild" should say *none*. If a delivery is listed, press **Rebuild** on
   it.
6. **Start receiving.** From here on, receiving is the only product door.
   Approve with a price = published automatically.
7. **First approval after cutover.** *Expect:* a new menu update that carries
   every Cultivera item plus the new product, published automatically; the
   Publish page shows nothing waiting.
8. **A restock of something Cultivera already had** joins the existing card.
   With S19 (`INTAKE_VENDOR_ID_IDENTITY`, on by default) a different spelling
   of the vendor name still joins when both lots point at the same vendor
   record, and each row on Product Onboarding (one delivery picked) says what
   Approve will do *before* you press it: `Restock → joins live card '…'
   (from Cultivera import)`, `New card`, `Ambiguous: 2 live cards match — adds a new
   card` (with a link to each matching live card so you can compare them — Product
   Mastering is not read by the merge, so it is not linked; a remembered "join this
   card" decision is slice S32) or `Already on the live menu`.
   *Known limit (bible S19.8):* a Cultivera card with a **blank vendor**
   never merges. In the import code those are the Products-workbook items
   with no inventory row (`transform.ts` "no-inventory" group: vendor `""`,
   hidden, reason `no_inventory`), so they are hidden and hold no lots. A
   receiving delivery of that product becomes its own new card, and the
   preview says `New card` for it (it never claims a join it will not make).

## If products were approved before the Cultivera publish

- **Approved before the upload (step 2):** they were copied into the upload
  (F-074 `injectApprovedDraftsIntoVersion`), so they go live with it.
- **Approved after the upload but before publishing it:** with the guard on,
  their updates were held and are rebuilt automatically at step 4. With the
  guard off, re-approve them from receiving after step 4 (see below).

## What NOT to do (bible 7.4)

- **Don't run the Cultivera import a second time after cutover.** It would
  replace your menu with an old POS export. The app refuses it.
- **Don't publish an older waiting update to "restore" something.** A
  snapshot removes everything newer. **Restore by re-approving from
  receiving.**
- **Don't re-key Cultivera lots** (e.g. to SKUs). The `pos-…` keys are the
  lot lineage for migrated stock, exactly as SKU/lot code is for received
  stock.

## Legacy, import-only surfaces (F-088)

After cutover these only apply to the one Cultivera upload: the upload's
fact-review page (`/admin/menu-imports/[id]/facts`), `resolveFactReview` /
`pos_fact_reviews` (scoped to `import_id`), and the Backfill lots button.
Receiving has its own path for every one of them.

## Why a written runbook and a guard (evidence)

- **Written procedures cut recovery time.** Google's SRE book reports that a
  prepared playbook gives "roughly a 3x improvement in MTTR as compared to
  the strategy of 'winging it'", and that "roughly 70% of outages are due to
  changes in a live system" (Beyer et al., *Site Reliability Engineering*,
  O'Reilly 2016, ch. 1: https://sre.google/sre-book/introduction/). A
  one-time menu cutover is exactly such a change.
- **Short checklists prevent errors in rare, high-stakes steps.** The WHO
  Surgical Safety Checklist study (Haynes et al., *NEJM* 2009;360:491-9;
  7,688 patients across 8 cities) saw complications fall from 11% to 7% and
  inpatient deaths from 1.5% to 0.8%. Its lesson, in Atul Gawande's words:
  checklists "must be short, extremely simple" (Harvard School of Public
  Health release: https://www.sciencedaily.com/releases/2009/01/090114172304.htm).
  So the in-app page is eight short steps, and the hard rule (order) is
  enforced by the software rather than by memory.
- **Design choice (ours, not a study finding):** the guard holds and refuses
  rather than only warning, so the wrong order cannot publish even on a busy
  day when nobody reads the runbook.

## Rollback

`INTAKE_CUTOVER_GUARD=off`, then redeploy. No schema was added (S18.3).
Held updates stay staged and can be published by hand as before.
