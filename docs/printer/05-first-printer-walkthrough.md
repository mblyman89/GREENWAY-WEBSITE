# Your first receipt printer — start to finish

This is the walkthrough for the printer you just bought and the Raspberry Pi
you already own. It assumes nothing. If you follow it top to bottom you will
end up with a printer that spits out a receipt every time an online order comes
in, automatically, forever, including after a power cut.

Set aside about twenty minutes. Most of it is waiting.

---

## What you should have in front of you

**The printer.** A USB thermal receipt printer — the vretti 80mm unit, or any
ESC/POS printer with a USB port. It came with a power brick and a USB cable.

**The Raspberry Pi.** The same one that runs the order announcer. The printer
agent and the announcer are separate programs and they do not interfere with
each other, so one Pi can happily do both jobs at once.

**A roll of 80mm thermal paper.** Usually one comes in the box. Thermal paper
only prints on one side, which matters later.

**The back office open in a browser,** at
`Admin → Equipment → Receipt printer`.

---

## Why there is a Raspberry Pi in the middle

A fair question, since the printer has a USB port and a computer has USB ports.

The printer is a *dumb* device. It does not know what Wi-Fi is, it cannot dial
out to a website, and it has no idea what an order is. It understands exactly
one thing: a stream of bytes arriving over USB, which it prints. Nothing more.

Something has to sit between the website and that USB port, wake up when an
order arrives, fetch the receipt, and push the bytes down the cable. That is
the entire job of the Pi. It costs nothing extra because you already have one,
and it is why a $73 printer does the same job here as a $279 one.

The alternative — a printer that talks to the website by itself — exists, and
it is the Star CloudPRNT range starting around $279, or a $146.90 interface
card for the printer you already own. You chose the cheaper path, which was
the right call. This is the piece that makes it work.

The Pi always calls *out* to the website. The website never calls *in*. That
means no port forwarding, no firewall changes, no static IP, and nothing breaks
when your internet provider changes your address. It works the same on Wi-Fi,
on Ethernet, and on a phone hotspot.

---

## Step 1 — Plug the printer in

1. Load the paper roll. **The shiny side faces the print head.** If you get
   this backwards the paper will feed perfectly and come out completely blank.
   If that happens, flip the roll over. This catches almost everybody once.
2. Close the lid until it clicks. A lid that is merely resting shut reads as
   "open" and the printer will refuse to print.
3. Connect the power brick and switch the printer on.
4. Run the USB cable from the printer to any USB port on the Pi.

**Check the light.** A steady light means ready. A blinking light means the
printer is unhappy — almost always out of paper or a lid that is not fully
closed. Fix that before going any further; no amount of software will print
past a blinking light.

---

## Step 2 — Get your printer token

In the back office, go to `Admin → Equipment → Receipt printer`.

There is a **poll token** on that page. It is the shared password the Pi uses
to prove it is your printer and not a stranger's. If the field is empty,
generate one now.

Copy it. You will paste it in the next step.

---

## Step 3 — Install the printer agent on the Pi

### Which address to use — read this first

There are currently **two** Greenway addresses, and only one of them works for
the printer:

| Address | Use it for the printer? |
|---|---|
| The Vercel address (`…vercel.app`) — the site being built | **Yes.** This is where the printer software is deployed. |
| `greenwaymarijuana.com` — the current live shop site | **No, not yet.** |

The live domain sits behind a security gateway. Verified, not guessed: a
request to `greenwaymarijuana.com/api/cloudprnt` comes back as HTTP 202 with a
CAPTCHA redirect page instead of reaching the printer code at all. The printer
would poll forever and never receive a receipt.

When the new site is eventually pointed at `greenwaymarijuana.com`, re-point
the Pi with one command and nothing else changes:

```bash
sudo greenway-printer pair YOUR-TOKEN --site https://greenwaymarijuana.com
```

The installer now refuses to continue if it detects a gateway rather than
failing in a confusing way later, and the agent says so plainly in the log.

### The command

Open a terminal on the Pi (or connect with SSH), and run this as one command.
Replace `YOUR-SITE.com` with your website address and `YOUR-TOKEN` with the
token you just copied:

**Watch the `https://` carefully** — `https//` with no colon, or `https:/`
with one slash, are both rejected. The agent quotes your typo back with the
corrected version, so you do not have to hunt for it.

```bash
curl -fsSL https://YOUR-SITE.com/printer/install-printer.sh | sudo bash -s -- \
     --site https://YOUR-SITE.com --token YOUR-TOKEN
```

That one line does all of this:

- checks the Pi has Python and installs the one missing package if needed;
- makes sure the `usblp` printer driver is loaded (this is what turns your
  printer into `/dev/usb/lp0`, the file the agent writes to);
- downloads the agent and **runs its self-check before installing it**, so a
  half-finished download can never become your printing setup;
- saves your site address and token to a root-only file;
- verifies the token against the live website immediately, so a typo fails
  *now*, with a clear message, instead of silently at 9am on a Saturday;
- installs a service so the agent starts automatically on every boot;
- prints a test page.

**A test page should come out of the printer.** If it does, you are done with
the hard part.

### If you already cloned the repository instead

If you did `git clone` and you are sitting in the `pi-agent` folder, use the
local script — there are **two** installers in that folder and they are not
interchangeable:

```bash
cd ~/GREENWAY-WEBSITE/pi-agent
git pull                     # make sure you have the printer files at all
sudo ./install-printer.sh --site https://YOUR-SITE.com --token YOUR-TOKEN
```

| Script | What it sets up | Needs |
|---|---|---|
| `install-printer.sh` | the **receipt printer** | `--token` |
| `install.sh` | the **announcer** (speaker that reads orders aloud) | `--code` |

Each one now stops with a clear message if you hand it the other one's
options, instead of just saying it does not understand.

