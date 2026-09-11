# Speaker setup — the copy-paste quickstart

**For:** the person sitting at a keyboard with the speaker in front of them,
already connected by SSH to the Raspberry Pi.

**What this gets you:** a speaker that makes a noise every time an online order
comes in, starts itself when the Pi is powered on, and never needs touching
again.

**Time:** about ten minutes, most of it waiting.

This is the hand-held version. Every command is meant to be copied and pasted
whole, and after each one you are told exactly what you should see. If what you
see does not match, the fix is in the table right underneath it.

> **You need two windows open:** the **terminal** connected to the Pi, and a
> **browser** on the back office. You will swap between them twice.

---

## BEFORE YOU START — the one thing that catches everybody

The back office prints a ready-made install command for you, and it will say
`--site https://greenwaymarijuana.com`.

**Do not use that address yet.** `greenwaymarijuana.com` is the live shop site
and it sits behind a security gateway that blocks the Pi. Everything we are
building lives on the development site, so use this address instead:

```
https://greenwaywebsite1.vercel.app
```

Every command below already has the correct address in it. Copy the commands
from **this page**, not from the back office, and you will not hit it.

> If you ever forget and use the live address, the Pi now tells you plainly:
> *"The website answered 202 instead of handling the speaker request. This
> usually means the address points at a domain behind a security gateway or
> CAPTCHA..."* That message means exactly one thing — swap the address for the
> one above and run it again. Nothing is broken.

---

# PART 1 — CHECK THE PI IS READY (2 steps)

## Step 1 — Make sure you are talking to the Pi

You said you are already connected by SSH. Prove it. Paste this:

```bash
whoami && hostname
```

**You should see:**

```
greenway-office
greenway-office
```

If you see something else, you are typing into your own computer instead of the
Pi. Connect to the Pi first:

```bash
ssh greenway-office@greenway-office.local
```

| What you see | What it means | What to do |
|---|---|---|
| `Could not resolve hostname` | The Pi is not answering to that name | Use its IP address instead: `ssh greenway-office@192.168.1.50` |
| `Connection refused` | SSH is not switched on on the Pi | On the Pi's own screen: `sudo raspi-config` → Interface Options → SSH → Yes |
| It asks for a password | Normal, first time | Type the Pi's password. **Nothing appears as you type** — no dots, no stars. That is deliberate. Type it and press Enter. |

## Step 2 — Get the current software onto the Pi

Paste this as one block:

```bash
cd ~/GREENWAY-WEBSITE && git pull && cd pi-agent && ls
```

**You should see** some lines about files being updated, then a list that
includes these four names:

```
greenway_announcer.py
greenway_printer.py
install-printer.sh
install.sh
```

| What you see | What to do |
|---|---|
| `No such file or directory` | The code is not on this Pi yet. Run `cd ~ && git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git` then repeat step 2. |
| `Already up to date.` | Good. That is a success message. Carry on. |
| Local changes would be overwritten | Run `git reset --hard && git pull` and repeat step 2. |

> **Why `git pull` matters:** it is the "give me the newest version" command. The
> exec-bit fix that stopped `install.sh` from running lives in a recent update,
> so skipping this step is how you end up with
> `sudo: ./install.sh: command not found`.

---

# PART 2 — GET A PAIRING CODE (3 steps)

Now switch to your **browser**. Leave the terminal window open and untouched.

## Step 3 — Open the Announcer panel

Go to the back office and open **Orders**.

Scroll down until you see a panel headed:

```
🔊 Order Announcer
```

Next to that heading it tells you how many speakers are working, like
`0 of 0 speakers online`. With no speakers set up yet you will also see:

```
No speakers are set up yet.
```

That is correct. You are about to fix it.

## Step 4 — Name the room

Click **➕ Add a speaker** to expand it. It explains:

> Name the room first, then press the button. You will get an eight-character
> code to type into the Raspberry Pi during setup. The code lasts one hour.

In the **Room name** box, type where the speaker actually **is**:

```
Sales Floor
```

**Name the room, not the hardware.** In six months you will want to know which
*room* went quiet, not which Pi it was. The box holds up to 60 characters.

## Step 5 — Press the button and read the code

Click **Get pairing code**.

A box appears headed **Pairing code for Sales Floor**, with an eight-character
code in large type, like:

```
ABCD-2345
```

**Two things to know about that code:**

1. **Type it without the dash.** `ABCD-2345` on screen is typed `ABCD2345`. The
   dash is only there to make it easier to read aloud.
2. **It lasts 60 minutes.** If it runs out, just press the button again. Codes
   are free and there is no limit.

The box also shows a ready-made command. **Ignore the address in it** — as
explained at the top, it points at the live site. Use the command in step 6.

| What you see | What to do |
|---|---|
| The button does nothing, no code appears | The site is running a version from before this was fixed. Deploy the current `main`. |
| A message about migration `0222_order_announcer.sql` | The database tables are missing. Run that migration in the Supabase SQL editor, refresh, and start at step 3. |

