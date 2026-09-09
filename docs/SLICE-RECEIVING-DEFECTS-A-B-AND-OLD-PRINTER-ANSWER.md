# Slice report — receiving defects A + B, and the old-printer question

**Date:** 2026-09
**PR:** #1140 — `Receiving defects A+B: refuse ambiguous auto-receive, fix size-spacing key`
**Standing rules honoured:** build from fact not memory; recon before touching; never guess, never assume; test it, test the tests.

---

## Part 0 — The short version

**The fix is done and merged.** Two receiving defects closed in one slice, both grounded on your real database rather than on my opinion, and the tests were themselves tested with a mutation harness that killed 15 of 15 mutants.

**The printer answer is YES — with one honest condition.** An old wired USB receipt printer on the Pi will very probably work and cost you **$0**, because of a fact I confirmed by reading our own shipped code: the print queue stores receipts as **plain text**, not as a Star-proprietary binary. That means almost any receipt printer made in the last twenty years can print our receipts. The condition is that I need the **make and model** off the bottom of your printers before I promise anything, because "never guess" applies hardest when you are about to spend an afternoon on a project. There is a two-minute test at the end of this report that answers it definitively.

---

## Part 1 — Defect A: auto-receive was guessing, and guessing silently

### What was wrong

`buildAutoReceivePlan` is not advisory. `po-receive-store.ts:115` takes its output and calls `receivePoLine(lineId, qty)` for real, with no human in the loop. Whatever this planner decides, the database believes.

When a lot arrived with no `pos_product_key`, the planner fell back to matching on product name. That fallback ended like this:

```ts
candidates.find((l) => remaining(l) > 0) ?? candidates[0]
```

If two purchase-order lines normalized to the same name, that `?? candidates[0]` picked one and moved on. No error, no flag. The timeline note said "Auto-received" and everybody believed it. Stock landed against the wrong PO line, the wrong line looked filled, the right line looked short, and nobody found out until a count disagreed weeks later.

### Why this is not hypothetical

I measured it against the real strain names in the back-office database rather than reasoning about whether it could happen. Across **1,707 real strain names** there are **4 raw name collisions** and **12 full-SKU collisions**. The clearest one:

> `Orange & Cream` vs `Orange Cream`

Those are two different products. Under the old code, a keyless lot named "Orange Cream" would have been booked against whichever of those two lines happened to come first.

### The fix

A name match with more than one candidate is now **refused**, not resolved. The lot goes to `unmatchedLots` with `reason: "ambiguous-name"`, and a human receives it on the PO page in about thirty seconds.

The reasoning I want on the record, because it is the whole philosophy of the change:

> **A miss is recoverable and visible. A wrong receipt is neither.**

Refusing costs thirty seconds of somebody's time. Guessing costs a silent inventory error that surfaces weeks later with no audit trail pointing at its cause. Receiving already refuses to guess an ambiguous *brand* (rule 11, `brand-resolve-core.ts`); this makes it hold the same line on product identity.

**What deliberately did NOT change:** the `pos_product_key` path still allows several candidates. Two lines sharing one POS key is a *duplicate-line* situation — the same product entered twice — not an identity ambiguity. There, "fill the line that still needs product first" is the correct answer, and refusing would be a regression that annoys you for no safety gain. I tested that distinction explicitly so a future edit cannot blur it.

---

## Part 2 — Defect B: one product, typed two ways, counted as two

### What was wrong

`Blue Dream 3.5 g` and `Blue Dream 3.5g` produced **different** match keys. Same product, one space apart, and the name fallback missed it entirely — so the lot dropped to manual receiving for no reason.

### The fix I nearly made, and why measuring stopped me

The obvious fix is to squeeze out all the whitespace, which is exactly what `brandKey()` already does elsewhere in the codebase. I was one step from copying that pattern.

I measured it first against the **2,615 real product records** instead:

| normalizer | distinct keys | colliding keys |
|---|---:|---:|
| current (before this slice) | 2,615 | 0 |
| **squeeze all whitespace** | 2,614 | **1 — REGRESSION** |
| **number + unit join** (shipped) | 2,615 | **0** |

The squeeze-all collision is real, from your own data:

```
'Drops 1:1 CBD Daydreamy Cranberry/MAC #4'
'Drops1:1 CBD Daydreamy Cranberry / MAC #4'
```

Squeezing all spaces merges those two into one key. That is the *identical class of bug* as defect A — two products treated as one — introduced by the "fix".

