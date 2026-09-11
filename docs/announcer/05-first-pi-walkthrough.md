# YOUR FIRST RASPBERRY PI — THE HAND-HOLDING VERSION

**Read this if you have never used a terminal.** It assumes you know nothing,
and it does not skip steps. Every command is written out in full so you can
copy it exactly.

You have already done the hard part: you flashed the card with Raspberry Pi
Imager, enabled SSH, and set the hostname, username and password. What is left
is about fifteen minutes of typing.

---

## THE SHORT ANSWER TO YOUR THREE QUESTIONS

You asked three things. Here they are up front, then the detail follows.

**1. "Are the files in my git repo?"**
Yes. Both files the Pi needs are committed and have been for a while:

```
pi-agent/greenway_announcer.py     <- the program that plays the sound
pi-agent/install.sh                <- the installer that sets it all up
```

**2. "Do I git pull to update my files on my laptop?"**
You *can*, and it is a good habit, but **for this job you do not need your
laptop's copy at all.** The Pi downloads the files itself, straight from
GitHub. Your laptop is only the thing you type on.

**3. "How do I get the files onto the Pi?"**
The Pi pulls them down on its own with one `git clone` command. You never
copy files from your laptop to the Pi, and you never use a USB stick. This is
the part most guides make sound complicated. It is one line.

---

## BEFORE YOU START — HAVE THESE READY

| Thing | What yours is |
|---|---|
| Pi username | `greenway-office` |
| Pi hostname | `greenway-office` |
| Pi password | the one you typed into Imager |
| Pi is powered on | card in, speaker plugged into the 3.5 mm jack, on the network |

Give the Pi **two full minutes** after you plug it in before you try to
connect. It is doing first-boot housekeeping and will refuse connections until
it finishes. This is normal.

---

## STEP 1 — OPEN A TERMINAL ON YOUR LAPTOP

You are not installing anything here. You just need a window to type into.

- **Mac:** press `Cmd` + `Space`, type `Terminal`, press `Enter`.
- **Windows:** press the Start button, type `Terminal`, press `Enter`.
  (Windows 10 and 11 both have SSH built in. You do not need PuTTY.)

A window opens with some text and a blinking cursor. That is it. That window
is "the terminal". When this guide says *run* a command, it means: click into
that window, type the line, press `Enter`.

> **The one habit worth building:** commands are case-sensitive and
> space-sensitive. Copy and paste rather than retyping wherever you can.

---

## STEP 2 — LOG INTO THE PI

Run this:

```bash
ssh greenway-office@greenway-office.local
```

**Read that carefully — the word appears twice and that is correct.** The
pattern is `ssh USERNAME@HOSTNAME.local`. You set both to `greenway-office`,
so both slots say `greenway-office`. It is not a typo.

### What you should see

The very first time, it asks something like:

