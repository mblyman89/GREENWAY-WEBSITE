# The printer picker — the gap from SLICE 10 is now closed

Michael — this is the small slice you asked for. At the end of the last one I
told you there was no screen for choosing a printer, and that until it existed
the app would keep bouncing to PassPRNT. That screen now exists.

While building it I found **four bugs**. Two of them were mine, from SLICE 10,
and both would have broken printing in the store without ever showing you an
error. I want to be straight about those, so they are Part 4 and Part 5 below.

---

# Part 1 — The short version

**On the iPad:** open the register, tap **MORE ▾** at the top, then
**🖨 Receipt printer**. Tap **Search for printers**, tap your printer in the
list, then tap **Test print**. A slip comes out that says PRINTER TEST. Done.

That is the whole job. Everything below is context and honesty.

---

# Part 2 — Why the pairing is done on the iPad and not on the equipment page

You asked a very reasonable question: the printer lives on the equipment page in
the admin menu, so shouldn't the connection settings be there too, attached to
it?

I looked, and you were right that the printer belongs there — I will come back
to that in Part 3, because I found it was actually **missing** from that page.
But the *pairing* itself genuinely cannot live there, and I want to explain why
rather than just tell you.

Bluetooth only works between two devices that are physically near each other.
The scanning has to be done by the radio that will do the printing. When you
open the equipment page, that page is running in a browser **on your MacBook**.
Your MacBook cannot see a printer that is sitting on the shop counter, and even
if it could, pairing it to your laptop would not help the iPad print.

So I could have put a "Connect printer" button on the equipment page, and it
would have looked complete and reassuring — and it could never have worked. I
would rather have the screen tell you the truth about where the job gets done.

**What I did instead, so it still all lives in one place:**

- The equipment page now **shows** the counter printer, with its model and
  serial, alongside your other hardware.
- Its card says the pairing is done on each iPad, at
  **MORE ▸ Receipt printer**, and links to the register devices page.
- The pairing itself happens on the iPad, where the Bluetooth radio actually is.

One more thing worth knowing: the pairing is **per iPad**, on purpose. Each till
remembers its own printer. This is not a technical convenience — it is a cash
control. If the setting were shared, till 2 could pop till 1's cash drawer.

---

# Part 3 — Your counter printer was missing from the equipment page

You said "I think that's where the printer lives currently right?" — so I went
and checked instead of assuming.

Here is what I found. There are **two** receipt printers in the system, and they
are different machines doing different jobs:

| | Counter printer | Online-orders printer |
|---|---|---|
| Asset tag | `PRN-COUNTER-01` | `PRN-RECEIPT-01` |
| Model | TSP143IIIBi | TSP143**IV** (CloudPRNT) |
| Connection | Bluetooth, to the iPad | Ethernet, to the server |
| What it prints | Register sales, and kicks the cash drawer | Website pickup orders, automatically |

The printer settings panel already on the equipment page is for the **online
orders** one. That is the CloudPRNT machine, and I left it completely alone.

Your **counter** printer had been added to the database back in migration
`0120`, with the model and serial read off the sticker — so it existed — but it
was never added to the list the equipment page actually draws from. So it never
appeared on the page. That was a real gap, and it is fixed: it now shows up in
Integrated hardware with the model and manufacturer copied straight from the
database record, not retyped from memory.

---

# Part 4 — Bug one: the app would have rejected your printer

This is the one that bothers me most, because tests did not catch it. The test
believed the same wrong thing the code did.

In SLICE 10 I made the app check that the printer's ID looked like a
MAC address — the `00:11:62:...` style. I got that from Star's own manual.

The problem: that example in the manual is for printers on a **network cable**.
For **Bluetooth** printers, which is what yours is, Star does not use a MAC
address at all. It uses the printer's **name** — often just `Star Micronics`,
and something you can change yourself in Star's setup utility.

So the app would have scanned, found your printer, and refused it as invalid.
Every time. There would have been no useful error, and the register would have
carried on bouncing you to PassPRNT while looking like it was trying.

