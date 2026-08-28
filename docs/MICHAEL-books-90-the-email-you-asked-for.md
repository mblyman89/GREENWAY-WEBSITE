# The email you asked for

**Slice books-90 · for Michael Lyman**

## You remembered right

The email engine is in the compliance calendar. It has been sending since Task W — it emails you about CCRS upload deadlines, the LIQ-1295, register exceptions the staff left unresolved, and wage-order deadlines. It uses Resend, it keeps a log so it never sends the same thing twice, and it runs every morning around 8am Pacific.

So I did not build a second one. **Your large-entry warning is now the fifth thing that engine checks**, which means it inherited everything the other four already had: the send log, the once-a-day rule, the deep link, and the urgency levels. One system, five reasons to speak.

## What the email says

If any entry at or above $5,000 is sitting unapproved, you get one email listing all of them — oldest first, each with the amount, the entity, the date and the memo. Not one email per entry. One email, one list.

It repeats daily while they sit there and **stops on its own the day you approve them**. Nothing to switch off. If they sit three days or more it escalates from a warning to critical, matching how the register-exception nag already behaves.

The email says plainly that nothing has posted, because nothing has — these are drafts and they do not touch your P&L, balance sheet or tax figures until you approve them. It also reminds you that you can approve them yourself now, which books-89 made true.

## What counts as large is the database's opinion, not mine

This matters more than it sounds. The rule for "is this large" lives in the database, in migration 0174. I did not retype it — the code reads the same list the database uses, and **a test reads the migration file itself and fails if the two ever drift apart**. If I had copied the rule by hand and the database later changed, you would either get nagged about routine card sales or, far worse, stop being told about the entries that matter. Automatic entries the system generates itself — POS sales, excise, purchases, bank charges, reversals — are excluded, exactly as the database excludes them.

**One thing I want to be honest about.** If the check cannot run — database unreachable, a query fails — it does **not** stay quiet. Silence would look exactly like "nothing is waiting", and that is the one failure that could let a $40,000 entry sit unnoticed while everything looked fine. It reports that it could not look. Same for an entry it cannot total: it says so rather than assuming the entry is small.

## A button, because 8am is not something you can test

While wiring this I found the cron endpoint has claimed, in its own notes since the day it was written, that a staff member could trigger it manually with a "run reminders now" button. The permission to do it was real. **The button was never built.** That is the same shape as the last two defects you have seen from me.

So there is now a **Send reminders now** button on the compliance calendar. Press it and you get today's checks immediately — including the large-entry check. Press it twice and nothing doubles; anything already sent today is skipped and reported as skipped. It is also how you can see the whole thing work today rather than waiting until tomorrow morning.

**Still open, and on the list.** The email tells you a large entry is waiting. The drafts screen still does not visibly mark *which* one is large once you are looking at the list. That is the remaining half of PR D and I have not quietly closed it.

**Where things stand.** 12,573 tests pass. Fifteen deliberate acts of sabotage on this slice, including four that cut the button off from the engine in different places — all fifteen caught. Next up on the census: register cash, ATM vault loads, intercompany transfers, B&O accrual, fixed assets, loans, and the Cultivera cutover.
