# The Order Announcer — Field Manual

**For:** whoever is standing in front of the problem right now.
**Reading level required:** none. Follow the steps in order. Do not skip ahead.

This manual is referenced by the installer and by the service file itself, so
it is the one document that must always exist. Every command in it is real and
copy-pasteable. Nothing here is theory.

> **Setting up a brand new Pi for the first time, and never used a terminal?**
> Read `05-first-pi-walkthrough.md` instead. It assumes no knowledge at all and
> covers getting the files onto the Pi. This manual is for fixing a speaker that
> is already installed.

---

## THE 30-SECOND VERSION

Something is quiet. Do these three things, in this order, and stop as soon as
you hear a sound.

| # | Do this | Where |
|---|---------|-------|
| 1 | Press **Test all speakers** | Back office → Orders → Announcer |
| 2 | Turn the speaker off and on at the wall, wait 60 seconds | The room that is quiet |
| 3 | Unplug the Pi's power for 10 seconds, plug it back in, wait 2 minutes | The room that is quiet |

Roughly nine times out of ten it is step 2 — the speaker got switched off, its
volume knob got turned down, or its plug got knocked out. Check the boring
things first. They are boring because they are common.

If all three fail, go to **THE DECISION TREE** below.

---

## PART 1 — WHAT THIS THING ACTUALLY IS

Three pieces. If you understand these three sentences you can fix almost
anything that goes wrong.

1. **The website** puts a job in a list when an online order arrives.
2. **The Raspberry Pi** is a small computer that asks the website "anything for
   me?" over and over, forever.
3. **The speaker** is plugged into the Pi and makes the noise.

The Pi *asks* the website. The website never pushes anything to the Pi. This
matters enormously: **the Pi does not need a fixed address, an open port, or
anything special from your router.** If the Pi can load a webpage, it can hear
about orders. That is the whole design, and it is why this setup is so hard to
break.

**What that means for you:** anything that would break a normal website visit
(internet down, router rebooting, Wi-Fi password changed) will break the
announcer, and *nothing else will*. When the internet comes back, the Pi
reconnects on its own. You do not have to do anything.

### The one-line mental model

> Pi asks website → website says "play the chime" → Pi plays chime → Pi tells
> website "done".

Every problem is one of those four arrows failing. The decision tree below
walks the arrows in order.

---

## PART 2 — THE DECISION TREE

Start at the top. Answer the question. Go where it says. **Do not skip.**

### ▸ Q1. Is it quiet on *every* speaker, or just one?

- **Just one room** → go to **Q2**.
- **Every room** → go to **Q6**.

---

### ▸ Q2. One room is quiet. Is the Pi's power light on?

Look at the Pi itself. There is a small red or green LED.

- **No light at all** → The Pi has no power.
  - Check the power plug at both ends. Push it in firmly.
  - Check the wall socket works by plugging in something else.
  - **The power supply is the #1 hardware failure.** If you have a spare, swap
    it. A Pi 4 needs a proper **USB-C 5V 3A** supply. A phone charger will
    often *look* like it works and then cause random reboots and corruption.
  - Still nothing after a real power supply? The SD card or the board has
    failed. Go to **PART 6 — REBUILDING A PI FROM SCRATCH**.
- **Light is on** → go to **Q3**.

---

### ▸ Q3. The Pi has power. Does the back office show it online?

Back office → Orders → Announcer. Find that speaker's card.

- **Green dot** → The Pi is fine and talking to the website. The problem is
  the *audio*. Go to **Q4**.
- **Grey / red dot, or "Not seen recently"** → The Pi is running but cannot
  reach the website. Go to **Q5**.
- **The speaker is not listed at all** → It was never paired, or it was
  removed. Go to **PART 5 — ADDING A SPEAKER**.

---

### ▸ Q4. Green dot but no sound. This is an audio problem.

Almost always the speaker, not the Pi. Work down this list:

1. **Is the speaker switched on?** Many powered speakers have their own power
   button and their own light.
2. **Is its volume knob up?** Turn it to about halfway.
3. **Is the audio cable seated?** Unplug and firmly re-plug both ends. On a
   Pi 4 it goes in the **3.5 mm jack**, which is the black round socket next
   to the yellow-ish HDMI ports.
