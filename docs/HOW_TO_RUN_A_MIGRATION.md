# How to run a migration — step by step

**For Michael. No jargon. Every click.**

---

## First: what even is a migration?

Your website has a database. The database is where every product, sale,
employee and journal entry actually lives. It has a *shape* — a list of tables,
and a list of columns inside each table.

When I build something new, I often need to change that shape. Add a table. Add
a column. Add a rule saying "this number can never be negative."

I am not allowed to change your database directly. That is your standing rule
number 6, and it is a good rule — it means nothing touches your live data
without you personally deciding it should. So instead I write the change down
in a file, and hand it to you.

**A migration is just a text file full of instructions for your database.**
That's it. You copy the text, paste it into a box on the Supabase website, and
press a button. The database reads the instructions and changes its own shape.

The files live in the repository at `supabase/migrations/`, and they're
numbered: `0185_books_owner_only.sql`, `0186_cutover_config.sql`, and so on.
The number is the running order. Low numbers first.

---

## The one thing that makes this safe

Every migration I write is **idempotent**.

That's the only piece of jargon in this document, and it means: **running it
twice does nothing bad.** If you're not sure whether you already ran one, run it
again. If you get interrupted halfway and start over, that's fine. If you paste
the same thing three times, the result is identical to pasting it once.

This is deliberate. I write them this way *specifically* so you never have to
remember whether you did it. When in doubt, run it again.

---

## Step by step: running a migration

### Step 1 — Open Supabase

1. Go to **https://supabase.com/dashboard** in your browser.
2. Sign in.
3. Click your **Greenway project**.

### Step 2 — Find the SQL Editor

Down the **left-hand side** there's a vertical strip of icons.

Look for the one that looks like a **database/terminal icon labelled "SQL
Editor"**. It's usually about halfway down the list.

Click it. You'll get a big empty text box with a **"Run"** button, usually at
the bottom right or top right.

That text box is where the instructions go.

### Step 3 — Get the text of the migration

Two ways. Either works.

**Way A — from GitHub in your browser (easiest):**

1. Go to `https://github.com/mblyman89/GREENWAY-WEBSITE`
2. Click the **`supabase`** folder, then the **`migrations`** folder.
3. Find the file — for example **`0185_books_owner_only.sql`**.
4. Click it.
5. Look for the **copy icon** (two overlapping squares) at the top right of the
   code. Click it. That copies the whole file.

**Way B — if you have the code on your computer:**

Open the file in any text editor, select all (`Cmd+A` / `Ctrl+A`), copy
(`Cmd+C` / `Ctrl+C`).

### Step 4 — Paste and run

1. Click inside the big empty box in the Supabase SQL Editor.
2. Paste (`Cmd+V` / `Ctrl+V`).
3. Click **Run**.

Wait a few seconds.

### Step 5 — Check what it said

**If it worked**, you'll see something like `Success. No rows returned` in a
panel underneath. That's what you want. "No rows returned" sounds like nothing
happened — it isn't. It means "I did the work you asked, and there was no list
of results to show you."

**If it says ERROR**, stop. Don't try to fix it yourself. Copy the entire red
error message and send it to me. Nothing is broken — the database refuses the
whole file if any part of it fails, so a failed migration changes nothing at
all. It's all-or-nothing by design.

### Step 6 — Do the next one

Migrations run **in numeric order**. `0185` before `0186`. Always.

This matters more than it sounds. `0186` creates security rules that use a
function called `is_owner()` — and `is_owner()` is created by `0185`. Run them
backwards and `0186` fails, because it's reaching for something that doesn't
exist yet.

---

## Now: what I meant by "run `select * from gl_audit_cutover_date();`"

I'm sorry — I said that like you'd know what it meant. Here's what I actually
meant, in full.

### The idea

When migration `0186` runs, it goes and rewrites some things that were already
inside your database. That's a bit more invasive than just adding a table, so I
wrote a **second, separate thing** whose only job is to double-check the first
thing worked.

It's called `gl_audit_cutover_date`. Think of it as a smoke alarm. You press the
test button, and **silence is the good outcome.**

### How to press it

1. You're still in the **SQL Editor** from Step 2 above.
2. Clear out the box — select everything in it and delete it.
3. Type this line, exactly:

```sql
select * from gl_audit_cutover_date();
```

4. Click **Run**.

### How to read the answer

**You want to see nothing.** An empty result. It might say `No rows returned`,
or show an empty table with column headers and nothing underneath.

**Empty means everything is correct.**

This feels backwards, so here's the reasoning. I could have written a check that
says "OK ✓". But a check that says OK is only as good as my confidence that I
asked it the right question. So instead I wrote it to hunt for **problems** — it
goes looking for any leftover place where the old wrong date is still hiding.
Every problem it finds, it lists.

