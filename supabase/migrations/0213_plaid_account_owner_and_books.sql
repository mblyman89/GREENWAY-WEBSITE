-- =============================================================================
-- 0213_plaid_account_owner_and_books.sql  (books-101)
--
-- WHOSE ACCOUNT IS THIS, AND WHICH SET OF BOOKS DOES IT BELONG TO.
--
-- Owner (verbatim): "I want to make sure we are very deliberate and clear about
-- what accounts are for business and which ones are my wife and my personal
-- accounts."
--
-- THE DEFECT THIS CLOSES (D-80)
-- -----------------------------
-- Until now nothing on a Plaid account said whose money it was. `role` was
-- doing three unrelated jobs at once: which chart account to post to, what the
-- account is FOR, and whose it is. Those three vary independently, so one field
-- could not carry them without lying about at least one. The proof is Michael's
-- Citi Mastercard: a card issued to him personally that belongs entirely to
-- Greenway's books, because it "stays with me always and is only used for
-- greenway marijuana purchases." Owner=michael, books=greenway, posts to 33000
-- — three different answers that a single field cannot give.
--
-- The consequence was silent and expensive. With no entity on the account, the
-- ENTITY of a posted expense came only from the merchant rule, so
-- classifyExpense({merchant:'AMAZON'}) returned entity 'greenway' no matter
-- whose card was swiped. Alyssa's Amazon order posted into a 280E business.
--
-- WHY TWO COLUMNS AND NOT ONE
-- ---------------------------
-- Owner answers a question of FACT — whose name is on the account. Books
-- answers a question of ACCOUNTING — which ledger its activity belongs to.
-- Michael's card proves they disagree, and they change for different reasons:
-- an account changes owner essentially never, and can change books the day he
-- decides to stop using a card for the shop. Storing the pair also means the
-- day a joint account exists, only `owner` needs a new value; nothing about
-- posting has to move.
--
-- OWNER: WHY 'joint' IS NOT IN THIS LIST YET
-- ------------------------------------------
-- Michael (verbatim): "it is just my wife and I, we each have our own accounts
-- and our own plaid connection to separate the two. We don't share accounts
-- right now because the banks and card issuers have closed several of my
-- accounts in the past, and I don't want my name on my wife's accounts just in
-- case they decide to shut hers down too. We will have joint accounts at some
-- point when it's allowed. There are no other names or trusts."
--
-- So 'joint' is a REAL future value that does not exist today, and this is said
-- out loud rather than left as an accident of the schema. Adding it later is
-- one line in this constraint and one entry in OWNER_CODES — deliberately, no
-- table restructure, because owner is a column on the account rather than a
-- relationship encoded in which credential set happened to fetch it.
--
-- BOOKS: WHY THE SAME FOUR CODES AS THE LEDGER
-- --------------------------------------------
-- gl_entities (migration 0172) already holds exactly four entities: greenway,
-- atm, landholding, personal. `personal` is not being invented here; it has
-- been a first-class entity in the chart since 0172/0173, which is what makes
-- Michael's "one set of books that I can give my grandfather to use to fill out
-- my tax returns" reachable at all. Reusing the same four codes means the
-- account tag and the ledger speak one vocabulary; a fifth spelling would be a
-- second source of truth and therefore a future reconciliation failure.
--
-- BOTH COLUMNS ARE NULLABLE, AND THAT IS THE SAFE STATE
-- -----------------------------------------------------
-- A newly linked account arrives unclassified and INERT: it syncs balances and
-- transactions, and it posts nothing. NULL here means "nobody has said yet",
-- which is a question, not a zero (rule 135). The alternative — defaulting to
-- 'greenway' — would quietly resume exactly the D-80 behaviour of assuming
-- every account is the business, and would do it to accounts nobody had even
-- looked at. Refusing to post is recoverable in ten seconds on the Plaid
-- screen; a personal charge buried in a 280E return is not.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- It does not backfill. There is no evidence in this database of whose account
-- any existing row is — that is precisely the defect — so guessing would be
-- inventing the answer the whole slice exists to stop being invented (rule 1).
-- Michael classifies the existing accounts on the Plaid screen; until he does,
-- they behave exactly as they did before for reads and refuse to post.
-- =============================================================================

alter table public.plaid_accounts
  add column if not exists owner_code  text,
  add column if not exists books_entity text;

-- Owner: a closed list, checked in the database and not only in TypeScript.
-- coa-core.ts:80 records why that matters here: 18 accounts in the live Sage
-- chart were tagged 'GRWNY' instead of 'GRNWY' and nothing ever complained,
-- they just stopped appearing in entity-filtered reports. A compile-time union
-- is erased at runtime; a check constraint is not.
alter table public.plaid_accounts
  drop constraint if exists plaid_accounts_owner_code_check;
alter table public.plaid_accounts
  add constraint plaid_accounts_owner_code_check
  check (owner_code is null or owner_code in ('michael', 'alyssa'));

-- Books: the SAME four codes as gl_entities (0172). Not a parallel vocabulary.
alter table public.plaid_accounts
  drop constraint if exists plaid_accounts_books_entity_check;
alter table public.plaid_accounts
  add constraint plaid_accounts_books_entity_check
  check (books_entity is null or books_entity in ('greenway', 'atm', 'landholding', 'personal'));

comment on column public.plaid_accounts.owner_code is
  'Whose account this is: michael | alyssa. NULL = not yet classified (inert). '
  'No joint value yet — books-101, deliberately: the owner has been de-banked '
  'repeatedly and keeps his name off his wife''s accounts. Joint is expected '
  'later and is one value away.';

comment on column public.plaid_accounts.books_entity is
  'Which set of books this account''s activity belongs to: greenway | atm | '
  'landholding | personal, matching gl_entities (0172). Decides the ENTITY of '
  'anything posted from this account, INSTEAD of the merchant rule guessing it. '
  'NULL = not yet classified; the account syncs but posts nothing. Independent '
  'of owner_code: the Citi Mastercard is owner=michael, books=greenway.';
