# SLICE 12 — Socket Mobile scanning, and migration 0220

**Branch:** `slice-12-socket-scanner`
**Owner instruction, verbatim:**

> "Yes please fold in the migration for me to run, I like to be thorough and all
> inclusive. … Please begin the slice that finishes these two components off. I
> am excited to test the scanner to see how well it performs now. Please follow
> the standing rules and never guess, never assume. Go above and beyond for me
> as you have been doing. Test everything you can including the tests."

Two components, finished: the 18F migration, and the scanner.

---

## 1. Migration 0220 — proven by execution, not by reading

`supabase/migrations/0220_classification_memory_provenance.sql` rewrites exactly
one column comment on
`catalog_product_drafts.chosen_classification_provenance`. No data, no
structure, no constraint.

**Why it was needed.** 0218 documented a three-value vocabulary. 18F added a
fourth, `remembered`. The column is `jsonb` with no check constraint, so the new
value was accepted immediately and nothing broke — which is precisely the
danger. The comment silently became a list a reader would reasonably trust as
exhaustive, and `remembered` would look like corruption to anyone auditing the
table against it. Nothing executable depended on the stale comment, and that is
exactly why it needed fixing deliberately rather than "next time we touch this
file": a wrong comment fails silently and only ever misleads a human.

**How it was verified.** Reading SQL is not running SQL, so:

1. Created a fresh database and replicated CI's Supabase bootstrap — extracted
   **programmatically from `.github/workflows/compliance-tests.yml`** rather than
   retyped, so it cannot drift from what CI actually does.
2. Ran the real verifier: **all 220 migrations applied in order**, and 0220
   **re-applied cleanly**, which is the property that matters because Michael
   applies these by hand and a hand can slip.
3. Read the comment back **out of the live database** and confirmed all four
   vocabulary values are present. A file can run cleanly and still not say what
   was intended.
4. Repeated the whole thing from a second fresh database at the end of the
   slice.

An earlier run failed at `0001` with `schema "auth" does not exist`. That was
not hand-waved: the cause was found in the CI workflow (lines 100–140), which
bootstraps a Supabase shim before running the verifier. The first attempt also
left two enum types behind, so the database was dropped and rebuilt rather than
reused — a dirty database would have made the pass meaningless.

**The sync guard.** Six new tests in `classification-memory.test.ts` derive the
expected vocabulary **from `CLASSIFICATION_MEMORY_PROVENANCE`** and the expected
recallability **by calling `recallClassification` itself**, so adding a fifth
value or changing which values may be replayed turns them red. They assert on
the quoted comment **body** — the prose that actually reaches the column — not
on the explanatory header, which would have been the vacuity trap.

---

## 2. The scanner

### The measured problem

The D760 in keyboard-wedge (HID) mode **types** the barcode one keystroke at a
time over Bluetooth. A driver's licence PDF417 carries 300–1,100 characters, so
one ID scan takes ~10 seconds and can stall mid-stream.

Slice 10 already fixed everything fixable on our side: ID capture finalizes the
instant the payload is provably gate-ready rather than waiting on a fixed timer.
**The remaining ten seconds are the transport, not our timers.** Application
Mode replaces the spelling with a single delivered message.

### The hazard, and why the obvious defence fails

With the SDK connected the scanner is no longer a keyboard, but the wedge
listener is still bound — a host that keeps HID alive would deliver one physical
scan down **both** channels.

"Ignore a payload we just saw" **does not work here**, and this is the single
most important design fact in the slice. Dedupe by time assumes the copies
arrive close together. They do not: the SDK copy lands in milliseconds, the
wedge copy finishes spelling itself out ten seconds later. A window wide enough
to catch the straggler (>10 s) would also swallow a cashier legitimately
scanning the same item twice — an ordinary thing at a register.

So arbitration is by **channel ownership**: while a Socket device is connected,
the SDK owns scanning and wedge input is refused outright. Time-based
suppression is kept only for its real job — one channel repeating itself because
the trigger was held down — which lets that window stay small enough (1,200 ms)
that two identical items still ring up.

`connectedDevices` is a **count, not a flag**: with two scanners paired,
unplugging a spare must not re-enable the wedge next to a live SDK scanner.
Removal clamps at zero so a late callback cannot leave the count owing an
arrival.

