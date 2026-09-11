# Receipt printer: copy-and-paste quickstart

Every command in this file is meant to be copied and pasted exactly as written,
one at a time, top to bottom. After each one there is a note about what you
should see, so you always know whether to carry on or stop.

Two things you will need to substitute, and they are the **only** two:

| Placeholder | What to put instead |
|---|---|
| `YOUR-TOKEN` | the printer token you copy in Part 1 |
| `YOUR-PASSWORD` | the Pi password you set when you made the SD card |

There are **12 steps** across four parts. Parts 1 and 2 can be done before the
printer even arrives.

---

## Part 1 — On your computer: get the printer token

The Pi cannot print anything until the website has a printer token. Right now
it does not have one. Verified while writing this: the website answers

```
{"error":"printer poll token not configured (set it in Admin → Equipment → Receipt printer)"}
```

So this is genuinely the first job.

### Step 1 — Open the printer page

In your normal web browser, go to:

```
https://greenwaywebsite1.vercel.app/admin/equipment?tab=printer
```

Log in as yourself if it asks. You need an account that can change settings.

> **Why this address and not greenwaymarijuana.com?**
> `greenwaymarijuana.com` is your current live shop. The printer software is
> not deployed there yet, and that domain sits behind a security gateway that
> blocks the printer's requests. Verified: a printer request to the live domain
> comes back as an HTTP 202 CAPTCHA page instead of reaching the printer code.
> Use the `vercel.app` address for now. Part 4 explains the one-line change for
> when you eventually switch the live domain over.

You should land on a page with a **Connection** panel.

### Step 2 — Generate the token

In the **Connection** panel, find the box labelled:

```
POLL TOKEN (PRINTER PASSWORD)
```

Underneath it you will currently see:

```
— not set —
```

Click the button below that box. Because no token exists yet, the button says:

```
Generate token
```

(If it says **Rotate token** instead, a token already exists. Do **not** click
it — clicking it replaces the token and any printer already using the old one
stops working. Just copy the value that is shown.)

**You should see:** the page reloads, the `— not set —` is replaced by a long
string of letters and numbers, and a message appears saying a new poll token
was generated.

### Step 3 — Copy the token somewhere safe

Select that long string and copy it. Paste it into a notes app for a minute —
you will type it into the Pi in Part 3.

It is 36 characters of letters and numbers. It is a password, so do not post it
anywhere public.

**Part 1 is done.** You can close the browser tab for now.

---

## Part 2 — Connect to the Pi

### Step 4 — Open a terminal on your computer

- **Windows:** press the Start button, type `cmd`, press Enter.
  (SSH is built into Windows 10 and 11. You do not need PuTTY.)
- **Mac:** press `Cmd` + `Space`, type `terminal`, press Enter.

### Step 5 — Connect to the Pi

Type this and press Enter:

```bash
ssh greenway-office@greenway-office.local
```

The pattern is `ssh USERNAME@HOSTNAME.local`. Both were set to
`greenway-office` when the SD card was made, so both halves look the same. That
is not a mistake.

If this is the first time connecting from this computer, you will see a warning
about the authenticity of the host. Type `yes` and press Enter.

Then it asks for the password:

```
greenway-office@greenway-office.local's password:
```

Type `YOUR-PASSWORD` and press Enter. **Nothing appears as you type** — no dots,
no stars. That is normal for password prompts; keep typing and press Enter.

**You should see** a prompt that looks like this:

```
greenway-office@greenway-office:~ $
```

That means you are now typing commands **on the Pi**, not on your computer.

| If instead you see | It means | Do this |
|---|---|---|
| `Could not resolve hostname` | your network cannot do `.local` names | find the Pi's IP address on your router and use `ssh greenway-office@192.168.x.x` |
| `Connection refused` | the Pi is still booting | wait two minutes and try again |
| `Permission denied` | wrong password | try again, carefully |

---

## Part 3 — On the Pi: install the printer software

### Step 6 — Go to the repository folder

```bash
cd ~/GREENWAY-WEBSITE
```

**You should see:** no output at all. Silence means success. The prompt changes
to show where you are:

```
greenway-office@greenway-office:~/GREENWAY-WEBSITE $
```

If you get `No such file or directory`, you have not cloned it on this Pi yet.
Run this instead, then repeat Step 6:

```bash
cd ~ && git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git
```

### Step 7 — Download the latest code

```bash
git pull
```

**You should see** a list of files being updated, ending with something like
`12 files changed`. Or, if you are already current, just:

```
Already up to date.
```

**This step is not optional.** Your existing copy was made before the printer
software was finished, which is why `ls` showed only four items and there was
no `install-printer.sh` to run.

### Step 8 — Check the printer files are really there

```bash
ls pi-agent/
```

**You should see exactly this:**

```
greenway_announcer.py  greenway_printer.py  install-printer.sh  install.sh  systemd  tests
```

The two that matter:

| File | What it sets up |
|---|---|
| `install-printer.sh` | the **receipt printer** — this is the one you want |
| `install.sh` | the **announcer**, the speaker that reads orders aloud |

If `install-printer.sh` is missing, Step 7 did not work. Do not continue —
re-run `git pull` and read its output.

### Step 9 — Plug in the printer

Do this now, before installing, so the installer can find it and print a test
page at the end.

1. Plug the printer's **USB cable** into any USB port on the Pi.
2. Plug in the printer's **power supply** and switch it on.
3. **Load the paper the right way round.** Thermal paper only prints on one
   side. The **shiny side must face the print head** — that is, the paper comes
   up off the *top* of the roll, not from underneath. If you get blank paper
   later, this is almost always why.