So: **a list of rows = things still wrong.** If you see rows, copy them and send
them to me.

**Nothing listed = nothing wrong.**

### The same idea, for the other migration

`0185` (the one that locks your books) has its own smoke alarm:

```sql
select * from gl_audit_owner_only_gate();
```

Same rule. Run it, and **empty is good**. It hunts for any place in your books
that's still readable by an admin instead of by you alone. Anything it lists is
a door I left unlocked.

---

## Something I fixed before you ran anything

Before writing this list I did something I hadn't done before: I built a real,
empty PostgreSQL database in the sandbox and ran **all 188 migrations** against
it, start to finish, the way you would. Not a test that pretends to run them —
the actual files, against an actual database.

**`0185` failed.** The very first one. On the very first paste.

Here's what happened, in plain English. That migration rewrites the security
rules on your accounting tables. To do that it first has to read the existing
rules and see who each one applies to. Some of them apply to "everyone", and
PostgreSQL stores "everyone" internally as the number zero. When my code asked
PostgreSQL to turn that number back into a name, it didn't say `public` — it
handed back the literal text `unknown (OID=0)`. That text then got pasted into
the new rule, and the whole thing died on a stray bracket:

```
ERROR:  syntax error at or near "("
```

Two things worth saying about it:

**It would have hit you on step one.** Not on some rare edge case months from
now — on the first command of the first migration of the books project, with no
obvious reason why.

**It wouldn't have damaged anything.** Migrations run inside a transaction,
which means it's all-or-nothing: the moment it errored, the database undid
everything it had done and put your old rules back exactly as they were. So you
were never at risk of ending up half-locked. But you'd have been staring at a
red error with no idea what to do, and that's bad enough.

**What you need to do about it: nothing.** The fix is one line — the zero is now
filtered out — and it's already in the file. `0185` is idempotent, so just run
it as listed below whether or not you tried before.

I'm telling you this in detail for a reason. No amount of reading the file would
have found it, and no test I'd written would have caught it, because the test and
the code shared the same wrong assumption about what PostgreSQL returns. It took
actually running the thing against a real database. That's now part of how I ship
these, permanently.

### And then the smoke alarm cried wolf

Running the whole stack again on a clean database found a **second** problem with
`0185` — this one in the safety check itself.

I told you above that `select * from gl_audit_owner_only_gate();` should come
back **empty**, and that anything it lists is a door left unlocked. On a
perfectly healthy database, it came back with **one row**, every single time:

```
 function | gl_audit_owner_only_gate | GL_FORBIDDEN guard still references is_admin()
```

It was reporting **itself**.

The reason is almost funny. That check works by reading through every function in
your database looking for two specific phrases — the name of the old admin-level
permission, and the error code for a blocked action. To look for those phrases,
it has to *contain* those phrases. So when it read through every function, it
read itself, found both phrases sitting right there in its own instructions, and
dutifully reported itself as a problem.

Harmless to your data. Genuinely bad for you, though, because I'd just finished
telling you "empty means you're safe." You'd have run it, seen a row, and
concluded the lockdown failed — when it had actually worked perfectly. A smoke
alarm that goes off while you're cooking dinner every night is worse than no
smoke alarm, because eventually you take the battery out.

**Fixed.** The check now skips the audit functions themselves. I verified both
halves of that: on a clean database it now returns **zero rows**, and when I
deliberately planted a bad function that really was still gated on the old admin
permission, it caught it immediately. So it's quieter *and* it still works.

**What you need to do about it: nothing.** Same as before — the fix is in the
file, and `0185` is idempotent, so just run it as listed below.

---

## Your actual to-do list right now

**Six** migrations are waiting. In this order:

- [ ] **`0185_books_owner_only.sql`** — locks your books and financial reports to
      you alone. Until you run this, `/admin/reports/accounting` and its two
      CSV download links are still readable by managers.
      Then check: `select * from gl_audit_owner_only_gate();` → want **empty**.

- [ ] **`0186_cutover_config.sql`** — moves the cut-over from the wrong date
      (2025-12-31) to your real one (2026-11-01), and fixes the opening balance
      date to 2026-10-31. Until you run this, the Conversion screen will tell
      you its settings row is missing.
      Then check: `select * from gl_audit_cutover_date();` → want **empty**.

- [ ] **`0187_vendor_bills_to_gl.sql`** — connects vendor bills to your books.
      This is the new one. It adds the list of 24 purchase kinds (what a bill
      line can BE, and what each one does to your taxes), the per-vendor
      defaults, and the function that writes an approved bill into the ledger.
      Until you run this, the new **Bills & 280E** page still teaches and still
      does the math on screen, but nothing can post.
      Then check: `select * from gl_audit_vendor_bill_wiring();` → want **empty**.