The deeper reason: **in a brand name, spacing carries no meaning. In a product name, spacing sits right next to SIZE, and size is identity.** Booking a 1g delivery against a 3.5g line is precisely the wrong-line error this module now refuses to commit.

### What shipped

A narrow rule: join a bare number to a following unit token from a short closed list (`mg, g, oz, ml, pk, ct, pc`).

Measured result: closes **2,026 of 2,026** spacing misses, with **0** new collisions and **0** size merges. Different sizes stay different products; `Batch 5 A` is left alone because `A` is not a unit.

---

## Part 3 — A third bug the tests found on their own

While proving defect A, one of the new tests failed in a way I had not predicted. When *nothing* in a delivery could be auto-received, the timeline note read:

> "none of the N accepted lot(s) matched a PO line — receive them manually on the PO page."

It never said **which** lots. Somebody standing at the dock with a stack of boxes got told to do something manually, with no list.

Both note paths now name the lots, and the two refusal reasons read differently — because an ambiguous lot **is** on the PO (twice), and filing it under "Not on the PO" would send your receiver hunting for a product that is sitting right there on the order.

---

## Part 4 — Testing the tests

You asked for this specifically, and it was worth it.

`scripts/recon/po-receive-mutation.py` deliberately breaks the fix in 15 realistic ways — deleting the refusal, flipping the guard to the wrong path, off-by-one on the candidate count, forgetting the `continue`, reporting quantity 0, and so on — and demands the suite go **red** for every single one.

**Final result: 15 mutants, 15 killed, 0 survived.** Source verified byte-identical afterward.

**But the first run only killed 13 of 17,** and what happened to the four survivors is the part I want you to see:

- **A9 and B7 were real holes in my net.** My tests would have passed while the code was broken. I added tests. A9 is what exposed the unnamed-lots bug in Part 3 — the mutation harness found a genuine product defect, not just a test gap.
- **B4 and B8 were proven equivalent — so I deleted the code instead of excusing it.** B4 was a clever regex group for spanning decimals; I compared it against the simpler version across all 2,615 real names and **0 keys differed**, because punctuation stripping already runs first. B8 was a defensive `lastIndex = 0` that does nothing, since `String.replace` with `/g` resets it itself and nothing calls `.test()`. Both are now gone.

> **A defensive line of code that cannot be observed when you remove it is not defence. It is decoration.**

The easy move was to write "equivalent mutant, ignore" in a comment. Deleting dead complexity is better, and mutation testing is what proved which was which.

### Also fixed: a compliance gap nobody had noticed

`__runPoReceiveCoreTests` was registered in **neither** central self-test runner — it had never run in CI. That is a rule 50/39 violation that predates this slice. It is now registered in both.

### Verification

| check | result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `eslint` | **0 warnings** |
| full test suite | **606 files, 15,463 tests, all passing** |
| mutation harness | **15/15 killed, 0 survived** |

---

## Part 5 — Your printer question, answered

> *"i have old wired receipt printers from long ago, can i use one of them for printing from the pi? i really dont want to buy another printer."*

### The short answer: almost certainly yes, for $0

I understand the frustration — the TSP143IV at ~$316 was barely a saving over the ~$400 cloud printer, and you were right to reject it.

### The fact that changes everything

I went back and read our own shipped code rather than reasoning from the printer's spec sheet. In `supabase/migrations/0047_receipt_printing.sql`, the queue column is documented in the schema itself:

```sql
-- what to print, already rendered to plain text (text/plain media type).
body_text     text not null,
```

And `src/app/api/cloudprnt/route.ts` serves it as `Content-Type: text/plain; charset=utf-8`.

**Our receipts are plain text.** They are not StarLine binary, not ESC/POS graphics, not a proprietary raster format. That is the single most important fact in this whole report, because a plain-text receipt will print on essentially **any** receipt printer ever made — Star, Epson, Bixolon, Citizen, no-name. The hard compatibility problem I was worried about does not exist for us.

### Why the old printer works where the shop's current Star printer did not

To be clear about why the earlier plan died: the shop's **TSP143IIIBi is Bluetooth**, and I proved from Star's own manual that its rear USB port is **power only** — *"Communication with the printer via a USB port (1.0A) is not possible."* Bluetooth is also one-host-at-a-time, so a Pi would have evicted your iPad register. That printer was the wrong tool.

An **old wired USB printer is a completely different situation.** It is a dedicated, permanently-connected device that nothing else is competing for. That is the *ideal* setup — arguably better than the cloud printer, because online-order receipts print on their own hardware and never interrupt the register.

### "The goofy square looking plugs" — yes, that is the right connector