---

# PART 3 — INSTALL IT ON THE PI (2 steps)

Switch back to your **terminal**.

## Step 6 — Run the installer

Copy this whole line, then **replace `ABCD2345` with your real code** before
pressing Enter:

```bash
sudo ./install.sh --site https://greenwaywebsite1.vercel.app --code ABCD2345
```

What each part is doing, because every piece matters:

- `sudo` — "do this as administrator". Installing a background service needs it.
  The Pi may ask for your password again.
- `./install.sh` — run the installer sitting in this folder. The `./` means "the
  one right here" and it is required.
- `--site https://greenwaywebsite1.vercel.app` — which website this speaker
  reports to. **This is the development site, on purpose.**
- `--code ABCD2345` — your pairing code, no dash.

## Step 7 — Watch it work

It takes about two minutes and prints seven steps. It starts with:

```
Greenway Order Announcer - installer
This takes about two minutes. You can leave it running.
```

Then, in order:

```
==> Step 1 of 7: checking this Raspberry Pi
==> Step 2 of 7: installing the pieces it needs
==> Step 3 of 7: installing the announcer program
==> Step 4 of 7: checking the program is healthy
==> Step 5 of 7: connecting this speaker to your website
==> Step 6 of 7: setting it to start automatically, forever
==> Step 7 of 7: making sure it really is running
```

Along the way you will see lines beginning `OK`, including
`Sound tools and Python libraries are ready`, `Built-in self-test passed`,
`This speaker is paired`, `Service installed, enabled at boot, and started`,
`Log size capped at 50MB to protect the SD card`, and finally
`The announcer is running right now`.

**When it finishes you will see:**

```
================ DONE ================

  Your speaker is installed and running.
```

If you got that, the hard part is over. Go to step 8.

### If it stopped instead

Everything the installer does happens **before** it changes anything permanent,
so a failure here has left your Pi exactly as it was. Find your message:

| The message says | What it means | What to do |
|---|---|---|
| `sudo: ./install.sh: command not found` | The file is not marked runnable | You skipped step 2. Run `cd ~/GREENWAY-WEBSITE && git pull` and try again. As a one-off: `sudo bash ./install.sh --site ... --code ...` |
| `'--token' is a RECEIPT PRINTER option, but this is the ANNOUNCER installer` | Wrong flag for this device | The speaker uses `--code`. Use the step 6 command as written. |
| `This needs to run as root.` | No `sudo` | Put `sudo` at the front. |
| `This Pi cannot reach the internet.` | No network | Plug in the cable or connect Wi-Fi, then repeat step 6. |
| `Pairing did not work.` / `We do not recognize this code.` | Code expired, mistyped, or has the dash in it | Make a new code (step 5) and retype it without the dash. **Codes expire after 60 minutes.** |
| `returned HTTP 202, not 200` or anything about a **security gateway / CAPTCHA** | You used the live address | Use `https://greenwaywebsite1.vercel.app` exactly as in step 6. |
| `Python 3.9 or newer is required.` | Pi OS is too old | `sudo apt update && sudo apt full-upgrade`, reboot, repeat step 6. |

---

# PART 4 — PROVE THE SOUND ACTUALLY WORKS (4 steps)

Installed and running is not the same as audible. These four steps are how you
know.

## Step 8 — Make the Pi play all six sounds

This tests the **speaker, the cable and the volume** with no website involved:

```bash
greenway-announcer test
```

**You should see, and hear:**

```
Playing each built-in sound. You should hear six different tones.

  chime  OK
  bell   OK
  ding   OK
  alert  OK
  cash   OK
  voice  OK

All six sounds played. The audio hardware on this Pi is working.
```

**Did you actually hear six tones?**

- **Yes** → go to step 9.
- **It says `OK` but I heard nothing** → the Pi is playing into the wrong
  output. Go to step 8b.
- **It says `FAILED`** → read the four numbered suggestions it prints, then go
  to step 8b.

## Step 8b — Only if you heard nothing: pick the right audio output

First the obvious two, because they are the usual answer: **is the speaker
switched on, and is its volume knob turned up?** A powered speaker with the
knob at zero reports a perfect success and makes no sound.

Then list the outputs the Pi can see:

```bash
aplay -l
```

You will get a list like `card 1: Device [USB Audio Device], device 0:`. Read
off the **card number** and the **device number** — here, card `1`, device `0`,
which is written `plughw:1,0`.

Test that output directly:

```bash
greenway-announcer test --audio-device plughw:1,0
```

Heard it? Then make it permanent by re-running the installer with that output
(no new code needed — it keeps the existing pairing):

```bash
sudo ./install.sh --site https://greenwaywebsite1.vercel.app --audio-device plughw:1,0
```

Still silent? Check nothing is muted:

```bash
alsamixer
```

`MM` under a slider means **muted** — move to it with the arrow keys and press
`M` to unmute, then use the up arrow to raise the level. Press `Esc` to leave.
If the volume slider has an unusual name on your dongle, tell the installer
which one to use by adding `--mixer-control PCM`.

