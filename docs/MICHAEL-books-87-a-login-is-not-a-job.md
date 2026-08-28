# A login is not a job

**books-87 — separating the people who can sign in from the people you pay**

You said payroll setup was listing the people who have access to the back
office. You were right, and the cause was older and simpler than it looked.

## Where it came from

Not the payroll code. That screen reads your employee list and always has. The
problem was poured in once, three years of database updates ago, by the
migration that built the time clock: it copied everyone with a back-office
account into the employee list so the clock would have people on day one.
Sensible for a time clock. Wrong the moment that list started answering a
different question — *who do we pay?*

Everything else already agreed with you, so this was a repair, not a rebuild.
Adding a user only creates a user. Adding an employee never links a login.
Nothing syncs the two. I checked all eight places that write to the employee
list: none touch the login column. That one old line was the whole of it.

## What I changed

Payroll setup now creates people. Type a name at the top of the page and they
appear on the list, ready for their W-4, I-9 and pay details. There is
deliberately no "also give them a login" checkbox — that stays a separate act
under Users, exactly as you described.

The accounts swept in by mistake are retired. They vanish from the roster, their
clock PINs are cleared, and each carries a note explaining it was created
automatically and was never someone you hired. **Their logins still work.**

I retired those rows rather than deleting them. Employee records are referenced
by audit history, and deleting one takes shift and time-clock history with it.
Tidying a list is not worth destroying evidence, and cannot be undone.

The rule for what gets retired is deliberately narrow, because **you are an
employee with a login** and a careless version would have terminated you. A
record is only retired if it has a login, is active, has no hire date, and no
W-4, I-9, pay record, punches or shifts. Every one of those is a reason to keep
somebody, so the mistake it is built to make is keeping a record it should have
retired — never the reverse.

I also fixed something you had not reported. The payroll roster had no filter at
all, so people who had left were still being asked for W-4s. It now uses the
same definition of "on payroll" as everywhere else, pinned by a test.

## What I did to try to break it

I wrote 35 tests, then a script that damages the new code 31 ways to see whether
those tests would notice. First run: 18 of 26 — and the eight that got through
are the useful part.

Three shared one shape. The repair has two versions, one for a database that has
had a certain earlier update and one that has not. My tests searched the whole
file, so breaking one version left the wording intact in the other and the test
stayed green while half the fix was broken. Both halves are now checked
separately.

Another: I disabled the check that refuses a blank name. The refusal message was
still in the file, so the test passed — while an empty name went into your
employee list. A refusal that cannot be reached is decoration. And I replaced
the new form with "Coming soon.": that passed too, because the form's name was
still in the import line.

After fixing all of it: **31 out of 31 caught.** Two existing safeguards also
fired on my own work — one caught that my new settings table had no security
policy, which would have published it to the internet; the other caught that the
new button had no verified caller. Both were real mistakes, found before you saw
them.

The most important tests here are traps rather than checks: they read every
migration and every file in the system, including ones that do not exist yet,
and fail if anyone reconnects logins to employees again. The next person to hit
the original problem will reach for the same shortcut. The full story is written
up as defect 69 so the reasoning survives.

**Where things stand:** 12,507 tests passing across 492 files, 210 database
updates, 69 defects recorded. All five checks green.