- [ ] **`0188_payroll_to_gl.sql`** — payroll, and the answer to your question
      about writing off employees. This is the big one from this slice.
      Until you run this, payroll works exactly as it does today (your admin can
      still pay people) and the new payroll page still teaches and does all the
      math on screen — but no payroll run can reach your books.
      Then check: `select * from gl_audit_payroll_wiring();` → want **empty**.

- [ ] **`0189_bank_matching.sql`** — bank matching. This is the newest one, and
      it is the one that catches the mistakes that don't announce themselves.
      Every entry in your books gets matched against a line that actually hit
      the bank, so nothing is invented and nothing is missed.
      Until you run this, the new **Bank & Reconcile** page still teaches and
      still does every calculation on screen — but no match can be recorded.
      Then check: `select * from gl_audit_bank_wiring();` → want **empty**.

- [ ] **`0190_owner_only_financial_tables.sql`** — the newest one, and the
      shortest to explain. `0185` locked your **books** to you alone. It did not
      lock the **bank feed, the ATM, the crypto, or the loans** — twenty-five
      tables that were still readable by *any* active staff member, of any role,
      including a read-only analyst. One of them holds the key to your bank
      history. This file puts the same lock you already have on your books onto
      all twenty-five.
      Nothing breaks: every sync uses the service role and is unaffected, and
      your admin keeps paying vendors and employees exactly as before.
      Then check: `select * from gl_audit_financial_tables_gate();` → want **empty**.

All six are safe to run twice. If you've already done one, do it again anyway —
it costs you thirty seconds and removes all doubt.

### About that fourth one — the employees-as-COGS question

You asked for **"the ability to assign employees as cogs so I can write them
off."** I need to give you the real answer rather than the one you wanted, and
then show you the part you actually can have.

**The wall.** In tax language your store is a **reseller** — you buy finished
product and sell it. The rule for a reseller's inventory cost is Reg.
§1.471-3(b), and it lets you add to what you paid only *"transportation or other
necessary charges incurred in acquiring possession of the goods."* Read that
twice, because what matters is what **isn't** in it: there is no mention of labor
anywhere in that paragraph.

The paragraph that *does* say *"expenditures for direct labor"* is the next one
down, §1.471-3(c) — and it only applies to goods *"produced by the taxpayer."*
You don't produce; your licence doesn't even permit it. And even that paragraph
carves out *"any cost of selling."* So a budtender's hour can't become cost of
goods sold for a grower either.

This has been litigated, and the taxpayers lost every time. Harborside (*Patients
Mutual*, 151 T.C. 176) was the big one. *Richmond Patients Group* trimmed and
dried product and the court **still** called them a reseller. If trimming and
drying didn't do it, nothing happening on your sales floor will.

**The door.** There is one, and it's real. Time spent *acquiring possession* —
meeting the transporter at the door, counting cases against the manifest,
confirming the CCRS record, moving product into the vault — is the exact thing
§1.471-3(b) describes. It rides in on the same clause your inbound freight rides
in on. That time can go into inventory cost.

But it's narrow, and it comes with a price: **you have to be able to prove the
minutes.** Under §6001 the burden of proof is yours, not theirs. Harborside
didn't lose because its theory was illegal — it lost because its numbers weren't
supported. So this migration also adds the missing piece: your time clock now
records *what someone was working on*, and can tie a receiving task to the
specific delivery it belongs to. Without that, there is nothing to prove and the
system will refuse the allocation — on purpose.

It will also refuse to let you claim more than 25% of payroll as receiving time,
and it'll ask you to confirm anything above 10%. A retail store that takes a
handful of deliveries a week does not spend a quarter of its wage bill on the
receiving dock, and a number that big fails the smell test before anyone opens a
single record. An overstated claim doesn't just lose you the overstatement — it
poisons the honest part of it too.

**What this is worth to you.** Not as much as you hoped, and more than nothing.
The honest framing is that the receiving allocation is a modest, defensible
recovery on a tax rule that is genuinely brutal to your industry. The much bigger
win in this migration is that every wage dollar is now **tagged** rather than
lumped together — so when your CPA asks what's disallowed under §280E, the answer
is a number you can produce in a second and defend line by line, instead of an
afternoon of reconstruction.

**0188 must go after 0185.** Like `0187`, it checks first and stops with
`MIGRATION_OUT_OF_ORDER` rather than half-building itself.

**0189 must go after all of them** — and as of this slice it now checks, which
it did not before. I found that while writing this page: `0187` and `0188` both
refuse politely if you run them early, and `0189` didn't. Pasted out of order it
would have thrown a raw database error at you a few hundred lines in, about a
table you've never heard of, with no hint about which earlier file you'd missed.

