# R39 - ACH integration (vendor + employee authorizations, vault, e-sign)

Branch `r39-ach-integration` from main `9227ec30` (R38 merged).
Standing rules: never guess / never assume, test it and test the tests,
commit + push after every task, no drift.

## Owner request (verbatim, rule 1)

> Thank you. I am ready to begin the integration process that this roadmap
> strategy has laid out. Main has move quite a bit, so get a fresh copy of the
> git repo before beginning. The first thing I need you to do is to change my
> bank account in all of the forms, I was wrong, it will be coming out of
> account ending 6048. As for the questions, Q1- Stephen and I need to be able
> to do any and all actions and steps to make this work. Q2- I want the
> enterprise grade solution here, research the internet for the best most
> professional expert solution. Q3- I'm not sure, our system has plaid
> integrated, I'm not sure it that helps or is useful, however it is just the
> hobby version, so it's limited in what it can do. Is a prenote a check? What
> is a prenote? What is the $1 test credit? I'm not sure if my bank accepts pre
> notes, I will have to ask. I want the most easiest most convenient solution
> here. Q4- again, I'm not sure what you mean. They allow split accounts. But we
> won't ever be accepting or taking in money, just sending money. Q5- add e-sign
> now, and integrate that into the roadmap strategy please. Q6- yes, we use
> llama parse to read PDFs. I want it to be able to manage these documents for
> me to automate the process. Q7- yes. Q8- I don't know, please deep research
> this then implement the enterprise grade solution that is professional and
> expert. Q9- Stephen and I. By his phone and email, or my phone and email, or
> contacting the store phone and email. Q10- the system has no employee data
> yet, but all employees will be signing this, and it needs to be in the file
> and in the vault and where ever else applicable. Q11- again no employee data
> yet, but because we allow split accounts, the vault will need to be updated
> to allow for up to three accounts to be used per employee. And since we are
> on the topic of the vault, I want to make inactive and any other non active
> employees hidden from the active table. The others should live in a hidden
> but callable table via a button so there is no clutter in the current
> employees table. Same goes for the vendors. Q12- I don't think we have the
> ability built and set up. I don't think it's worth building either. I am a
> small shop with only 10 employees. They can let me know in writing or
> verbally. Q13- I'm not sure, deep research the enterprise grade solution,
> then add some extra padding to it if you think it's needed. For the vendor
> records, I want it to be shown in their vendor detail page and to be flagged
> or know to me in some way that we need to get them to give us their bank
> info, or if they opt out, a way for me to check a box that they opted out.
> Please make sure to add in anything else that makes this exceptionally
> better and more professional and more enterprise grade. I need you, the
> expert professional with near infinite wisdom to add as much additional
> value as you can beyond what I have asked for. Please go above and beyond
> for me. Please complete on slice at a time, committing work very often, the
> sandbox environment is very unstable, so we must protect the work at all
> costs. At the end of the slice, please advice me on if anything else is
> needed on our side for the ach to work. Timberland has set up my cash
> management services now so I am good to go on their side. Let me know if
> there is anything left for me to do. Follow the standing rules and never
> guess, never assume. Test it, test the tests. Thank you!

## Grounded facts already in the repo

- `src/lib/atm/atm-sweep-core.ts` (owner, verbatim): "The atm account is 6228,
  3557 is my personal checking account and 6048 is the cannabis checking
  account." The ACH funding account 6048 is therefore the cannabis operating
  checking account. The paper forms (outside the repo) were corrected from
  6228 to 6048.
- Credits only (owner: "we won't ever be accepting or taking in money, just
  sending money"): Nacha transaction codes 22 (checking credit) and 32
  (savings credit), `src/lib/payments/nacha-core.ts`.

## Status
- [x] S0 fresh clone, request recorded
- [x] S1 authorities (36 verbatim, `industry_guidance` kind, verifier routes),
      pure `ach-authorization-core.ts` (FedACH banking days 2026-2030,
      prenote / return / NOC / reversal clocks, splits <= 3, release
      verdicts, retention, return / NOC codes), mentor + gates. Full
      compliance suite: 815 files, 21,665 tests green.