```
The authenticity of host 'greenway-office.local' can't be established.
ED25519 key fingerprint is SHA256:xxxxxxxxxxxxxxxx.
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type `yes` and press `Enter`. You must type the whole word `yes` — `y` alone
will not do. This question appears once, ever.

Then it asks for the password:

```
greenway-office@greenway-office.local's password:
```

Type your password and press `Enter`. **Nothing will appear as you type — no
dots, no stars, no moving cursor.** The terminal is deliberately hiding it.
It *is* registering your keystrokes. Type it and press `Enter`.

You are in when the prompt changes to something like:

```
greenway-office@greenway-office:~ $
```

That means every command you now type runs **on the Pi**, not on your laptop.

### If it does not work

| What you see | What it means | What to do |
|---|---|---|
| `Could not resolve hostname` | Your network can't do `.local` names | See "IP address" below |
| `Connection refused` | Pi still booting, or SSH not enabled | Wait 2 more minutes, retry |
| `Permission denied` | Wrong username or password | Use `greenway-office`, not `pi` |
| Nothing happens for a long time | Pi is not on the network | Check Wi-Fi details in Imager |

**Using an IP address instead.** If `.local` fails, log into your router's
admin page and look for the list of connected devices. Find the one called
`greenway-office` and note its address (something like `192.168.1.42`), then:

```bash
ssh greenway-office@192.168.1.42
```

---

## STEP 3 — GET THE FILES ONTO THE PI

**You are now typing on the Pi.** Everything from here happens there.

Git is already installed on Raspberry Pi OS, so run:

```bash
git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git
```

This downloads the repository into a folder called `GREENWAY-WEBSITE` in the
Pi's home directory. It will print progress lines and take a minute or two.

**It will ask you to log in:**

```
Username for 'https://github.com':
Password for 'https://...':
```

Type your GitHub username. For the password, **your normal GitHub password
will not work** — GitHub stopped accepting those in 2021. You need a *personal
access token*, which is a long password GitHub generates for you:

1. On your laptop, go to **github.com → your picture (top right) → Settings**
2. Scroll to the very bottom: **Developer settings**
3. **Personal access tokens → Tokens (classic) → Generate new token (classic)**
4. Give it a note like `raspberry pi`, tick the **`repo`** box, click
   **Generate token** at the bottom
5. Copy the long string it shows you. **You only see it once.**
6. Paste that into the Pi as the password (right-click usually pastes in a
   terminal; `Cmd`+`V` also works on Mac)

Now move into the folder with the Pi files:

```bash
cd GREENWAY-WEBSITE/pi-agent
```

`cd` means "change directory" — it is how you walk between folders. Check you
are in the right place:

```bash
ls
```

`ls` means "list". You should see:

```
greenway_announcer.py  install.sh  systemd  tests
```

If you see those, the files are on the Pi. **That was the answer to your
question** — no copying from your laptop, the Pi fetched them itself.

---

## STEP 4 — GET A PAIRING CODE FROM THE BACK OFFICE

Leave the terminal window open. Do this bit in your browser.

1. Go to the back office → **Orders**
2. Find the **🔊 Order Announcer** panel
3. Click **➕ Add a speaker** to expand it
4. In **Room name**, type where the speaker actually is — `Sales Floor`,
   `Back Office`. Name the **room**, not the hardware. In six months you will
   want to know which room is silent, not which Pi it was.
5. Click **Get pairing code**

An eight-character code appears in large type, like `ABCD-2345`, along with
how long it lasts and the exact command to run. **The code is good for 60
minutes.** If it runs out, just make another one — they cost nothing and there
is no limit.

> If the button spins and no code appears, you are on a version of the site
> from before this was fixed. Deploy the current `main` and try again.

---

## STEP 5 — RUN THE INSTALLER

Back in the terminal (still in `GREENWAY-WEBSITE/pi-agent`), run this, but
**replace `ABCD2345` with your real code**:

```bash
sudo ./install.sh --site https://greenwaywebsite1.vercel.app --code ABCD2345
```

> **Which address?** Use `https://greenwaywebsite1.vercel.app` — the
> development site — until the live domain is cut over. The back office prints
> `https://greenwaymarijuana.com` in its ready-made command, but that domain
> sits behind a security gateway that blocks the Pi: pairing against it answers
> `202` with a CAPTCHA page instead of connecting. If you use it by mistake,
> the Pi says so plainly and you just re-run this with the address above.

Type the code **without the dash**. `ABCD-2345` on screen is typed `ABCD2345`.

Breaking that line down, because every part matters:

- `sudo` — "do this as administrator". Installing a background service needs
  it. The Pi may ask for your password again.
- `./install.sh` — run the installer in this folder. The `./` means "the one
  right here", and it is required.
- `--site https://greenwaywebsite1.vercel.app` — which website this speaker
  reports to. This is the development site, on purpose; see the note above.
- `--code ABCD2345` — your pairing code.

### What you should see

It narrates itself in seven steps and takes about two minutes:

```
==> Step 1 of 7: checking this Raspberry Pi
  OK  Hardware: Raspberry Pi 4 Model B Rev 1.5
  OK  Python: Python 3.11.2
  OK  Internet connection is working
==> Step 2 of 7: installing the pieces it needs
...
==> Step 7 of 7: making sure it really is running
  OK  The announcer is running right now

================ DONE ================
```