Nothing would have been damaged — every one of these files runs inside a
transaction, so an out-of-order run changes nothing at all — but you'd have had
no way of knowing that, and no way of knowing what to do next. So `0189` now
opens with five checks, and if any of them fails you get a sentence that names
the file to run first, like this one:

```
MIGRATION_OUT_OF_ORDER: 0189 bridges plaid_transactions (migration 0157)
to the ledger. Run 0157_plaid_foundation.sql first.
```

That's the whole error. Read it, run the file it names, come back. **If you see
that message, nothing happened to your database** — you have not half-installed
anything, and you don't need to undo anything.

I proved this rather than assuming it. I built five throwaway databases in the
sandbox, each one missing a different prerequisite, ran `0189` against each, and
confirmed all five produced their own plain-English sentence naming their own
file. Then I ran it against the real one and confirmed it stayed silent and
applied cleanly. There's also a test now that fails the build if anyone ever
removes those checks, or waters one down so it stops naming the file.

**0187 must go after 0185.** It checks for `is_owner()` before it does anything,
and if that function isn't there yet it stops with a message that says
`MIGRATION_OUT_OF_ORDER` in plain sight, rather than half-building itself. If you
see that, run `0185` first and then come back to `0187`.

**0190 must go after 0185 as well** — and after the four files that create the
things it locks (`0156` ATM, `0157` Plaid, `0160` crypto, `0171` loans). It
checks for all five before it changes anything. If one is missing it stops and
tells you exactly which file to run, by name, and confirms that nothing was
changed. That check was proved the same way the `0189` one was: by building
throwaway databases that were each missing a different prerequisite, running
`0190` against each, and confirming a different, correct sentence came back
every time.

### The `0190` check line, and what "empty" means

After you run `0190`, run this:

```sql
select * from gl_audit_financial_tables_gate();
```

You want to see the words **`(0 rows)`** and nothing else. Same convention as
every other check in this document: **it lists only problems.** A blank result
is the good result.

If something *is* printed, it will be one of two sentences, and they mean
different things:

- **"still references is_staff()"** — that table is still readable by any
  active staff member. The lock did not take on it. Run `0190` again.
- **"exists but has no is_owner() policy"** — that table has no owner lock on it
  at all. This is the more serious of the two. Send it to me.

Both sentences name the table, so you never have to guess which one is the
problem.

One thing worth saying plainly, because it is the reason this check exists at
all: **I tested the checker by breaking the lock on purpose.** In a scratch
database I put one table back the way it was, confirmed the function noticed and
said so, then removed the lock entirely, confirmed it noticed *that* too, and
then restored it and confirmed it went quiet again. A checker that prints
"all clear" over a broken lock would be the most dangerous file in this
repository — because it is the one you would trust and stop looking behind.

### A note on the numbering

You noticed I'd used `0179` twice. You were right, and thank you — that was a
real mistake with a real consequence, because you run these by hand in numeric
order by reading the file names. Two files called `0179` means one of them
quietly gets skipped, and if the skipped one is the one that creates a function
the other needs, the second fails.

So:

- The books lockdown moved from `0179` → **`0185`**.
- The cut-over config moved from `0184` → **`0186`**.
- I also found a *second* duplicate that predates this work — two files both
  numbered `0158`, from back in PR #898. The Plaid one moved to **`0184`**, the
  free slot the cut-over vacated.

Your migration folder is now **190 files, no duplicates, no gaps** — a clean run
from `0001` to `0190` (`0187` is the vendor-bills one, `0188` is payroll, `0189`
is bank matching, and `0190` is the new owner-lock on your money accounts).
I've since confirmed that by applying them, in
order, to a real empty database — which is how the `0185` bug above came to
light. I re-check the count, the gaps and the duplicates on every slice; those
three checks are automated now, so a duplicate number cannot come back quietly.

And there's now a test that fails the build if anyone ever creates a duplicate
number again. It can't come back silently.

**If you already ran the old `0179_books_owner_only.sql` or
`0184_cutover_config.sql` under their old names:** nothing to do. It's the same
text inside; only the file name changed. And they're idempotent anyway.

---

## Quick reference

| Question | Answer |
|---|---|
| Where do I paste it? | Supabase → your project → **SQL Editor** |
| What order? | Numeric. Low to high. Always. |
| Can I run one twice? | Yes. Always safe. When in doubt, do. |
| What does success look like? | `Success. No rows returned` |
| What if it errors? | Nothing changed. Send me the red text. |
| What does the audit check mean? | **Empty = good.** It only lists problems. |
| Do I ever type SQL myself? | Only the `select * from …` check lines above. Copy-paste them. |
