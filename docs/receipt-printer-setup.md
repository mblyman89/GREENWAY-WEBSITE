# Receipt Printer — End-to-End Setup & Troubleshooting

This is the complete, plain-language guide for setting up the online-order
receipt printer at Greenway and fixing it when it misbehaves. It is written for
non-technical staff. It is also the knowledge source the on-page AI diagnostic
assistant is grounded on — every fact below is true of our actual integration.

> **What this printer does:** when an online pickup order comes in, the back
> office automatically queues a receipt. The printer checks in with our website
> every few seconds ("polling"), grabs any waiting receipt, prints it, and cuts
> the paper. You can also send a manual **test print** at any time.

---

## 1. The hardware

- **Printer:** Star Micronics **TSP143IV** (this is the model our integration is
  built for — it speaks Star **CloudPRNT** natively).
  - Part **39473010** (gray) or **39473110** (white).
  - Connects by **Ethernet** (recommended) or **USB-C**. Use **Ethernet** for
    the online-order auto-print feature — CloudPRNT needs a network connection.
- **Paper:** 80mm thermal roll (this is the default — 48 print columns). A 58mm
  roll (32 columns) also works if you change the "Paper width" setting.
- **In the box:** printer, power supply, Ethernet cable, one starter paper roll.

You do **not** need any Star cloud subscription, and you do **not** install any
driver on a computer. The printer talks directly to our website.

---

## 2. Physical setup (5 minutes)

1. Place the printer near the pickup counter, within reach of the store router
   or a network wall jack.
2. Plug the **Ethernet cable** from the printer into the router (or wall jack).
3. Plug in the **power supply** and turn the printer on (switch on the side/back).
4. Load the paper roll (flip the lid, drop the roll in so paper feeds off the
   **bottom**, pull a few inches out, close the lid). The printer will feed and
   cut a small strip when the lid closes — that means paper is loaded correctly.
5. Wait ~30 seconds for the printer to get an IP address from the router.

**Find the printer's IP address:** hold the **FEED** button while turning the
printer on (or press the recessed button on the back) to print a
**self-test / configuration slip**. The IP address (e.g. `192.168.1.50`) is on
that slip. Write it down — you'll type it into a browser in the next step.

---

## 3. Point the printer at our website (the important part)

Everything the printer needs is on the **Receipt Printer** settings page in the
back office (Settings ▸ Receipt Printer). Two values matter:

- **Poll URL** — the web address the printer checks for receipts. Shown on that
  page (looks like `https://your-site.com/api/cloudprnt`).
- **Poll token** — a secret password so only *our* printer can pull receipts.
  Shown on that page. If it's blank, click **Generate token** first.

There are two ways to enter these into the printer. Either works.

### Option A — the printer's built-in web page (no software to install)

1. On a computer or phone on the **same network** as the printer, open a web
   browser and go to the printer's IP address (e.g. `http://192.168.1.50`).
2. Log in. Default user is usually `root` and password `public` (change it later).
3. Find **CloudPRNT** in the menu.
4. Turn CloudPRNT **ON / Enabled**.
5. **Server URL:** paste the **Poll URL** from the back-office page exactly,
   including `https://` and the `/api/cloudprnt` at the end.
6. **Poll interval:** `5` seconds is a good default (how often it checks in).
7. **Authentication / Password:** paste the **Poll token** from the back-office
   page. (Our website accepts the token as the CloudPRNT password.)
8. **Save** and let the printer reboot/apply.

### Option B — Star Quick Setup Utility (Star's free app)

1. Install the **Star Quick Setup Utility** (free, on Star's website; iOS,
   Android, Windows, Mac).
2. It auto-discovers the TSP143IV on the network. Select it.
3. Open **CloudPRNT settings** and enter the same **Server URL**, **poll
   interval**, and **password (Poll token)** as in Option A. Save.

---

## 4. Confirm it works