4. Close the lid until it **clicks**. Not resting closed — clicked.
5. Look at the light: **steady means ready.** A blinking light almost always
   means the paper is out or the lid is not properly shut.

### Step 10 — Run the installer

Now the real thing. Replace `YOUR-TOKEN` with what you copied in Step 3:

```bash
cd ~/GREENWAY-WEBSITE/pi-agent
sudo ./install-printer.sh --site https://greenwaywebsite1.vercel.app --token YOUR-TOKEN
```

It will ask for `YOUR-PASSWORD` again (that is what `sudo` does). Type it and
press Enter.

**You should see** a run of checks, each on its own line:

```
Greenway Receipt Printer - installer

==> Checking this Pi
  OK  Python 3.11 found.
  OK  The 'requests' package is already present.
  OK  The usblp printer driver is available.
==> Installing the printer program
  OK  Using the copy next to this installer.
  OK  The program passed its own self-check.
  OK  Installed to /usr/local/bin/greenway-printer
==> Saving the settings
  OK  Paired with the website.
==> Setting up automatic start
  OK  The printer agent will now start automatically on boot.
  OK  The printer agent is running.
==> Printing a test page
  OK  Test page sent.
```

**A test page should come out of the printer.**

Things it does for you, so you do not have to: installs the missing Python
package if needed, loads the `usblp` printer driver, checks the downloaded
program against its own self-test before installing it, saves your token to a
root-only file, and sets up the service so it starts on every boot.

#### If a message appears instead

| Message | What it means | What to do |
|---|---|---|
| `sudo: ./install-printer.sh: command not found` | confusing wording for "not marked executable" — **not** a missing file | run `sudo bash install-printer.sh --site https://greenwaywebsite1.vercel.app --token YOUR-TOKEN` |
| `'--code' is an ANNOUNCER option` | you ran the wrong script or the wrong flag | the printer uses `--token`, not `--code` |
| `The ':' is missing after 'https'` | a typo in the address | it shows you the corrected address — use that |
| `No printer found at /dev/usb/lp0` | the Pi cannot see the printer | go back to Step 9; check the cable, the power switch, and that the light is steady |
| `the check did not pass` | installed fine, but the website did not accept the token | carry on to Step 11, then re-check the token |

### Step 11 — Ask the Pi how it is doing

```bash
sudo greenway-printer status
```

**You should see** a report like this, and you want the last line to say OK:

```
Agent           : greenway-printer v1.0.0
Config file     : /etc/greenway-printer/config.json
Website         : https://greenwaywebsite1.vercel.app
Printer token   : a1b...9f2  (36 characters)
Printer device  : /dev/usb/lp0
Paper columns   : 48
Auto-cut        : yes

Checking https://greenwaywebsite1.vercel.app/api/cloudprnt ...
  OK - the website accepted this Pi's token.
  No receipts waiting (this is normal).
```

This one command tells you which link in the chain is broken, if any:

| Line | If it is wrong |
|---|---|
| `Website` | wrong address — redo with the `pair` command in Part 4 |
| `Printer token` | says `(not set)` — the token did not save |
| `Printer device` | says `(not found)` — a cable, power or paper-lid problem (Step 9) |
| last line | `503` means no token on the website (Part 1); `401` means the token does not match |

---

## Part 4 — Print a real receipt

### Step 12 — Press the button

Back in your browser, on the same page from Step 1:

```
https://greenwaywebsite1.vercel.app/admin/equipment?tab=printer
```

Find and click:

```
Send test print
```

**Within a few seconds, a receipt should print.** That is not a local test page
— it went through the real queue, the exact path a customer's order takes.

If it printed: **you are finished.** Place a test order on the website to watch
it happen by itself.

While you are on that page, check that **Auto-print online orders** is ticked.
That is what makes every online pickup order print without anyone pressing
anything.

---

## The five commands worth remembering

| What you want | Command |
|---|---|
| Is everything OK? | `sudo greenway-printer status` |
| Print a test page (no website needed) | `sudo greenway-printer test` |
| Is the service running? | `sudo systemctl status greenway-printer` |
| Watch it work, live | `sudo journalctl -u greenway-printer -f` |
| Restart it | `sudo systemctl restart greenway-printer` |

`sudo greenway-printer test` is the most useful one when something is wrong,
because it needs **no website at all**. If the test page prints but real
receipts do not, the printer and cable are fine and the problem is between the
Pi and the website. That splits the problem in half in one command.

To stop watching a live log (`journalctl -f`), press `Ctrl` + `C`.

To leave the Pi and go back to your own computer, type `exit`.

---

## When you switch the live domain over

Once `greenwaymarijuana.com` points at the new site, re-point the Pi with one
command and change nothing else:

```bash
sudo greenway-printer pair YOUR-TOKEN --site https://greenwaymarijuana.com
sudo systemctl restart greenway-printer
sudo greenway-printer status
```

Until that switch happens, the Pi must use the `vercel.app` address.

---

## If the paper comes out blank

The paper is in upside down. Thermal paper prints on one side only. Open the
lid, flip the roll over so the paper feeds off the **top**, and close the lid
until it clicks. Then:

```bash
sudo greenway-printer test
```

## If you have 58mm paper instead of 80mm

The default is set for 80mm paper (48 characters per line). For narrower 58mm
paper:

```bash
sudo greenway-printer pair YOUR-TOKEN --site https://greenwaywebsite1.vercel.app --columns 32
sudo systemctl restart greenway-printer
```

## If you need to remove it completely

```bash
cd ~/GREENWAY-WEBSITE/pi-agent
sudo ./install-printer.sh --uninstall
```

Your token and settings are deliberately kept, so reinstalling later does not
need the token again.
