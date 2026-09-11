# Your TSP650II BTi — will it work, and what is the cheapest path?

**Your printer:** Star Micronics TSP650II BTi, part **39449871**. In Star's own
numbering this is the **TSP654IIBI** — the Bluetooth model of the TSP650II family.

**Short answer: the printer is a keeper. The Bluetooth card in it is not.**
A **$49.95 swappable interface card** turns it into exactly what we need. Do not
buy a new printer.

---

## 1. Why Bluetooth alone cannot do this job

This is the same wall the earlier plan hit with the shop's TSP143IIIBi, and it is
worth being precise about *why*, because "it has Bluetooth and Bluetooth is
wireless" sounds like it should be enough.

| Requirement | Bluetooth |
|---|---|
| Print with nobody standing there | **No** — needs a paired host device awake and connected |
| More than one thing talking to it | **No** — Bluetooth SPP is one host at a time |
| Poll our website for jobs | **No** — Bluetooth has no concept of an internet connection |

The one-host limit is the killer. If the Pi pairs with the printer, it **evicts
whatever else was paired with it.** That is the trap we already documented once.

### About the WebPRNT Browser app you saw on Amazon

Amazon is telling the truth — Star's own app listing names **"TSP650II :
Bluetooth"** as supported. But WebPRNT Browser is not what it sounds like, and I
want to be blunt because the name is genuinely misleading.

**WebPRNT Browser is a replacement web browser app you run on a tablet.** From
Star's setup instructions: you install the app on an iPad or Android tablet, pair
the printer to *that tablet*, type your website's URL into the app's settings, and
then the app opens your site **in full-screen mode**. Printing only happens when
that app is open, on that tablet, with that page loaded, with somebody there.

So it would mean: a tablet, permanently on, permanently awake, permanently
displaying our back office in a locked-down full-screen browser, that nobody may
close or navigate away from — or receipts stop printing silently.

That is a manned kiosk. **What you asked for is an unattended printer that spits
out a ticket when an online order lands, at 2am, with the shop empty.** WebPRNT
cannot do that. It is the right tool for a cashier printing from a tablet till,
which is not our problem.

---

## 2. The fact that saves you: the interface is a removable card

The TSP650II was built with a **swappable interface slot** — a card held in by two
Phillips screws on the back. Star's own support article lists the supported
printers for interface swaps and **TSP650II is on it**, alongside SP700, TSP700II,
TSP800II, TUP500, TUP900, TSP1000 and HSP7000.

**So the printer body, the print head, the cutter and the power supply are all
fine.** Only the little communications card is wrong. Swap the card, keep the
printer.

### One disagreement in the sources, resolved

I have to flag this rather than paper over it, because it is the single fact the
whole recommendation rests on.

**POSGuys' FAQ says, for the TSP650 & TSP650II series: "Bluetooth is fixed."**
That would mean your specific printer is the one variant that cannot be converted,
and it would make this entire recommendation wrong.

**I believe POSGuys is mistaken, and here is the evidence.** Owl POS sells a
*swappable Bluetooth interface card* (IFBD-HB) whose listing says "Easily Swappable
Card for Star Micronics TSP654BTi" — that is your exact model. More persuasive
than any spec sheet, it carries a verified customer review:

> *"I have a TSP650II Printer but a cable (non Bluetooth), so to change it to
> Bluetooth, I ordered this bluetooth interface card, install it instead the cable
> card of my printer and now my printer work on bluetooth"*

Somebody physically pulled a **wired card out** and pushed a **Bluetooth card in**,
in a TSP650II, and it worked. It is the same slot, and the Bluetooth card is a card
like any other. There is no mechanism by which that swap would work in one
direction and not the other.

### The 60-second check that settles it for free

**Before ordering anything, look at the back of the printer.** You are looking for
a metal plate roughly the size of a credit card, with the Bluetooth pairing
button/LED on it, **held in by one screw on each side (or two screws along the
top)**.

- **Screws and a removable plate** → it is a card, the swap works, order below.
- **No screws, connector moulded into the case** → it is fixed, and I will price a
  new printer instead. Send me a photo of the back and I will tell you which.

---

## 3. The three cards, cheapest first

All prices verified today. The two refurbished options carry a 90-day warranty and
free ground shipping.

| Option | Card | Price | What we build | Verdict |
|---|---|---|---|---|
| **A** | **IFBD-HU07 (USB)** | **$49.95** | Pi print agent | **Cheapest — my pick** |
| B | IFBD-HE07 (Ethernet) | $95.00 | Pi print agent, over the network | No real gain over A |
| C | IFBD-HI01X (CloudPRNT) | $146.90 | **Nothing** | Zero code, 3x the price |