## Step 9 — Ask the Pi whether the website can hear it

```bash
greenway-announcer status
```

**You should see** the version, then details, then:

```
Paired as: Sales Floor
  site:      https://greenwaywebsite1.vercel.app
```

and ending with:

```
Checking the connection to the website ...
  OK. The website answered and this speaker is checked in.
  It should show a green dot on the Orders page right now.
```

| Instead it says | What to do |
|---|---|
| `NOT PAIRED. No config at /etc/greenway-announcer/config.json.` | Pairing never completed. Make a new code (step 5) and repeat step 6. |
| `The website rejected this speaker's key (401).` | Re-pair with a fresh code (steps 5 and 6). |
| `security gateway or CAPTCHA` | The Pi is pointed at the live site. Repeat step 6 with the Vercel address. |
| `cannot reach the website` | Check the Pi's network and the shop's internet. |

## Step 10 — Check the back office agrees

Back to the **browser**. Refresh the **Orders** page.

In the **🔊 Order Announcer** panel you should now see:

```
1 of 1 speaker online
```

and the headline:

```
All 1 speaker online. You will hear the next order.
```

Your room appears as a card with a **green dot**, the label **Online**, and a
line reading `Last heard from just now`.

The Pi checks in when it starts and keeps checking in while it polls, and the
site treats anything heard from in the last **90 seconds** as online. So give it
up to a minute before worrying.

| The card says | What it means | What to do |
|---|---|---|
| **Never connected** | Setup did not finish | Re-run the installer and pair again (steps 5–6) |
| **Not responding** | It was working, has gone quiet | Wait 2 minutes. If it stays, check the Pi's power light and network |
| **Offline** | Out of contact | Unplug the Pi's power for 10 seconds, plug back in, wait 2 minutes |
| **Switched off** | Somebody muted it here | Press **Switch on** on that card |

## Step 11 — Press the button and listen

Click **▶ Test all speakers** at the top of the panel.

**You should hear the chime come out of the speaker in the room.** That is the
whole system working end to end: the website decided to make a noise, the Pi
picked it up, and the speaker played it.

Test deliberately ignores quiet hours, so this works at any time of day.

## Step 12 — Set the volume and the sound, then walk away

On the speaker's card you can set:

- **Name** — the room
- **Volume** — a percentage. `Shop default` follows the shop-wide setting
- **Sound** — which tone this room plays

Under **⚙️ Announcer settings** are the shop-wide controls. Two are worth
knowing now, because both can make a perfectly healthy speaker stay silent:

- **Announce new orders** — *"The master switch for every speaker."* If this is
  off, nothing makes a sound anywhere. The panel says so at the top:
  `Announcements are turned OFF for the whole shop.`
- **Quiet hours** — a window when orders make no sound. The panel warns you when
  you are inside it: `Quiet hours are active right now, so orders will not make
  a sound.` *"Test still works during quiet hours."*

**You are done.** The speaker will start itself whenever the Pi is powered on.
You never need to run any of this again.

---

## THE FIVE COMMANDS WORTH KEEPING

Run these on the Pi over SSH, any time:

```bash
greenway-announcer status                    # is it working? (checks the website too)
greenway-announcer test                      # play every sound through this speaker
greenway-announcer selftest                  # check the program itself
sudo systemctl restart greenway-announcer    # turn it off and on again
journalctl -u greenway-announcer -f          # watch it live (Ctrl+C to stop)
```

`journalctl ... -f` is the one to reach for when a speaker goes quiet and you
want to see what it is doing at that moment. Press **Ctrl+C** to stop watching.

## UPDATING THE PI LATER

The Pi does not update itself. When the software improves:

```bash
ssh greenway-office@greenway-office.local
cd ~/GREENWAY-WEBSITE && git pull && cd pi-agent
sudo ./install.sh --site https://greenwaywebsite1.vercel.app
```

**No `--code` this time.** Without one the installer keeps the existing pairing
and prints `Already paired - keeping the existing setup`. You do not need a new
code to update.

## ADDING A SECOND SPEAKER

Repeat the whole of this page on the second Pi, with **one difference**: give it
its own room name in step 4 (`Back Office`) and its own fresh code. Codes are
single-use. Every speaker plays every order unless you switch it off.

## REMOVING IT

```bash
sudo ./install.sh --uninstall
```

It prints `Removed the service, the program and the cached sounds.` and leaves
your pairing on disk in case you reinstall. To erase that too:
`sudo rm -rf /etc/greenway-announcer`.

---

## WHERE TO GO NEXT

- **A speaker went quiet and I need it fixed now** →
  `docs/announcer/10-field-manual.md`
- **The longer explanation of this same setup** →
  `docs/announcer/05-first-pi-walkthrough.md`
- **Buying another Pi or speaker** → `docs/announcer/20-what-to-buy.md`
- **The one-page card for the wall** → `docs/announcer/30-wall-card.md`
