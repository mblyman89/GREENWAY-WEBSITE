# R40 - Domain readiness, ACH helper, reminders, legal library

Branch `r40-ach-helper`, started from main `8ed61d85` (R39 ACH integration, merged and live).

## Owner request (summary, rule 1)

1. Confirm no roadmap work is left.
2. Confirm the new work shows on the Vercel development domain.
3. Fix the code so the only step left is pointing Vercel at GreenwayMarijuana.com, with www and the apex both public (www was broken, the apex worked).
4. Explain the LlamaParse data protection agreement (DPA) and whether LlamaParse v2 is worth moving to.
5. A "carried" ACH helper: baby steps, progress bars, checklists, green for success, deep links, bulletproof for non-technical people, and it unblocks anything that would block a payment.
6. A record-keeping and reminder helper (legislation changes that need code updates, yearly agreements to sign).
7. "Be my lawyer": court cases and authoritative sources, verbatim, in plain English, how to protect the business, in tabs so the main pages stay clean.
8. A very detailed plain-English final report.

The owner will ask Timberland the open questions himself.

## Status

- [x] Domain: www is the canonical public host, the apex redirects to it (308), old WordPress URLs redirect, host fallbacks unified
  (`src/lib/site/site-domain-core.ts`, `next.config.ts`, `docs/DOMAIN_GO_LIVE.md`, `tests/compliance/r40-site-domain.test.ts`).
- [x] Legal library: 13 entries (4 court cases, 7 RCW entries from 6 sections, WAC 296-128-035(7), 12 CFR 1005.10(e)(2)),
  generated from mirrored official sources by `scripts/r40/gen-legal-library.py`, quotes proved verbatim by
  `tests/compliance/r40-legal-library.test.ts` (21 tests, includes a one-character mutation and a generator idempotence check).
- [x] ACH calendar core (`src/lib/payments/ach-calendar-core.ts`, 32 self-tests): once / monthly / quarterly / annual tasks,
  Nacha rule watch (8 rules, verbatim), the written fraud procedure (C6), reminder planner with dedupe keys.
- [x] ACH guide core (`src/lib/payments/ach-guide-core.ts`, 22 self-tests): four journeys with progress, blocker-to-fix map with deep links,
  refusal explainer, pay-by-check fallback (WAC 296-128-035(7)).
- [x] Store (`ach-guide-store.ts`): gathers the facts from the same reads the vault, employee pages and operations page use;
  every read isolated; an unreadable calendar fails toward more reminders and refuses to overwrite history.
- [x] Pages (owner-only, `settings.manage`), as tabs beside the vault tabs: `/admin/settings/banking/guide`, `/calendar`, `/library`.
  The main banking page and the operations page only gain three small tab links.
- [x] 6th reminder planner in `compliance-reminders.ts` (own try/catch, rule-46 read-failure notes).
- [x] PAYROLL: wage files are pinned to the Nacha company entry description `PAYROLL` (required for PPD wage credits since 2026-03-20);
  before this, payroll used the editable setting.
- [x] Roadmap gap A5: onboarding has a `direct_deposit` task (not critical: an employee cannot be forced to use direct deposit).
- [x] Help FAQ and concierge teach the three tabs, the LlamaParse DPA and the pay-by-check fallback.
- [x] Tests: `tests/compliance/r40-ach-guide-calendar.test.ts` (86 tests): every deep link resolves to a real page AND a real anchor;
  every refusal the real pay gates produce (`payable`, `canPayWithVaultRecord`, `optOutPayRefusal`, `planPayrollEntries`, payroll guardrails)
  is explained, none "unknown"; every verbatim quote is in its mirror; pages are owner-only; planner wired.
- [x] Mutation runs (each breaks the code on purpose and the tests must fail): broken anchor, owner check removed, explainer rule removed,
  PAYROLL unpinned, calendar quote altered by one letter. All five were caught.
- [x] TEST-PLAN and the test manual: T-355..T-358.
- [ ] Full suite green, PR, CI, merge, production verification (see the log below).

## Things found while building (honest list)

- The main banking page imported the tab component but never rendered it. ESLint (`no-unused-vars`) caught it; fixed.
- Feeding every real message producer through the explainer found three payroll guardrail messages (duplicate amount, amount ceiling,
  self-approval) that the explainer called "unknown". Rules added; the test now fails if a producer is ever unexplained.
- Nacha's `PAYROLL` rule (2026-03-20) was not pinned in payroll. Fixed.
- A string-quote slip in one help sentence broke the lifecycle module's parsing; the first full run caught it (2 suites failed to load),
  it was fixed, and the suite is re-run.

## Not done on purpose

- R90 (new return code, 2028-03-17) is on the rule watch, not coded: the tests pin 20 codes and the rule is 17 months away.
- Same Day ACH $10M limit (2027-09-17), the character-set rule (2027-01-01): on the watch list; the reminder fires 60 days ahead.
- Nothing here changes who is paid or how much; every new surface reads, except "Mark done" which writes one settings row.
- LlamaParse v2: not worth moving now. The v1 endpoint "remains available for the foreseeable future" and new features are v2-only;
  revisit when a v2-only feature is wanted.
- The sandbox could not open www.greenwaymarijuana.com (TLS refused from here), so the custom domain was not checked from this machine.