### Option A — USB card, $49.95 ← recommended

Plug the printer into the Raspberry Pi you are setting up **right now**. One small
box in the office runs the announcer *and* the printer.

Why this is the right call:

- **It is the cheapest thing that works**, by a wide margin.
- **The Pi is already there.** You are mid-install on it as I write this.
- **Star publishes an official Linux driver** (CUPS v3.17.0) that explicitly names
  **TSP650II** in its supported list. Manufacturer-supported, not a hack.
- Even without the driver, Linux exposes USB receipt printers as `/dev/usb/lp0` and
  our receipt is already **plain text** — `formatReceipt()` emits 48-column text and
  the CloudPRNT route already serves it as `text/plain`. There is no graphics
  format to wrestle with.
- **We do not need to change the printer's emulation mode.** That switch only
  matters for ESC/POS graphics. Plain text prints in either mode.

The cost is that I have to build the print agent. That is real work, but it is
work I would do for free and it is **the same shape as the announcer that already
exists and is proven**: poll the site, take a job, do the thing, acknowledge. The
last step changes from "play a sound" to "write text to the printer". It reuses the
same queue, the same pairing model, and the same systemd/retry/backoff scaffolding.
**One path, not a second competing one.**

### Option B — Ethernet card, $95.00

Same amount of work as A for $45 more. Only worth it if the printer has to live
somewhere the Pi cannot physically reach with a USB cable. It does buy you
independence from the Pi, but it needs a network drop wherever the printer sits.

### Option C — CloudPRNT card, $146.90

The honest luxury option. **This one needs zero new code.** Our
`/api/cloudprnt` route already exists, already speaks the CloudPRNT protocol
(POST/GET/DELETE), already has the poll-token auth, the job queue, the retry logic
and the diagnostics panel. You would point the card at the URL and receipts would
start printing.

I am not recommending it, because **$97 more than Option A buys you convenience I
can deliver in software for nothing.** But if you would rather have fewer moving
parts than save the money, this is the one to buy, and it is a legitimate choice.

---

## 4. What is already built, and what is missing

Worth knowing how little is actually left:

**Already shipped and working:** the `receipt_print_jobs` queue, the printer
settings table, retry logic, the diagnostics panel, the printer chip with one-tap
test print on the online-orders page, the receipt formatter, and the full CloudPRNT
endpoint.

**Missing:** only the last hop — the thing that takes a job off the queue and
pushes bytes at the printer. That is the agent, and only for Options A and B.

---

## 5. What I recommend

1. **Look at the back of the printer** for the two screws. Free, 60 seconds.
2. If it is a card: **buy the IFBD-HU07 USB card, $49.95.**
3. Finish the Pi announcer install (already in progress).
4. I build the print agent and it rides the same Pi.

**Total spend: $49.95. No new printer, no monthly fee.** CloudPRNT was never a
subscription — it is just a polling protocol with a URL you configure yourself.

If the back of the printer turns out to have no removable card, tell me and I will
price the cheapest new unit that does the job — but on the evidence above I do not
expect to need to.

---

## Sources

- Star Micronics, *How to Change Swappable Interfaces on Star Printers* — lists
  TSP650II as a swappable-interface printer
  https://starmicronics.com/help-center/knowledge-base/how-to-change-swappable-interfaces-on-star-printers
- Star Micronics, *TSP650II Series datasheet* — interface variants incl. TSP654IIBI
- Star Micronics, *TSP650II BTi datasheet* — "Bluetooth SPP and iAP, WebPRNT Browser"
- Star Micronics, *Star webPRNT Browser* app listing — "TSP650II : Bluetooth"
  https://play.google.com/store/apps/details?id=com.starmicronics.starwebprntpaid
- ShopTill-e, *Star WebPRNT Browser + Star Bluetooth Printer* — setup showing the
  app replaces the tablet browser and runs full-screen
  https://www.shoptill-e.com/support/60
- Owl POS — IFBD-HU07 USB $49.95; IFBD-HE07 Ethernet $95.00; IFBD-HB Bluetooth
  $125.00 incl. the customer review confirming a wired→Bluetooth card swap
- Spartan POS — IFBD-HI01X Ethernet/USB/CloudPRNT $146.90
- POSGuys FAQ #2334 — the dissenting "Bluetooth is fixed" claim, quoted above
- Star Micronics, *CUPS Driver for Linux* v3.17.0 — TSP650II in supported models
- Internal: `src/app/api/cloudprnt/route.ts`, `src/lib/printing/receipt-core.ts`,
  `src/lib/printing/printer-store.ts`, `pi-agent/greenway_announcer.py`