If `sudo ./install-printer.sh` reports **`command not found`**, that is `sudo`'s
confusing wording for "this file is not marked executable" — it does not mean
the file is missing. Fix it with:

```bash
chmod +x install-printer.sh
```

...or sidestep it entirely by naming the interpreter, which ignores the
executable bit:

```bash
sudo bash install-printer.sh --site https://YOUR-SITE.com --token YOUR-TOKEN
```

---

## Step 4 — Send a real receipt

Back in `Admin → Equipment → Receipt printer`, press **Test print**.

That queues a real receipt through the real queue — the same path a customer
order takes. Within a few seconds it should print.

If it does: you are finished. Place an order on the website to watch it happen
for real.

---

## Living with it

You will almost never need these, but this is where they are.

| What you want | Command |
|---|---|
| Is everything set up right? | `sudo greenway-printer status` |
| Print a test page | `sudo greenway-printer test` |
| Is the program itself healthy? | `sudo greenway-printer selftest` |
| Is the service running? | `sudo systemctl status greenway-printer` |
| Watch it work, live | `sudo journalctl -u greenway-printer -f` |
| Remove it completely | `curl -fsSL https://YOUR-SITE.com/printer/install-printer.sh \| sudo bash -s -- --uninstall` |

`status` is the one to reach for first. It shows your site address, whether the
token is set, which printer device was found, and whether the website currently
accepts this Pi — each on its own line, so you can see exactly which link in
the chain is broken.

---

## When something goes wrong

Every failure the agent can have writes one plain-English line to the log
saying what to do about it. `sudo journalctl -u greenway-printer -n 30` shows
the recent ones. The most common:

**"No printer found at /dev/usb/lp0."**
The Pi cannot see the printer at all. Check the USB cable is in both ends, the
printer is switched on, and its light is steady rather than blinking. Then run
`sudo greenway-printer status` again.

**"The printer is plugged in, but ... is not allowed to write to it."**
A permissions problem, not a hardware one. The installer runs the agent as root
specifically to avoid this, so you should never see it — but if you do, the
message includes the exact command to fix it.

**"The website refused this Pi's printer token (401)."**
The token on the Pi does not match the one in the back office. Compare
`sudo greenway-printer status` against `Admin → Equipment → Receipt printer`,
then re-pair:
`sudo greenway-printer pair NEW-TOKEN --site https://YOUR-SITE.com`

**"The website is refusing printer requests until a poll token is set (503)."**
The token is missing on the *website* side. Generate one in the back office.

**"Cannot reach the website."**
The Pi has no internet. Check its network connection. The agent retries
automatically and will catch up on its own — no receipts are lost, they queue
on the website until the Pi comes back.

**Paper feeds but comes out blank.**
The roll is in upside down. Thermal paper only prints on one side. Flip it.

**Receipts print but the text is cut off at the edge.**
Your paper is narrower than the agent assumes. Re-pair with the right width:
`sudo greenway-printer pair YOUR-TOKEN --columns 32`
(48 is standard for 80mm paper; 32 is typical for 58mm.)

**Receipts run together with no gap.**
Your printer has no cutter, or ignores the cut command. That is harmless — tear
them off by hand, or silence the command with
`sudo greenway-printer pair YOUR-TOKEN --no-cut`.

---

## Things that were deliberately designed to protect you

**A receipt is never confirmed before it prints.** The agent writes the bytes
to the printer, waits for them to leave, and only *then* tells the website
"printed". If the power dies mid-receipt, the job is still marked unfinished
and gets offered again a couple of minutes later. The worst case is a duplicate
receipt, which costs a few inches of paper. A lost receipt costs a customer.

**The service never gives up.** systemd normally stops restarting a crashed
service after five quick failures and leaves it dead — silently, which is how
you end up discovering on Monday that nothing printed all weekend. That limit
is switched off for this service. It restarts forever.

**Accented characters and smart quotes are converted before printing.** Cheap
thermal printers have no Unicode. Handed a name like `José` they print garbage.
The agent folds text to plain ASCII first, so `José` prints as `Jose` and a
copy-pasted `—` prints as `-`, rather than as random boxes.

**An absurdly long receipt is refused rather than printed.** If a bug ever
queued an error page instead of a receipt, printing it would run out the whole
roll. Anything wildly larger than a real receipt is rejected and left for
review instead.

**It complains loudly once, then goes quiet.** An overnight internet outage
logs the problem when it starts and again occasionally — it does not write the
same line thousands of times. Unbounded logging is the fastest way to kill a
Pi's SD card.

---

## Proving it still works (for whoever maintains this)

None of this is needed to use the printer. It is here so that a year from now,
somebody changing this code can prove they did not break it.

| What it checks | Command |
|---|---|
| Everything that can run without root | `bash pi-agent/tests/run-all-printer.sh` |
| Everything, including a real install/uninstall | `sudo bash pi-agent/tests/run-all-printer.sh --full` |

That runner covers five stages: the 128 checks the agent carries with it, an
end-to-end run against a real HTTP server and a real device file, two mutation
rounds that deliberately break the code and the manual and demand the tests
notice, and — with `--full` — a genuine systemd install that kills the service
seven times to prove it comes back.

The `--full` stage refuses to run if a real printer install already exists on
the machine, so it cannot clobber a working shop Pi. It talks only to a
throwaway fake website on localhost and needs no printer attached.

---

## If you later buy a printer that does this by itself

Nothing here is wasted. The Pi speaks the same protocol (Star CloudPRNT) that
those printers speak natively. Point a real CloudPRNT printer at
`https://YOUR-SITE.com/api/cloudprnt` with the same token, unplug the Pi, and
everything else — the queue, the test-print button, the diagnostics — keeps
working exactly as it does now.
