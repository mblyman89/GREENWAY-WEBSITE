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

## Your actual to-do list right now

Three migrations are waiting. In this order:

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

All three are safe to run twice. If you've already done one, do it again anyway —
it costs you thirty seconds and removes all doubt.

**0187 must go after 0185.** It checks for `is_owner()` before it does anything,
and if that function isn't there yet it stops with a message that says
`MIGRATION_OUT_OF_ORDER` in plain sight, rather than half-building itself. If you
see that, run `0185` first and then come back to `0187`.

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

Your migration folder is now **187 files, no duplicates, no gaps** — a clean run
from `0001` to `0187` (`0187` is the new vendor-bills one from this slice).

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
| Do I ever type SQL myself? | Only the two `select * from …` lines above. Copy-paste them. |
