# The Plaid Audit

**books-100 — what's actually there, what breaks with your setup, and what I'd build**

You asked me to audit the Plaid layer before we build anything else, because
your personal accounts, Alyssa's accounts, the investment portfolios and the
debt are all coming into this system. I read the whole layer and ran it against
your real scenario. This is a recon report — I have not changed any code.

The headline: **the plumbing is good, and the labelling is not.** Connecting
banks, encrypting tokens, syncing transactions, even pulling investment holdings
and mortgages — all of that already works. What's missing is the part that says
*whose money is this and which business does it belong to.* Right now the system
can't answer that question, and with your accounts about to arrive it needs to.

## The three things that break

I tested these by actually running the code, not by reading it and assuming.

**One — you cannot connect a second card. At all.**

Your Citi Mastercard is already tagged "Credit card." When the new shop card
arrives and you try to tag it the same way, here is the literal response:

    That "Credit card" role is already assigned to another account.
    Clear it there first, then assign it here.

The tag is a *unique key* — one account per label, forever. Same for "Main
operating," so a second checking account is equally impossible. You asked me to
build it so you can use **any** credit card. Today the system permits exactly
one, and it isn't the one you're about to get.

**Two — a personal charge would post to Greenway's books.**

This is the serious one. I ran a $50 Amazon charge through the system. It does
not matter whose card it is; the answer is always the same:

    Expense 76010 · Entity: greenway · $50.00 · nondeductible under 280E

The system decides which business an expense belongs to **by reading the
merchant name**, and nothing else. The account it came from is never consulted.
So if Alyssa buys something on her personal Citi card, the books happily record
it as a Greenway business expense. On a 280E return that is precisely the kind
of item that does not survive an examination — and it's also the thing that
weakens the separation between you and the LLC that the structure exists to
protect.

**Three — the "Personal" tag is a dead end.**

There is a "Personal" option in the tag list. Choose it, and every transaction
from that account is refused with *"This account is tagged 'personal', which is
a name you typed rather than one of the roles the books know how to post to."*
It looks like a supported answer and behaves like an error.

## Why this happened, and it isn't sloppiness

One field is being asked to do three unrelated jobs. `role` currently answers
"which ledger account does this post to," "what is this account for," and — by
implication — "is this business or personal." Those are three different
questions, and the moment you own two credit cards they give conflicting
answers.

There is an `owner` field ("Michael" / "Wife"), but it lives on the *connection*
and is inherited from **which Plaid app** linked it — not from which human owns
the account. So it can label a whole bank login, but it cannot tell your
business Citi apart from a personal Citi at the same bank. The nickname field
even ships with the example *"Wife's Citi Costco Visa"* — proof that ownership
is being tracked today in a text label nothing can act on.

## What the professionals do

Every credible source on multi-entity bookkeeping says the same thing, and it is
not a software trick: **separation is a property of the account, not of the
transaction.** The standard guidance for an owner in your position — multiple
LLCs, plus personal, plus a spouse — is a dedicated account per entity, books
that never mix, shared costs allocated explicitly rather than guessed, and no
personal spending on business accounts. The CPA guidance is blunt about why:
commingling is what lets a court "pierce the corporate veil," and mixed records
are what turn an audit into an adjustment.

Translated into software, that means the **account** must carry the answer
before a single transaction is classified. Merchant rules refine *which expense*
it is; they must never be what decides *whose* it is.

On the Plaid side specifically, their **Multi-Item Link** flow lets you add
several institutions in one session, and it explicitly supports Transactions,
Liabilities and Investments together — which is exactly your mix of checking,
cards, portfolios and debt.

## What I'd build, in the order I'd build it

**First, split the one field into three.** Every account gets:

  * **Owner** — Michael, Alyssa, or Joint. A real field on the account.
  * **Books** — Greenway, Landholding, another entity, or **Personal**.
  * **Posts to** — the ledger account, and only for accounts on business books.

The rule that follows is short and worth stating plainly: *an account on
Personal books never posts to any business ledger.* Not refused with a confusing
message — never even offered. That single rule closes gap two permanently.

**Second, make the tag repeatable instead of unique.** Ten cards can all be
"Credit card"; what must stay unique is the *operating* account, because
reconciliation genuinely depends on there being exactly one. That closes gap one
and makes "any credit card" true.

**Third, require the labels before anything posts.** A newly linked account
starts as *unassigned* and is inert until you tell it what it is. Missing is a
question, not a default — an account nobody has classified should never quietly
guess that it's business.

**Fourth, the connection screen you actually asked for.** One page: every
connection grouped by owner, each account showing owner, books, tag, last-4 and
sync health, with anything unclassified flagged at the top. Multi-Item Link so
you can add several banks in one sitting.

I'd also fold in the per-card detail while we're there — your books use one
`33000 Credit Cards Payable` control account with *which card* as a dimension,
which is the correct professional structure. It means adding cards never
multiplies ledger accounts, but we should confirm each card's balance
reconciles individually.

## What is already fine, so we don't rebuild it

Access tokens are encrypted at rest and never sent to the browser. The Plaid
pages are gated to owner-only. Transaction sync is cursor-based and idempotent,
so re-syncing can't duplicate. Investment holdings and mortgages are already
being pulled and stored — they simply don't post to the ledger, which is the
right call for now; those are net-worth tracking, not business bookkeeping, and
mixing them in would be the same commingling mistake in a different costume.

## What I need from you before I build

1. **Owners** — is "Michael / Alyssa / Joint" the right list, or do you want
   trusts or other names?
2. **Personal books** — do you want personal spending merely *tracked* for net
   worth, or actually booked into a separate personal ledger? Tracked is
   cheaper and I'd suggest starting there.
3. **The Citi** — you called it "my own business credit card." Which books does
   it belong to: Greenway, Landholding, or personal-that-you-use-for-business?
   That last one is common and needs a deliberate answer.
4. **Alyssa's accounts** — connected under your Plaid app, or her own second set?

I'd file the first two gaps as defects now and build the three-field model as
the next slice. Tell me if that ordering suits you and I'll start.
