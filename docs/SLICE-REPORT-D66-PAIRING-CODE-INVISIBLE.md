# D-66 / D-67 — "Get pairing code" spun forever, and the installer it pointed at did not exist

**Reported:** "the get speaker code in the back office does not produce a code,
it just spins forever until the 5 minutes are up and then it stops. there may
be something wrong there."

**Answer: three real defects, all of which would have blocked the Pi setup you
are doing right now.** Two of them were found while verifying the first.

---

## 1. What was actually wrong

The button was **not** hanging. That is the important part, because "it spins
forever" naturally reads as a timeout or a database that will not answer, and
that would have sent me hunting in the wrong place.

The code was being created correctly the whole time. Traced end to end:

| Step | File | Behaviour |
|---|---|---|
| 1. Button submits | `AnnouncerPanel.tsx` | Calls the server action |
| 2. Action runs | `announcer-actions.ts:187` | Calls `createPairing`, audits, revalidates |
| 3. Code minted | `announcer-store.ts:163` | **Works.** Returns `{ ok, code, deviceName, expiresAt }` |
| 4. Action returns | `announcer-actions.ts` | **Discards `result.code`.** Returns `void` |
| 5. Page re-renders | `AnnouncerPanel.tsx` | Renders nothing new, because nothing read the code back |

So a valid code was written to `announcer_pairings` on every press, and then
thrown away. `grep` across the repo confirmed the root cause with no ambiguity:
**no code anywhere read that table back.** There was no `listPairings`, no
`pendingPairing`, no `latestPairing` — the write path existed and the read path
had never been built.

The "spinning" was React's pending state on a form whose action completed but
produced no visible change. Every press since this feature shipped has been
minting a real, usable, invisible code.

---

## 2. The fix

**A pure function decides what is worth showing** (`announcer-admin-core.ts`),
so the rule is testable without a database:

```ts
export function pendingPairings(
  rows: readonly PendingPairingRow[],
  nowIso: string,
): PendingPairingView[]
```

Deliberate choices, each with a reason:

- **Consumed and expired codes are dropped, not greyed out.** A dead code on
  screen is worse than no code, because somebody will type it, get a refusal,
  and start diagnosing a fault that does not exist.
- **Newest first.** If two codes are live, the one just created is the one being
  read aloud.
- **Minutes round UP, clamped to a minimum of 1.** A code with 30 seconds left
  says "expires in about a minute", never "expires in 0 minutes" — which would
  read as dead while it still works.
- **Expiry is judged by the existing `pairingCodeValidity`,** not re-implemented
  in a SQL `where` clause, so there is exactly one definition of "expired".

**The store reads it back** (`announcer-admin-store.ts`), degrading to an empty
list on any error like every other reader on that page — a broken pairings table
must not take the Orders screen down with it.

**The panel prints it** (`AnnouncerPanel.tsx`): the code in large monospace with
the `XXXX-XXXX` grouping for reading aloud, how long it lasts, and the exact
install command with the code already substituted in.

---

## 3. Two more defects found while verifying this one

### D-67 — the documented install command would have 404'd

`pi-agent/install.sh` downloads the agent from
`${SITE}/announcer/greenway_announcer.py`, and the field manual tells you to
`curl` the installer from `${SITE}/announcer/install.sh`. In Next.js those
resolve to `public/announcer/`.

**`public/announcer/` did not exist.** Both documented URLs would have returned
404 on a real Pi. Fixed by serving both files from `public/announcer/`, with a
test asserting they stay **byte-identical** to the `pi-agent/` originals —
because two copies of a file is a defect waiting to happen, and the failure mode
(a Pi quietly installing a stale agent while the repo looks correct) is nasty.

### The install command printed a placeholder hostname

The first version of my own fix rendered:

```
sudo ./install.sh --site https://YOUR-SITE.com --code ABCD2345
```

That is a command written specifically to be copied onto a Pi. A placeholder
host there does not fail at the keyboard where you would notice — it fails as a
DNS error several minutes into an install, which reads like the Pi is broken.
Now resolved from `NEXT_PUBLIC_SITE_URL`, mirroring the pattern already used by
`src/app/admin/plaid/actions.ts` so the two cannot disagree.

### The SSH command in the docs named a user that no longer exists

`10-field-manual.md` and `20-what-to-buy.md` both said `ssh pi@greenway-office.local`.
**Raspberry Pi OS has not shipped a default `pi` user since 2022** — Imager now
forces you to create a username. That command fails with `Permission denied`,
which looks like a wrong password rather than a wrong username, and it would
have blocked step one of the setup. Both docs corrected to
`ssh USERNAME@HOSTNAME.local` with an explicit note that the old guides are wrong.

---

## 4. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `eslint .` | **0 errors, 15 warnings** — baseline-identical, none in any touched file |
| Full suite | **606 files, 15,569 tests, all passing** (was 15,555) |
| Pure self-tests | all passed, including the new `pendingPairings` assertions |
| Mutation harness | **14/14 killed, 0 survivors**, 1 documented equivalent |

### The mutation run caught two of my own bad tests

This is the part worth recording, because the first run scored **12/15** and one
of the survivors was the original defect itself.

**M1 survived — my store test was decorative.** It asserted only that the word
`pendingPairings` appeared somewhere in the file. When I mutated the live path
back to a hardcoded `pendingPairings: []` — *the exact bug I was fixing* — the
string was still present and the test still passed. A test that cannot fail when
the bug returns is not a test. Rewritten to assert the actual wiring
(`pendingPairings: await getPendingPairings(`), that `computePendingPairings` is
called, and that only **one** `pendingPairings: []` exists (the legitimate
not-installed fallback).

**M11 survived — I never tested the boundary.** Removing the `Math.max(1, ...)`
clamp changed nothing, because my "nearly expired" case sat at 59.67 minutes and
rounded to 1 on its own. `pairingCodeValidity` expires a code when age is
*greater than* the TTL, so at **exactly** 60 minutes a code is still valid and
`ceil(60 - 60) = 0` — a working code rendering as "expires in 0 minutes". Added
the exact-boundary case, which is the only thing the clamp exists for.

**M14 is a genuine equivalent mutant and is documented as such rather than
chased.** Removing the `!Number.isFinite(now)` guard is unobservable: with a
garbage `nowIso`, `pairingCodeValidity` independently parses it to `NaN`, marks
every row invalid, and the function returns `[]` regardless. The guard stays as a
cheap early exit and as a statement of intent. I could have "killed" it with a
source grep, but that tests the text of the code rather than what the code does,
so I did not.

Final score after fixing my tests: **14/14, no survivors.**

---

## 5. What this means at the keyboard

Press **Get pairing code** and the code appears immediately, in large type, with
the ready-to-paste install command underneath. It disappears once used or once
the hour is up. Making another is free and unlimited.

The beginner walkthrough for the Pi itself — including the answer to "are the
files in my git repo" (yes, `pi-agent/`, and the Pi fetches them itself with
`git clone`) — is `docs/announcer/05-first-pi-walkthrough.md`.