### Ownership is read at event time

The wedge listeners bind once per `mode`. A listener closing over a boolean
captured at bind time would consult a **stale** value, so a scanner connecting
afterwards would never actually silence the wedge — reproducing the exact bug
the slice exists to prevent. Ownership is therefore read through a ref
dereferenced inside the handler; the state copy exists only for rendering.

### What was reused, not rebuilt

`id-scan-core.ts` (AAMVA parser) and `scan-to-cart-core.ts` (barcode resolver)
are symbology-agnostic and untouched. Routing keys on **format, not parse
success**: a damaged licence is still a licence, and routing it to the product
path would tell the cashier a customer's ID "matched nothing on the menu".

The payload is handed back **byte-for-byte** — the AAMVA parser splits on
LF/CR/RS (`\x1e`), so a helpful `.trim()` would break every ID scan. That exact
mutant is in the harness.

### Info.plist

Four keys added, one reworded. Every one fails **silently** on device, which is
why each now has a test. `com.socketmobile.chs` was **appended** to the
accessory protocols array — overwriting it would have broken receipt printing.
Verified with a real plist parser: 3 keys added, **0 removed**.

---

## 3. Testing

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| Full vitest | **556 files, 14,096 tests, 0 failures** (baseline 554 / 14,051) |
| Pure self-tests | all pass, incl. 28 socket assertions |
| Migration execution | 220 applied in order; 0220 idempotent |
| **Mutation run** | **27 killed, 0 survived, control survived, byte-identical restore** |

### The mutation run earned its keep

Run 1: **23 killed, 4 survived.** Three were genuine gaps in my own tests:

- **repeat suppression ignoring the channel** — I never scanned the same payload
  from two channels inside the window. The concrete failure that hides: a
  scanner drops mid-shift, the cashier re-scans the in-flight item on the wedge,
  and the register does nothing at the exact moment the fallback should save the
  sale.
- **`appID` losing its `ios:` prefix** and **the `PluginHeaders` check being
  dropped** — the bridge had no tests at all. The second is the Slice 10 printer
  bug re-introduced, and its symptom here is quieter: the register believes
  scanning is available, stands the wedge down, and scans nothing.

The fourth survivor was **not** a gap. `if (raw.trim().length === 0)` → `if
(false)` is **equivalent**: the length check refuses empty input two lines
later. I proved this by exhaustively probing both variants across every
combination of blank, whitespace and printable characters up to length four —
zero differences — rather than assuming it. An equivalent mutant cannot be
killed by any test, and writing one that appeared to would mean asserting on the
shape of the code. It was replaced with a mutant that does change behaviour.

Run 2: **27 killed, 0 survived.** The control (comment-only) correctly survived,
proving the tests assert on behaviour rather than matching words.

### A pre-existing guard went red, correctly

`migration-execution-gate.test.ts` pins the last migration filename as a
deliberate ritual: each slice must **re-run** the verification commands and
record fresh results. Adding 0220 turned it red exactly as designed. I re-ran
all four commands (`wc -l` → 220, bad names → 0, `sort -c` → clean, duplicate
numbers → 0, raw dir → 221 because of the pre-existing `editor-safe`
directory) and recorded the measured values with 0220's rationale, rather than
editing a number to make a test pass.

---

## 4. Not tested here, stated plainly

**`SocketScannerPlugin.swift` has not been compiled.** No Swift toolchain and no
Xcode in this environment — the same disclosure Slice 10 made, for the same
reason. It uses only calls verified against Socket's official CaptureHelper
reference, listed in the file header.

**No scanner was present.** All timing, pairing and Application Mode behaviour
comes from Socket's documentation and the measured behaviour of the current
setup. The first true proof is the first scan on the counter.

**`next build` was not run locally.** The sandbox has 3.9 GB RAM and no swap;
`next build` OOMs (kernel-confirmed in the prior slice). CI's `build` job runs
it on a 16 GB runner, which is the honest place for that proof.

**Three owner actions cannot be automated:** adding the SPM package, re-pairing
in Application Mode via the Companion app (the most likely first-test failure),
and Socket whitelist registration before App Store submission. All are in
`docs/MICHAEL-slice12-socket-scanner.md`.