1. Back on the **Receipt Printer** settings page, watch the **Printer status**
   card. Within a poll interval or two it should flip to **Online** and show a
   **Last poll** time and the printer's **MAC** address.
2. Click **Send test print**. A test receipt should print within a few seconds
   (at the printer's next poll). The job appears in **Recent print jobs** and
   moves from *queued* → *printed*.
3. Make sure **Auto-print online orders** is checked (Settings section). From
   then on, every new online pickup order prints automatically.

That's it. Day-to-day, staff do nothing — receipts just print.

---

## 5. How it actually works (for the curious / for diagnostics)

Our website exposes **one** endpoint, `/api/cloudprnt`, that speaks the classic
Star CloudPRNT HTTP protocol:

- The printer **POSTs** its status to that URL every few seconds. We record the
  check-in ("heartbeat" → that's the *Last poll* time) and reply whether a job
  is waiting (`jobReady: true/false`).
- When a job is ready, the printer **GETs** the receipt body (we send it as
  plain text; the printer prints and auto-cuts).
- The printer then **DELETEs** to confirm it printed; we mark the job *printed*.

The **Poll token** is checked on every request (sent as the CloudPRNT password,
or a `?token=` on the URL). If the token doesn't match, we reply **401
Unauthorized** and nothing prints. If no token is configured yet, we allow
requests through so you can do first-time setup.

The endpoint is **public** (not behind the admin login) so the printer can reach
it without a staff account — the token is what protects it.

---

## 6. Troubleshooting (symptom → cause → fix)

**Status never turns "Online" / "Never polled":**
- The printer can't reach our website. Check: Ethernet cable seated, printer
  powered on, printer got an IP (print the self-test slip), and the **Server
  URL** is typed **exactly** (with `https://` and `/api/cloudprnt`, no trailing
  space).
- Store internet/router is down, or a firewall blocks outbound HTTPS. Try
  loading any website from a computer on the same network.
- The **Poll URL** on the page shows `/api/cloudprnt` with no domain: an admin
  needs to set `NEXT_PUBLIC_SITE_URL` to the public site address so the printer
  has a full address to reach.

**Status was Online but now says "Not seen":**
- The printer lost power or network. Re-seat the Ethernet cable and confirm the
  power light. It should come back online within a poll interval.

**Test print says "queued" but never prints:**
- Out of paper or lid open — load paper and firmly close the lid.
- Token mismatch: the printer's CloudPRNT password no longer matches the **Poll
  token** (e.g. the token was rotated). Re-enter the current token in the
  printer, or rotate a new one and enter that.
- Printer is Online (polling) but errors on the job (cover open, cutter jam,
  overheated). Clear the error at the printer; the job retries on the next poll.

**Everything prints twice / duplicates:**
- Usually two devices are polling the same URL/token, or the printer's confirm
  (DELETE) isn't reaching us. Ensure only the one TSP143IV is configured with
  our URL.

**"401 Unauthorized" in the printer's logs:**
- The token the printer is sending doesn't match ours. Copy the current **Poll
  token** from the settings page into the printer's CloudPRNT password field.

**Receipts print but look wrong (cut off / too wide):**
- Paper width mismatch. Set **Paper width** to match your roll: 80mm = 48
  columns (default), 58mm = 32 columns.

**Nothing auto-prints for new orders, but test print works:**
- **Auto-print online orders** is unchecked. Turn it on in the Settings section.

---

## 7. Rotating the token (security)

If you ever suspect the token leaked, click **Rotate token** on the settings
page, then re-enter the new token in the printer's CloudPRNT password field.
Until you update the printer, it will get 401s and stop printing — so rotate,
then immediately update the printer.

---

## 8. What we deliberately do NOT do

- We do **not** require a Star cloud account or subscription — the printer polls
  our own endpoint directly.
- We do **not** print anything containing full customer payment details; the
  receipt is the pickup-order summary.
- We do **not** support multiple printers in this build — there is exactly one
  printer and one settings row by design.