I only caught this by going back to Star's API reference and their sample app,
which prints the ID exactly as-is and never inspects it. The app now does the
same: it treats the ID as an opaque label and does not try to be clever about
its shape.

---

# Part 5 — Bug two: the printer choice was never actually being saved

The register has a rule I built earlier: every saved setting must be declared in
one central list, with a note on how bad it is to lose. Anything not on that
list gets **refused**.

I forgot to add the printer setting to that list.

The effect: the app would have saved your choice, told you it was paired, and
thrown the value away. Restart the app and the printer would be forgotten. You
would have discovered this mid-sale, with a customer waiting, when the receipt
went to PassPRNT again.

I proved this rather than assumed it — I ran the old SLICE 10 code against its
own setting name and watched it get rejected:

```
writeDurable: false
rejected: "...is not a registered register storage key"
```

Now registered, and there is a test that fails loudly if it ever drops off that
list again.

One useful side effect: because the old name never saved anything, **no iPad can
have a leftover value under it**. So renaming it to fit the naming rule was
completely safe — nothing to migrate.

*(There were two smaller bugs too, both mine, both from this slice: my new tests
were wired up in a way that meant failures would have been silently ignored, and
the equipment page would have shown your Bluetooth printer as permanently
"offline" because it was reading the other printer's heartbeat. Both fixed.)*

---

# Part 6 — What the screen does

**Search for printers** — scans for six seconds. Six is long enough for a
powered-on printer in range to answer, and short enough that you don't think the
app has frozen.

**The list** — your registered printer is put first and marked with a ✓, matched
against the serial on the equipment record. Under each one is a plain-English
line describing it.

If more than one printer answers and **none** of them match the equipment
record, the screen says so directly, and warns that picking the wrong one will
pop the wrong cash drawer. If a printer does not match, I still let you pick it
— it just warns you. A printer replaced under warranty would have a new serial,
and refusing would leave the store unable to print at all. A warning is right;
a locked door is not.

**Test print** — prints a slip that says **PRINTER TEST** and **"It is NOT a
sale"**, names the till and the printer, and carries no dollar amount anywhere.
That is deliberate: a test slip found in a drawer during an audit should never be
mistakable for a receipt. It also **cannot** open the cash drawer — that is
enforced in code, not just left off, because you might run a test ten times
during setup and none of them should be exposing cash.

**Forget this printer** — clears the app's choice so you can pick a different
one. It does *not* unpair the printer in iPadOS Settings; you paired that
yourself and it is not the app's business to undo it quietly.

**It works with no internet.** The pairing is Bluetooth and lives on the iPad.
Needing a connection to fix your printing would be backwards.

And unchanged from before: **a cash sale is never blocked by a printer.** If
printing fails, the sale still completes and you can reprint from
**MORE ▸ Reprint last receipt**.

---

# Part 7 — What to expect when you test

You are mid-way through the iPad build steps from the last doc, so:

- Until the app is built and installed on the iPad **with the native plugin
  compiled in**, this screen will honestly tell you so. It says printer setup
  only works inside the installed app, because a laptop browser has no
  Bluetooth to search with. That message is correct, not a failure.
- Once the app is on the iPad, pair the printer in **iPadOS Settings ▸
  Bluetooth** first, exactly as in the last doc. Then use this screen.
- If the scan finds nothing: check the printer is powered on, has paper, and is
  paired in iPadOS Settings. Then scan again.

---

# Part 8 — Still outstanding, and still true

The Swift plugin has **never been compiled**. There is no Xcode or Swift
toolchain in my environment, so I have reviewed that file line by line against
Star's documentation but I have not built it. The first real compile happens on
your MacBook. If it throws errors, send them to me and I will fix them.

That was true at the end of SLICE 10 and it is still true. I would rather repeat
it than let it quietly become an assumption.

---

## Verified before merge

- TypeScript: **0 errors**
- Lint: **0 problems**
- All pure self-tests pass — 88 printing, 52 pairing, 100 storage
- **524 test files, 13,327 tests, all passing** (up from 523 / 13,291 — 36 new
  tests, no regressions)

Shipped as PR #1057, merged to `main`.