4. **Prove the Pi's audio works** — this is the important test. Get to a
   terminal on the Pi (see PART 3) and run:

   ```bash
   greenway-announcer test
   ```

   This plays all six built-in sounds, one after another, **without using the
   internet at all**. You should hear six different tones.

   - **You hear them** → the Pi and speaker are perfect. The problem is a
     setting in the back office: check the speaker is **Enabled**, check its
     **Volume** is not 0, and check **Quiet hours** is not currently on.
   - **You hear nothing** → the audio output is wrong. Run:

     ```bash
     aplay -l
     ```

     That lists the audio devices. Note the card and device numbers, then set
     the right one in `/etc/greenway-announcer/config.json` as `audioDevice`,
     for example `"plughw:1,0"`. Then:

     ```bash
     sudo systemctl restart greenway-announcer
     ```

   - **You hear nothing and `aplay -l` lists nothing** → check `alsamixer`.
     `MM` under a channel means **muted**; highlight it and press `M` to
     unmute, and use the arrow keys to raise the level.

---

### ▸ Q5. Pi is powered but the website says it is offline.

This is a network problem. On the Pi, run:

```bash
greenway-announcer status
```

Read what it prints. It checks the real connection and tells you what failed.

| What it says | What it means | What to do |
|---|---|---|
| `NOT PAIRED. No config at ...` | This Pi was never linked to your site | Go to **PART 5** |
| `FAILED: cannot reach the website` | No internet, or wrong address | Check the shop's internet. Try loading any website on your phone on the same Wi-Fi. |
| A `401` / key error | The pairing was revoked or the device deleted | Remove it in the back office, then re-pair. **PART 5**. |
| `OK. The website answered` | It is actually fine | Wait 60 seconds and refresh the back office. Then go to **Q4**. |

**If the shop's internet is down:** you do not need to do anything to the Pi.
It keeps retrying — after 1, 2, 5, 10, 20, then 30 seconds, forever. The moment
the internet returns, it reconnects by itself.

---

### ▸ Q6. Every speaker is quiet at once.

When *all* of them go silent together, the problem is almost never the Pis —
they don't fail simultaneously. Check, in this order:

1. **Is the Announcer switched on?** Back office → Orders → Announcer →
   settings. There is a master **Enabled** setting.
2. **Is it Quiet hours?** Quiet hours silences everything on purpose. The panel
   says so when it is active.
3. **Is the shop's internet down?** Try any website on the shop Wi-Fi.
4. **Press "Test all speakers".** Test deliberately ignores quiet hours, so if
   Test works but real orders are silent, the announcer is fine and the problem
   is upstream in orders.
5. **Look at the verdict banner** at the top of the Announcer panel. It is one
   sentence and it is written to tell you exactly this.

---

## PART 3 — HOW TO GET TO A TERMINAL ON THE PI

You need this for anything in Q4 or Q5. Two ways.

### Way A — plug in a keyboard and screen (always works)

1. Plug a USB keyboard into the Pi.
2. Plug a monitor into the Pi's HDMI port (on a Pi 4, use the one nearest the
   USB-C power socket).
3. You get a login prompt or a desktop. Open **Terminal**.

### Way B — SSH from another computer (no screen needed)

From any computer on the same network:

```bash
ssh greenway-office@greenway-office.local
```

The form is `ssh USERNAME@HOSTNAME.local`, and **both halves are things you
chose in Raspberry Pi Imager.** They are usually different from each other, so
read this carefully:

- The part **before** the `@` is the **username** you set in Imager.
- The part **after** the `@` is the **hostname** you set in Imager.

If you set both to `greenway-office`, the command above is exactly right and
the repetition is expected — it is not a typo.

> **Older guides say `ssh pi@...` — ignore them.** Raspberry Pi OS has not
> shipped a default `pi` user since 2022. Imager now forces you to create a
> username, so `pi@` will simply be rejected as a wrong password unless you
> deliberately typed `pi` yourself.

If `.local` names don't work on your network, use the Pi's IP address instead
(`ssh greenway-office@192.168.1.42`) — your router's admin page lists connected
devices.

> **Hint:** set this up *before* you need it. Diagnosing a dead Pi is much
> easier when you already know SSH works. Test it on day one.

---

## PART 4 — THE FIVE COMMANDS THAT MATTER

Memorise these. They solve nearly everything.

```bash
greenway-announcer status
```
**"Is it working?"** Prints the version, how it is paired, and actually
contacts the website. Start here. Always.

```bash
greenway-announcer test
```
**"Is the speaker working?"** Plays all six built-in sounds locally. Needs no
internet. This is how you separate an audio problem from a network problem.

```bash
greenway-announcer selftest
```
**"Is the program itself sane?"** Runs its own internal checks. Needs no
internet and no speaker. If this fails, the install is damaged — reinstall.

