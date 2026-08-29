# The Shop Card

**books-99 — what I built, and the mistake it prevents**

You said you would get the low-limit card and stop using the master till for
petty cash. That is the right call, and the card feature is now built. What
follows is what it does, and the one thing I found while building it that would
have cost you real money.

## What happens now when Alyssa buys supplies

She takes the card off the hook, drives to the store, buys $15 of bags, and
comes back. She does not take cash, she does not leave a receipt in the till,
and nobody has to remember anything. The charge appears in the bank feed and the
books record it:

    DEBIT   Store supplies      $15.00
    CREDIT  Credit Cards Payable        $15.00

The master till stays at exactly $1,000, all day, every day. That was the whole
point of moving off petty cash, and it is now true by construction rather than
by everyone being careful.

Notice the second line. Buying on the card does not spend cash — it creates a
debt. The $15 sits in Credit Cards Payable until you pay the bill.

## The mistake I found, and what it would have cost you

When the statement gets paid from checking, your bank reports it as money going
out. Before this slice, nothing in the system could tell that apart from an
ordinary purchase. It would have read the description — "CHASE CARD PMT" —
classified it as an expense like any other, and recorded this:

    DEBIT   Some expense        $15.00
    CREDIT  Checking                    $15.00

That entry balances. The bank reconciles to the penny. And it is wrong, because
you would have deducted that $15 twice: once when Alyssa swiped, and again when
you paid the bill. Every single card purchase, double counted. Meanwhile Credit
Cards Payable would climb forever, because nothing was ever paying it down on
the books — a card balance that only went up, for a card you were actually
paying off every month.

I want to be direct about why this matters more for you than for most people.
Under 280E your deductible expenses are already the part an examiner looks at
hardest. An expense total inflated by a duplicated card bill is exactly the kind
of finding that turns a look into an adjustment. This is filed as **D-78**.

The correct entry for paying the bill touches no expense account at all:

    DEBIT   Credit Cards Payable  $15.00     (you owe less)
    CREDIT  Checking                      $15.00     (you have less)

Both sides are balance sheet. The expense was already recorded weeks ago, at the
swipe. That is the entire idea of a card: the expense and the cash payment
happen at different times, and the liability carries the gap between them.

## How the system knows, and the trap inside the fix

It does not read the description. Bank descriptors change, and "CHASE" could
just as easily be something you genuinely bought. Instead it uses the category
your bank itself attaches to the row through Plaid — the issuer's own structured
statement of what that transaction is. I pulled Plaid's published category list
directly rather than assume the name.

That list is also where I found the trap. Their documentation says a card
payment shows up as *"positive amounts for credit card subtypes and negative for
depository subtypes."* In plain terms: **the same payment appears twice**, once
on the checking feed and once on the card feed, pointing opposite ways. A naive
fix would have booked both and paid the card down twice — the same double count,
walking back in through the other door.

So exactly one copy counts. The books use the checking side, because that is
where the real cash moves and that is the date your bank statement shows. The
card's copy is recognised and deliberately skipped, and if you ever look at it
the screen says so in words: *nothing was recorded here, and nothing is missing.*

One thing I was careful **not** to do: interest and finance charges are still
recorded as real expenses. A rule greedy enough to treat those as transfers
would quietly delete a legitimate deduction, and a missing deduction leaves no
trace of itself. That boundary is pinned by its own test.

## How hard I tried to break it

I wrote 20 deliberate sabotages of this feature and required the test suite to
catch every one — reversing the entry, paying from the ATM account, letting the
card bill reach the classifier again, swallowing the interest charge.

The first run caught 15 of 20. **Five got through, and those five were the
valuable part.** Three were the same shape: the logic was perfectly correct and
simply never reached, because the service was not reading the category column
out of the database. Correct code that nothing calls looks identical to working
code from every screen — and it would have left D-78 fully in place. I closed
all five. It now catches 20 of 20.

Full suite: **12,885 tests across 504 files, all passing**, along with the type
check, the pure self-tests, the citation check, the lint, and the ledger census.
No database change was needed — your bank feed has been storing that category
column since books-88.

## One practical note

Put the card on the same Plaid connection as the operating account when you set
it up. The books need to see both feeds to recognise both halves of a payment.
If only the card is connected, the checking-side row never arrives and the
liability will not come down.

When the card arrives, tell me the issuer and the limit and I will confirm the
role is set correctly on the Plaid screen — that role is what routes purchases
to Credit Cards Payable, and it is the one setting a person has to get right.
