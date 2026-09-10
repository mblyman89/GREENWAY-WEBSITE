# Slice report — the register's transaction history search

**Your report:** *"On the register, when I open transaction history, I am unable to use the search bar. I tried typing in it and pressing enter, that did not do anything. I also tried scanning a receipt, that also did not do anything."*

You described two symptoms. Recon found **four separate defects** behind them. All four are fixed, and every one is pinned by a test that I then deliberately tried to break.

---

## What was actually wrong

### Defect 1 — nothing was listening for the Enter key

The receipt box had a handler for typing characters but **no handler for Enter at all**, and there is no surrounding form doing an implicit submit. So the characters you typed landed in the box correctly, you pressed Enter, and the software simply had no instruction for what to do next. Only the "Find" button worked. Pressing Enter was not slow or broken — literally nothing was wired to it.

### Defect 2 — that same missing handler is why scanning failed

This is the part worth understanding, because your scanner was never broken. A hardware receipt scanner is what is called a *keyboard wedge*: it does not send data over a special channel. It pretends to be a keyboard, types the characters very fast, and then presses **Enter**. That trailing Enter is the entire "I am finished, go look it up" signal.

So the scan worked perfectly. The digits arrived. Then the scanner pressed Enter, and — exactly as in Defect 1 — nothing was listening. At the counter this looks identical to "the scanner is dead," which is why it is such a nasty defect to diagnose from the symptom.

I also checked whether anything else might have caught it. The register has two document-wide scanner listeners in the sale flow, but both deliberately stand down whenever your cursor is inside a text box — which is correct, otherwise you could not type normally. So nothing could have rescued it. The modal had to handle its own Enter, and now it does.

### Defect 3 — the search could not see past the third item on a sale

Each row in the history shows the first three products as a preview, so the row stays readable on a counter screen. That is a sensible display choice. The problem was that the **search was reading that same truncated preview**.

On a seven-item basket, items four through seven did not exist as far as the search box was concerned. Typing the name of a product that was genuinely on the receipt returned "Nothing matches." Display and search are different jobs, and they were sharing one list. They now have separate fields: the row still shows three, the search sees all of them.

### Defect 4 — the search only ever covered about half a day

This was the most consequential one. The search box was not searching your database at all. The register fetched the newest fifty sales, and then filtered **those fifty rows inside the browser**.

At your volume, fifty sales is roughly half a day. So a customer who came in yesterday with a sale that is still perfectly returnable would produce a confident "Nothing matches" — and the staff member would have no way to know the software had only looked at a fraction of the window. That is the worst category of bug: not a crash, not an error, but a wrong answer delivered confidently.

The query now goes to the server, which scans the whole seventeen-day window and returns the newest fifty **matches**. The order of operations is the entire fix: it filters first, then caps. Previously it capped first, then filtered.

### Defect 4b — and now it admits when it stopped early

There is still a safety ceiling on how many records get scanned at once, because there has to be one. The difference is that when that ceiling is reached, the panel now **says so** and tells you to use the receipt number instead. "We stopped looking" and "there is nothing there" must never look the same to a person standing at a counter.

---

## What else I fixed while I was in there

**Typing is debounced.** Search now hits the database, so without this every single keystroke would be a separate query. It waits 250 milliseconds after you stop typing — below the threshold where a person notices a delay, but enough that typing a customer's name is one query instead of nine.

**Out-of-order results cannot win.** If you type "kush", the responses for "ku", "kus" and "kush" are all in flight at once, and they do not necessarily come back in order. Without a guard, a slow early response can land last and show you the wrong results while the correct text sits in the box. Each request is now stamped and only the newest one is allowed to update the screen.

**The URL is properly encoded.** A product called `Tom & Jerry #4` pasted straight into a web address gets silently cut off at the `#`. The server would then search for something you never typed, and every log would say it worked fine. This is now encoded and there is a test that specifically searches for a product with an ampersand and a hash in its name.

**The Enter key on the search box searches immediately** rather than waiting out the debounce, which is what you instinctively expected when you pressed it.

---

## Testing — "test it, test the tests"

I added **47 new tests** (the file went from 21 to 68). But a passing test proves nothing on its own, so I did the second half of what you asked.

I wrote a mutation harness: a script that deliberately corrupts the fixed code in 23 different plausible ways — one at a time — and re-runs the suite each time to confirm the tests actually catch it. A test that cannot fail is decoration.

**All 23 mutants were caught.** Among them:

- Truncating the search list back to three items (the original Defect 3) — caught
- Capping before filtering instead of after (the original Defect 4) — caught
- The route silently dropping the search query — caught
- Removing the Enter handler from either box (Defects 1 and 2) — caught
- Reporting "complete" when the scan was actually cut short — caught
- Two separate off-by-one errors on boundaries (`>=` changed to `>`) — caught
- Removing the URL encoding so `&` and `#` corrupt the search — caught
- Removing the out-of-order guard — caught

The first run scored 16 of 19. Three survived, all in the register's screen code, because that logic was written inline where it can only be checked by reading the source text rather than by running it. Rather than write weaker tests to paper over that, I moved that logic into two small pure functions that can be tested properly, and re-ran. That is why the count went from 19 to 23 and the score went to 23 of 23.

**Full verification:**

| Check | Result |
|---|---|
| TypeScript compile | 0 errors |
| ESLint | 0 errors, 0 warnings in touched files |
| Full test suite | 606 files, **15,510 tests, all passing** |
| Pure self-test runner (CI) | all passed |
| Mutation testing | **23 / 23 killed** |

---

## What I need you to confirm on real hardware

The Enter-key fix is verified in code and by test, but the scanner is physical and I cannot press it from here. When you get a chance:

1. Open transaction history and **scan a receipt** — it should look it up immediately.
2. **Type** a receipt number and press Enter — same result.
3. Search for a customer who came in **two or three days ago** — this is the case that used to fail silently.
4. Search for a product that was the **fifth or later item** on a large basket.

---

## The rest of your message

You also asked how to stress the system, whether to give me Supabase access, and for help keeping track of what needs testing. I have written two documents for that:

**`docs/BATTLE_TESTING_GUIDE.md`** — the direct answer on Supabase access (short version: please do not point stress testing at production, and here is the specific reason for each hazard, plus what to do instead), followed by seven "lenses" for spotting edge cases without being technical. The lenses are the actual skill, taught in plain language using your products as examples. Lens 2 is the one that would have caught the bug you just reported.

**`docs/BATTLE_TESTING_CHECKLIST.md`** — the tracker you asked for. Every area of the back office and register, ordered by how much a failure would hurt, with checkboxes. It already records the things you told me are working, so you do not re-tread them, and it flags the two you named as untested: the non-daily discount types and the CCRS CSV upload.

The single highest-value thing you could authorise before cutover is a **staging database** — a structural copy of production with no real data in it. That is what turns "I am testing gingerly on production" into "break it as hard as you like." It is explained in Part 1 of the guide, and I can build it as its own slice whenever you say the word.

Still outstanding on my side and waiting on you: the make and model of the old USB printers.
