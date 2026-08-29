# Whose Account Is This?

**books-101 — the first slice of the Plaid rebuild**

You told me it is just you and Alyssa, that you each keep your own accounts and
your own connection, and why. You also said you want one set of books your
grandfather can use to do the returns, and that the Citi Mastercard "stays with
me always and is only used for greenway marijuana purchases." I built the piece
all of that depends on.

## The problem, in one sentence

Nothing on a connected account said whose it was, so the books guessed from the
shop name — and an Amazon order was an Amazon order whether you bought bags for
the store or Alyssa bought something for the house. Both landed in Greenway.
A personal charge sitting in Greenway's expenses is a deduction on a cannabis
return that should not be there, and it is the kind of thing an examiner finds
quickly. The entry balanced, the bank reconciled, nothing looked wrong. That is
defect 80.

## What each account now carries

Three separate labels, because they answer three different questions and they
genuinely disagree with each other. **Owner** is whose account it is, you or
Alyssa — for net worth and for knowing who to ask; it deliberately does not
affect where money lands. **Books** is which set the activity belongs to —
Greenway, ATM, Land holding, or Personal — and this one decides the numbers.
**Role** is which account on the chart it stands for, unchanged from before.

Your Citi Mastercard is the case that proves one label could never have done the
job: Owner is you, Books is Greenway, Role is credit card. It is your personal
card and every dollar on it is the shop's. One field cannot say that without
lying about something.

## What happens now

The books ask the account, not the shop name. A charge on an account set to
Personal is tracked for your net worth and your spending and kept out of the
business ledgers entirely — as a decision, not an error, so you never see a
warning tempting you to mislabel a personal card just to make it go away.

An account nobody has classified yet keeps downloading transactions and balances
and posts nothing at all. I chose that over defaulting to Greenway, because
defaulting would quietly do the exact thing this slice exists to stop, to
accounts you had not even looked at. Fixing an unclassified account takes ten
seconds; finding a personal charge buried in a filed return does not.

There is a second fix in here. You could not have tagged the Citi card even if
you had wanted to: the system allowed exactly one account per role, so the
second credit card was refused and the only way in was to untag the first, which
would have silently stopped that card posting. That is defect 79. Cards,
savings, mortgages and loans now repeat freely. Only "Main operating" stays
unique, for a real reason — vendor and payroll reconciliation both sweep every
account holding it, so a second one would start pulling your groceries into
payroll matching.

## What I did not do, and what I need

I did not add a **joint** owner. You said you will have joint accounts "at some
point when it's allowed," and I would rather add it the day it is real than
leave a half-considered option sitting in the list. It is one line when you want
it. I did not backfill your existing accounts either: there is no record of
whose they are, and that absence is the whole defect, so guessing would be
inventing the answer this slice exists to stop inventing. The connection
management screen and the multi-connection linking flow from the audit sit on
top of this, and this had to be solid first.

To prove it is, I made twenty-one deliberate breaks — treating a blank tag as
"assume business," letting the owner decide the books and pushing your Citi card
into the personal pile, folding "personal" into an error, dropping the column
from the query so the check runs on nothing. All twenty-one were caught. Three
survived my first attempt, which is why the exercise is worth doing: my tests
were checking the decision without checking that the decision was ever reached.
Full suite: 12,924 tests across 507 files, all green.

So: open the Plaid screen and set Owner and Books on each connected account. The
Citi Mastercard is Michael / Greenway. Your business checking is Michael /
Greenway. Anything of Alyssa's is Alyssa / Personal. Nothing posts until you do,
so there is no rush and no risk in taking your time. Once they are set, tell me
and I will build the connection-management screen so you can add the rest — her
cards, the portfolios, the debt — and see how many of the twenty free
connections you have left.
