# Fixing the Factory Reset button (one time, about a minute)

**For Michael. No Supabase knowledge needed.**

## What was wrong

When you pressed **Erase all test data** you got:

> Reset failed: canceling statement due to statement timeout

Supabase stops any request from the website after **8 seconds**. The old
reset emptied your test data one row at a time. With your CCRS uploads,
Cultivera uploads and test sales in the database, that took longer than 8
seconds, so Supabase stopped it. Because the reset is all-or-nothing,
**nothing was deleted**. Your data is exactly as it was.

## What the fix does

The new reset empties every test-data table in **one step**. On a test copy
of your database with 40,000 sales and 2.4 million CCRS rows (much more than
you have today), it finished in **0.39 seconds**. The old one was stopped at 8
seconds on the same data. The new one's speed barely changes as the store
grows, so you can wipe, test and wipe again as often as you like.

Nothing else about the reset changes:

* It still needs you to be the owner.
* You still type `ERASE ALL TEST DATA`.
* You still tick the records box.
* It still keeps your settings, chart of accounts, catalogue, people, logins,
  bank and ATM connections, and the activity log.
* It still writes one line in the activity log saying you ran it.
* It still checks afterwards that the books came out empty.

## What you do (one time)

The website cannot install this upgrade by itself. Supabase only lets the
project owner change the database, and that is a good thing. So there is one
copy and paste, and the reset page walks you through it:

1. Go to **Admin → Settings → Factory reset**. At the top there is a yellow
   box: **One-time upgrade needed before the reset can run**.
2. Click **Copy the upgrade**. The button changes to *Copied - now do step 2*.
3. Click **Open the Supabase SQL editor**. It opens in a new tab. Sign in if it
   asks. If it asks which project, pick the Greenway one.
4. Click inside the big empty box, paste (**Ctrl+V**, or **Cmd+V** on a Mac),
   then click the green **Run** button.
5. Supabase shows a warning: **Potential issue detected**, *This query
   includes destructive operations*. **This is expected.** The upgrade
   contains the word "truncate", because that is how the new reset empties
   tables. **Running the upgrade deletes nothing.** It only installs the new
   reset. Click **Run query**.
6. You should see **Success. No rows returned**. That means it worked.
7. Go back to the website tab and refresh the page. The yellow box is gone.
8. Tick the records box, type `ERASE ALL TEST DATA`, and press **Erase all
   test data**. You should get a green message saying how many rows were
   removed.

If step 6 shows a red **ERROR** instead, nothing was changed. Copy the red
message and send it to your developer.

You only do this once. After that the button just works, every time.

## If the Copy button does not copy

Some browsers block copying. The button will then say *Copy blocked - select
the text below* and show the text in a box. Click in the box (it selects
everything), copy it (**Ctrl+C** / **Cmd+C**), and carry on from step 3.

The same text is the file `supabase/migrations/0240_factory_reset_scales.sql`
on GitHub. The copy button gives you exactly that file.

## After the reset: normal things you may notice

* **Files in storage stay.** Uploaded files (manifest PDFs, payroll source
  documents, Sage uploads) stay in Supabase storage. The records pointing at
  them are gone. This affects no report or tax form. The reset page lists
  this under *What this cannot reach*.
* **Test logins stay.** Your login and staff logins are kept on purpose.
* **Numbering continues.** Internal counters carry on, and no journal number
  is ever reused.