**The installer refuses to do damage.** It checks everything *before* it
changes anything, and if a check fails it stops and tells you the reason in
plain English rather than half-installing. It is also safe to run twice —
running it again upgrades in place and keeps your pairing. If it stops with a
`STOPPED:` message, read that line; it says what to fix.

---

## STEP 6 — PROVE IT ACTUALLY WORKS

Do not trust "DONE". Verify it three ways.

**1. The Pi thinks it is healthy:**

```bash
greenway-announcer status
```

This also checks it can reach the website, so it tests the whole chain.

**2. You can hear it:**

```bash
greenway-announcer test
```

Walk into the room. You should hear the chime. If the Pi says it played but
you hear nothing, the fault is the speaker, the cable or the volume — not the
software. Check the 3.5 mm plug is pushed fully in and the speaker is powered
and turned up.

**3. The back office sees it:** refresh Orders. Within 30 seconds the speaker
appears with a **green dot**. Press **Test** next to it — that proves the path
that actually matters, website to speaker, which is the one a real order uses.

### The test everybody skips

**Pull the power out, plug it back in, wait two minutes, confirm the green dot
comes back on its own.** If it does not come back automatically, you have
learned that now, in a quiet moment — instead of after a power cut on a
Saturday. Do this one.

---

## STEP 7 — YOU ARE DONE. LOG OUT.

```bash
exit
```

That closes the connection to the Pi and returns you to your laptop's own
prompt. The Pi keeps running the announcer on its own, starts it again at every
boot, and needs nothing further from you.

---

## THE ONLY FIVE COMMANDS WORTH REMEMBERING

Log in with `ssh greenway-office@greenway-office.local` first, then:

| Command | What it does |
|---|---|
| `greenway-announcer status` | Is it working? Checks the website too. |
| `greenway-announcer test` | Play every sound through this speaker. |
| `greenway-announcer selftest` | Check the program itself. No network needed. |
| `sudo systemctl restart greenway-announcer` | Turn it off and on again. |
| `journalctl -u greenway-announcer -f` | Watch it live. Press `Ctrl`+`C` to stop. |

Fixing a silent speaker is covered in `10-field-manual.md`, PART 4.

---

## UPDATING THE PI LATER

When the announcer program is improved, the Pi does not update itself. To pick
up changes:

```bash
ssh greenway-office@greenway-office.local
cd GREENWAY-WEBSITE
git pull
cd pi-agent
sudo ./install.sh --site https://greenwaywebsite1.vercel.app
```

`git pull` is the "update my files" command you were asking about — you just
run it **on the Pi** rather than on your laptop. Note there is **no `--code`**
this time: it keeps the existing pairing, so you do not need a new code to
update.

---

## ADDING THE SECOND AND THIRD SPEAKER

Exactly the same process, with one change: **each Pi needs its own pairing
code and its own room name.** Do not reuse a code — each is single-use.

Give each Pi a different hostname in Imager (`greenway-sales`,
`greenway-back`) so you can tell them apart over SSH. Get the first one fully
working end to end before you start the second; you will be much faster the
second time.

---

## WORDS THIS GUIDE USED

| Word | What it means |
|---|---|
| **Terminal** | The window you type commands into. |
| **SSH** | Typing commands on another computer over the network. |
| **Prompt** | The `$` where you type. Its text tells you which machine you are on. |
| **`cd`** | Change directory — walk into a folder. |
| **`ls`** | List — show what is in this folder. |
| **`sudo`** | Do this as administrator. |
| **git clone** | Download a copy of the code repository. |
| **git pull** | Update an existing copy to the latest version. |
| **Repository / repo** | The project folder that git keeps the history of. |
| **systemd service** | A program the Pi keeps running and restarts at boot. |
| **Pairing code** | A one-hour, single-use password linking one speaker to the site. |