That is **USB Type-B**, the squarish connector with two clipped corners, standard on printers. Pi end is a normal USB-A. A standard A-to-B printer cable, likely already in the box with the printer.

### How it works on the Pi

The Linux kernel has handled these for decades via the `usblp` driver. Plug it in, and it appears as a device file — typically `/dev/usb/lp0`. Printing is then literally writing bytes to that file:

```
echo "Hello" > /dev/usb/lp0
```

If that prints, you are done — everything else is software we already have.

### What I need from you (this is the "never guess" part)

I will not promise your specific printers work without knowing what they are. Two options:

**Option 1 — tell me the model.** Look on the bottom or back for a label like `TSP100`, `TSP143`, `TM-T20`, `TM-T88IV`, `SRP-350`, `CT-S310`. Send me that string.

**Option 2 — the two-minute test that settles it.** Plug the printer into the Pi, power it on, and run these three commands:

```bash
lsusb
dmesg | tail -20
ls -l /dev/usb/
```

Send me the output. `lsusb` names the manufacturer, `dmesg` shows whether `usblp` claimed it, and `ls /dev/usb/` shows whether a device file appeared. If `/dev/usb/lp0` exists, then:

```bash
echo -e "GREENWAY TEST\n\n\n" > /dev/usb/lp0
```

If paper moves, the answer is a definitive yes and we build it.

### Encouraging specifics I confirmed

- **Star publishes an official Linux CUPS driver** (v3.17.0, updated April 2026) explicitly covering the old wired models: **TSP100IIU, TSP100IIIU, TSP650II, TSP700II, TSP800II, SP700**. If your old printer is one of these, it is directly supported by the manufacturer on Linux — no reverse engineering.
- **Epson TM-series** (TM-T20, TM-T88) are the most common POS printers in existence and work through `usblp` as raw ESC/POS.
- We would **not** need to switch the printer's emulation mode. Star's emulation switch requires a Windows utility, but that only matters if we were sending ESC/POS graphics. Plain text prints in either mode.

### What building it involves

The good news is how little is left. The **entire print queue already ships** — `receipt_print_jobs`, the printer settings table, the retry logic, the diagnostics, and the live printer chip with one-tap test print already sitting on your online-orders page. Only the last hop is missing.

We already have a working, proven template: your Pi announcer (`pi-agent/greenway_announcer.py`) already polls Supabase on a lease, handles backoff, retries, and runs under systemd. A print agent is the same shape with the last step changed from "play a sound" to "write text to `/dev/usb/lp0`". It reuses the same queue and the same pairing model — **one path, not a second competing one.**

Cost: **$0 in hardware, $0/month.** No Star cloud subscription, no Eatabit service. CloudPRNT was never a subscription anyway — it is just a polling protocol with a URL you configure yourself.

### My honest recommendation

Do the two-minute test before we write a line of code. If paper moves, you have saved $400 and you get a better architecture than the cloud printer would have given you. If it does not, we will know exactly why from the `dmesg` output, and we will still not have spent anything.

---

## Appendix — reproducing every measurement

```bash
# Defect B evidence: 3 normalizers over 2,615 real product records
python3 -u scripts/recon/receiving-name-key-measure.py

# Defect A evidence: name/SKU collisions over 1,707 real strain names
python3 -u scripts/recon/receiving-sweep-part3.py

# Test the tests: 15 mutants, expect 15 killed / 0 survived
python3 -u scripts/recon/po-receive-mutation.py

# Standard verification
NODE_OPTIONS=--max-old-space-size=3200 npx tsc --noEmit
npx eslint .
npx vitest run
```

### Sources

- Star Micronics, *CUPS Driver for Linux* v3.17.0 — supported model list
  https://starmicronics.com/support/download/cups-driver-for-linux
- Star Micronics, *How to Change the Emulation on Star TSP100 Series Printers* — StarLine vs ESC/POS
  https://starmicronics.com/help-center/knowledge-base/how-to-change-the-emulation-on-star-tsp100-series-printers
- Michael Billington, *Getting a USB receipt printer working on Linux* — `usblp`, `/dev/usb/lp0`, `lp` group permissions
  https://mike42.me/blog/2015-03-getting-a-usb-receipt-printer-working-on-linux
- python-escpos documentation — USB printers, Raspberry Pi notes
  https://python-escpos.readthedocs.io/
- Internal: `supabase/migrations/0047_receipt_printing.sql`, `src/app/api/cloudprnt/route.ts`, `pi-agent/greenway_announcer.py`