```bash
sudo systemctl restart greenway-announcer
```
**"Turn it off and on again."** Safe to run any time. Takes about 5 seconds.

```bash
journalctl -u greenway-announcer -f
```
**"Show me what it's doing right now."** Live log. Press `Ctrl+C` to stop
watching. Leave this running and place a test order — you will see it work.

### Two more, occasionally useful

```bash
systemctl status greenway-announcer      # is it running? since when?
sudo systemctl stop greenway-announcer   # silence this one Pi temporarily
```

> **Remember:** if you `stop` it, it stays stopped until you `start` it again
> or reboot the Pi. If you want a speaker off for a while, it is far better to
> switch it off in the back office — then the panel shows it as off *on
> purpose* (grey, not red) and nobody wastes an hour diagnosing it.

---

## PART 5 — ADDING A SPEAKER (OR RE-PAIRING ONE)

### Checklist

- [ ] Pi assembled, SD card in, speaker plugged into the 3.5 mm jack
- [ ] Speaker's own power on, volume knob at halfway
- [ ] Pi connected to the shop's internet (Wi-Fi or cable)
- [ ] Back office → Orders → Announcer → **Add a speaker**
- [ ] Give it the room name — **"Sales floor"**, not "Pi 2"
- [ ] Copy the 8-character code (**it expires in 60 minutes** — if it does,
      just make another, they're free)
- [ ] On the Pi, run the installer:

```bash
curl -fsSL https://YOUR-SITE.com/announcer/install.sh | sudo bash -s -- \
     --site https://YOUR-SITE.com --code ABCD2345
```

- [ ] Watch it print **Step 1 of 7** through **Step 7 of 7**
- [ ] It ends with `================ DONE ================`
- [ ] Back office shows a **green dot** within 30 seconds
- [ ] Press **Test** next to it — you hear a chime
- [ ] **Now the real test:** unplug the Pi's power, plug it back in, wait two
      minutes, and confirm the green dot returns *on its own*

That last step is the one people skip and the one that matters. It proves the
speaker will come back after a power cut without anybody touching it.

### If the installer stops

It checks everything *before* it changes anything, and refuses to continue if
something is wrong. It tells you what. Common ones:

| It says | Fix |
|---|---|
| Not a Raspberry Pi / no systemd | You're on the wrong machine |
| Python too old | Update Raspberry Pi OS, or use a current OS image |
| No internet | Fix the network first, then re-run |
| Pairing failed | Code expired or already used. Make a fresh one. |

**The installer is safe to run twice.** Re-running upgrades the program and
keeps the existing pairing. If it is ever half-finished, just run it again.

### Removing a speaker completely

```bash
sudo ./install.sh --uninstall
```

Then remove it in the back office too, so the panel stops expecting it.

---

## PART 6 — REBUILDING A PI FROM SCRATCH

You need this if the SD card dies. **SD card corruption is the single most
common way a Raspberry Pi fails**, and it is nearly always caused by cutting
power without shutting down. Budget for it: keep a spare card imaged and in a
drawer.

1. Write Raspberry Pi OS (64-bit, Lite is fine) to a new card with **Raspberry
   Pi Imager**. In Imager's settings gear, set the hostname, enable SSH, and
   enter your Wi-Fi details *before* writing. This saves needing a keyboard.
2. Put the card in, power up, wait 2 minutes.
3. Make a fresh pairing code in the back office.
4. Run the installer command from **PART 5**.
5. Delete the old dead entry in the back office so the panel is clean.

Total time: about 15 minutes, most of it waiting.

> **Prevention, in order of how much they help:**
> 1. Use a **high-endurance** microSD card (the kind sold for dashcams). They
>    are built for constant writing and cost only a little more.
> 2. Shut down properly (`sudo shutdown -h now`) instead of yanking power,
>    whenever you have the choice.
> 3. Put the Pi on the same UPS as the till, if you have one.
> 4. The installer already caps the Pi's log storage at 50 MB, so logs can
>    never fill the card. That one is handled for you.

---

## PART 7 — THINGS THAT LOOK BROKEN BUT AREN'T

Save yourself a support call.

**"It won't let me upload my sound."**
WAV or MP3 only, and **5 MB** maximum. An announcement should be a short chime,
not a song. If your file is bigger, trim it to a few seconds and try again —
the upload box tells you exactly which rule it broke.

**"The first play of a new sound is slow."**
Normal. The Pi downloads a newly uploaded sound once, then keeps it forever.
Only the very first play waits.

**"It played the chime instead of my custom sound."**
That is the safety net working. If a custom sound can't be downloaded, the Pi
plays the built-in chime rather than staying silent — **a wrong noise is
infinitely better than no noise.** Check the sound still exists in the library,
then press Test.

**"Two orders came in together and I only heard one."**
Check the log with `journalctl -u greenway-announcer -f`. The Pi remembers
recent jobs so it never announces the same order twice.

**"It went quiet for a few seconds during a busy patch."**
That is the retry backoff. After a hiccup it waits 1, 2, 5, 10, 20, 30 seconds
between attempts so it doesn't hammer a struggling connection. It recovers on
its own.

**"The dot is grey, not red."**
Grey means switched off *on purpose*. Red means broken. That distinction is
deliberate — check the back office before you go looking at hardware.

**"I rebooted the Pi and nothing happened for a minute."**
Normal. A Pi takes 30–90 seconds to boot. Wait two minutes before worrying.

---

## PART 8 — MONTHLY 5-MINUTE CHECK

Put it in the calendar. Five minutes once a month prevents the worst outcome,
which is discovering a dead speaker during your busiest hour.

- [ ] Back office → Orders → Announcer: is every speaker showing **green**?
- [ ] Press **Test all speakers**. Walk the building. Hear each one.
- [ ] Is any speaker's volume knob drifted down?
- [ ] Is any Pi sitting in dust, in a cupboard, or somewhere hot?
- [ ] Are the power supplies still firmly plugged in?
- [ ] Do you still have a spare SD card and a spare power supply in the drawer?

**Write the date on a sticky note on each Pi when you check it.** It takes two
seconds and tells the next person everything.

---

## PART 9 — ESCALATION: WHAT TO WRITE DOWN

If you have to hand this to someone else, collect this first. It turns an hour
of guessing into a five-minute fix.

On the Pi:

```bash
greenway-announcer status
greenway-announcer selftest
systemctl status greenway-announcer
journalctl -u greenway-announcer -n 100 --no-pager
```

Copy all four outputs. Then note:

- Which room is affected, and which rooms are fine
- What the back office panel says (colour of the dot, the verdict sentence)
- When it last worked
- Anything that changed — new router, power cut, Wi-Fi password, moved furniture

**"It doesn't work" is not a report. The four commands above are.**

---

## APPENDIX A — WHERE EVERYTHING LIVES

| Thing | Path |
|---|---|
| The program | `/usr/local/bin/greenway-announcer` |
| Its settings (incl. the device key) | `/etc/greenway-announcer/config.json` |
| Downloaded + built-in sounds | `/var/lib/greenway-announcer/sounds` |
| The service definition | `/etc/systemd/system/greenway-announcer.service` |
| The logs | `journalctl -u greenway-announcer` |

`config.json` is readable only by root, because it holds this speaker's key.
Don't email it or paste it into a chat.

---

## APPENDIX B — WHY IT KEEPS WORKING

Worth knowing, because it explains why you rarely have to do anything.

- **It restarts itself.** If the program crashes, systemd restarts it 5 seconds
  later, forever, with no limit on retries. It will not give up on a Friday and
  stay dead all weekend.
- **It survives reboots.** It is enabled at boot, so a power cut fixes itself.
- **It survives internet outages.** It backs off and retries indefinitely.
- **It never goes fully silent by accident.** Every failure to fetch a custom
  sound falls back to a built-in tone that lives on the Pi itself.
- **It can't fill the disk.** Logs are capped at 50 MB.
- **It can't leak memory into a crash loop.** Memory is capped at 256 MB and
  it only remembers the last 500 jobs.
- **It proves itself.** `selftest` runs dozens of internal checks on the actual
  Pi, with no network, so you can always tell "the program is broken" apart
  from "something around it is broken".

---

## APPENDIX C — THE PANIC BUTTON

Everything is broken, there are customers waiting, and you need noise **now**.

1. Back office → Orders → Announcer → make sure the master switch is **on** and
   **Quiet hours** is off.
2. Press **Test all speakers**.
3. On the nearest working Pi: `sudo systemctl restart greenway-announcer`.
4. Still nothing? **Watch the Orders screen manually** and deal with the
   speakers after close. The announcer is a convenience — orders still arrive,
   are still recorded, and are still correct whether or not anything beeps.

**Nothing about a silent speaker affects an order, a sale, or compliance.**
Take a breath. Fix it later.
