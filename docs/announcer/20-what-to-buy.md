# What To Buy — Shopping List

**Goal:** three speakers — office, sales floor, storage — that announce online
orders reliably and cost as little as possible to keep running.

This is a *what works together* list, not a brand endorsement. Prices are
approximate US retail as of early 2026 and drift; treat them as a budget guide,
not a quote. Buy the middle option unless a note says otherwise.

---

## THE HEADLINE DECISION: BUY THE PI 4, NOT THE PI 5

This is the single most important line in this document.

**The Raspberry Pi 4 Model B has a 3.5 mm analog audio jack. The Raspberry Pi 5
does not.** That is confirmed from Raspberry Pi's own hardware documentation:
the Pi 4B's port list includes a "3.5 mm AV jack"; the Pi 5's does not — it
lists two micro-HDMI ports, USB, and PCIe, with no analog audio output.

Consequences if you buy a Pi 5 anyway:

- You need a **USB audio adapter or a DAC HAT** for every single unit — more
  parts, more cost, one more thing to fall out.
- You need a beefier **5V 5A (25 W)** power supply instead of the Pi 4's
  **USB-C 5V 3A (15 W)**.
- You get performance you will never use. This program sleeps almost all day.

**Also avoid the Pi Zero series for this job.** Zero boards have only a
mini-HDMI port and two micro-USB ports — **no analog audio jack at all** — and
the Zero 2 W has 512 MB of RAM. They are cheaper, but every one needs a USB
audio dongle plus adapters, which erases the saving and adds failure points.

> **Rule of thumb:** the boring Pi 4 with the plain headphone jack is the right
> answer here. Fewer parts is more reliable, and reliability is the entire
> point.

---

## PER SPEAKER (multiply by 3)

| # | Item | Spec that matters | Budget each | Notes |
|---|------|-------------------|-------------|-------|
| 1 | **Raspberry Pi 4 Model B** | **2 GB RAM is plenty** | $45–$60 | Do not pay for 4 GB or 8 GB. This program idles. |
| 2 | **Official USB-C power supply** | **5V / 3A (15 W)** | $8–$12 | **Do not use a phone charger.** Underpowered supplies cause random reboots and SD corruption. This is the #1 cause of "my Pi died". |
| 3 | **High-endurance microSD card** | **32 GB, Class 10 / A1, "high endurance"** | $10–$15 | The dashcam-rated kind. Card death is the top Pi failure mode; endurance cards are built for constant writing. Don't go above 32 GB — bigger is not better here. |
| 4 | **Powered speaker with 3.5 mm input** | **Mains powered, not USB-bus powered, with its own volume knob** | $25–$45 | See sizing note below. |
| 5 | **Case with passive cooling** | Aluminium or vented ABS | $8–$15 | No fan. Fans are the only moving part and the only thing that whines in a quiet office. |
| 6 | **3.5 mm audio cable** | Male-to-male, 6 ft | $5–$8 | Buy one longer than you think. |

**Per-speaker subtotal: roughly $100–$155.**

### Sizing the speaker to the room

| Room | What to get | Why |
|---|---|---|
| **Office** | Small desktop speaker, ~5–10 W | Quiet room. A big speaker is startling. |
| **Sales floor** | Louder powered speaker, ~15–30 W | Must cut through conversation and music. This is the one to spend extra on. |
| **Storage** | Mid-size, ~10–20 W | Often a hard, echoey room; sound carries. Mount it high. |

**Requirements, in priority order:**

1. **It must be mains powered.** Speakers powered from the Pi's USB port steal
   current from the Pi and cause exactly the brownout problems you are trying
   to avoid.
2. **It must have a physical volume knob.** This is your fastest fix in every
   room and it needs no computer.
3. **It must turn back on by itself after a power cut.** Test this in the shop
   before you commit. Some speakers with soft-touch power buttons come back
   *off*, which silently defeats the whole system. A plain mechanical switch is
   better than a clever one.
4. Powered "bookshelf" or "multimedia" speakers are ideal. Bluetooth speakers
   are a bad fit — pairing drops, batteries die, and they sleep to save power.
   **Use the cable.**

---

## ONE-TIME, SHARED ACROSS ALL THREE

| Item | Budget | Why |
|---|---|---|
| **Spare microSD card, pre-imaged** | $12 | Turns a dead Pi from a day of downtime into a 15-minute swap. **Buy this.** |
| **Spare USB-C power supply** | $10 | The other thing that dies. Together these two are the best money in this list. |
| **USB microSD card reader** | $8 | For writing cards from your laptop. |
| **USB keyboard + micro-HDMI cable** | $20 | For the day SSH won't connect. Borrow if you can. |

**One-time subtotal: about $50.**

---

## THE BOTTOM LINE

| | |
|---|---|
| Three speakers, fully equipped | **$300 – $465** |
| Spares and tools (one-time) | **$50** |
| **Total** | **≈ $350 – $515** |
| Ongoing monthly cost | **$0** |
| Electricity | A few dollars a year — a Pi 4 idling draws a handful of watts |

---

## WHAT NOT TO BUY

- **A Raspberry Pi 5** — no analog audio jack, needs extra parts and a bigger
  power supply. See above.
- **A Pi Zero / Zero 2 W** — no analog audio jack either, and 512 MB RAM.
- **Bluetooth speakers** — they drop, sleep, and need re-pairing.
- **Wi-Fi "smart" speakers (Alexa/Sonos/etc.)** — they need cloud accounts and
  can't be told what to do by this system.
- **A cheap no-name power supply** — the false economy that eats SD cards.
- **A huge microSD card** — 32 GB high-endurance beats 256 GB standard, every
  time, for this job.
- **A case with a fan** — noise and a moving part, for a computer that runs
  cool doing nothing.

---

## INSTALL-DAY CHECKLIST

Do these in order for each Pi. Don't do all three at once — get one working
end to end first, so you learn the process on the easy one.

- [ ] Write Raspberry Pi OS (64-bit) with **Raspberry Pi Imager**
- [ ] In Imager's settings gear, **before writing**: set the hostname
      (`greenway-office`), set a **username and password**, enable **SSH**, and
      enter the Wi-Fi details. Write the username down — you need it to log in.
- [ ] Card into Pi, speaker cable into the **3.5 mm jack**, speaker to mains
- [ ] Power up, wait 2 minutes
- [ ] Confirm you can reach it: `ssh USERNAME@greenway-office.local` (there is
      no default `pi` user any more; use the username you just set)
- [ ] Back office → Orders → Announcer → **Add a speaker** → name it after the
      **room**, not the hardware
- [ ] Run the installer with the code (see the field manual, PART 5)
- [ ] Green dot appears in the back office within 30 seconds
- [ ] Press **Test** — you hear a chime in that room
- [ ] **Pull the power, plug it back in, wait 2 minutes, confirm the green dot
      returns by itself.** Do not skip this.
- [ ] Write the room name and today's date on a label on the Pi
- [ ] Only now, start the next one

---

## PHYSICAL PLACEMENT

Small things that prevent months of intermittent problems.

- **Mount speakers high**, above head height, aimed into the room.
- **Do not shut a Pi in a sealed cupboard.** They run warm; they want air.
- **Keep them out of dust** — storage rooms are the worst offender.
- **Use the strongest Wi-Fi spot available**, or run an Ethernet cable if the
  Pi is near a switch. **Wired is always more reliable than wireless.** The
  storage room is usually the weak spot; check the signal before you mount
  anything permanently.
- **Label every Pi and every power supply.** When you're troubleshooting under
  pressure you will not remember which is which.
- **Put the Pi and its speaker on the same power strip**, so they lose and
  regain power together.
