# Bible Chapter 14 — Auth & Admin Permissions (Who Can Do What, and How We Know)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` plus this branch's docs-only commits
> (every file:line anchor re-checked on that tree — if a line looks off, the
> file changed after this chapter was written; re-verify before trusting).
> **Plain-English promise of this chapter:** there are two separate worlds of
> identity. The **back office** (your laptop) uses real Supabase accounts —
> email + password, optionally a Face ID / Touch ID passkey — and every screen
> and button is gated by a small, readable permission matrix. The **sales
> floor** (the iPads) uses two keys together: a provisioned **device key**
> (identifies the iPad) and an employee **PIN** (identifies the human) — a
> stolen PIN is useless without a provisioned device, and vice versa. PINs and
> device keys are stored only as salted scrypt hashes, wrong guesses lock the
> pad, and every meaningful action writes an append-only audit row.

---

## 1. The big idea in one paragraph

Every admin page and server action starts the same way: `requirePermission`
(`src/lib/auth/session.ts:81–84`) loads the signed-in staff profile and checks
one named permission against a single, explicit role→permission matrix
(`src/lib/auth/roles.ts:69–103`). No page invents its own rule; if the role
isn't listed for that permission the user is bounced to the dashboard with a
"denied" flag (:83). Underneath, the database has its own second wall — Row
Level Security policies keyed to `is_staff()` / `is_admin()` helper functions
(`supabase/migrations/0001_slice1_foundation.sql:133–136`, :138–144) — so even
a bug in the app can't hand table data to a non-staff session. On the register
side there are no Supabase accounts at all: the iPad proves itself with a
device key checked by `authenticateDevice`
(`src/lib/pos/sync-store.ts:108`), the human proves themselves with a PIN
verified through salted scrypt, and a durable brute-force throttle locks the
pad after five wrong guesses.

---

## 2. The back-office session (`src/lib/auth/session.ts`)

- `getStaffSession` (:21) asks Supabase who is signed in, loads their
  `staff_profiles` row, and returns **null unless the profile exists and is
  active** (:68) — deactivating someone cuts off the back office on their
  very next request.
- **First-login bootstrap** (:34–66): if the signed-in email is on the
  configured bootstrap list and isn't already an active owner (:37–40), the
  service-role client promotes it to `owner` — this is how the store's first
  account comes to life without hand-editing the database. It is best-effort
  and idempotent.
- `requireStaff` (:74–78) redirects anonymous visitors to `/admin/login`;
  `requirePermission` (:81–84) additionally checks the matrix and bounces
  unauthorized roles to `/admin?denied=1`.
- The login page itself (`src/app/admin/login/page.tsx`) redirects
  already-signed-in staff straight to the dashboard (:10–11) and tells
  everyone else "This is a private system. All activity is logged." (:28).
- `src/middleware.ts` deliberately does **not** enforce access — its header
  says so (:1–3): it only refreshes the Supabase session cookie on
  `/admin/:path*` requests (matcher :40–42, the refresh touch :34–35) so
  Server Components always see a valid session. **Page-level guards are the
  enforcement**; the middleware is plumbing.

---

## 3. The permission matrix (`src/lib/auth/roles.ts`)

Six roles (labels :4–11, plain-English descriptions :13–20), ranked
most→least privileged for hierarchy checks (`ROLE_RANK` :23–30: owner 100,
admin 90, manager 70, content_editor 50, staff 30, readonly 10).
Twenty-three named permissions (`Permission` type :42–65) map to roles in one explicit
matrix (`MATRIX` :69–103) — the comment above it says why: "Higher roles
inherit by explicit listing to keep the matrix auditable and obvious"
(:67–68). `can(role, permission)` (:105–108) is the single yes/no function
everything calls.

Worth knowing by name:

| Permission | Who | Why it's scoped this way |
| --- | --- | --- |
| `dashboard.view` | everyone (:70) | Any active staff can see the landing page. |
| `orders.view` / `orders.manage` | owner/admin/manager/staff (:73–74) | Budtenders work the order queue. |
| `payables.manage` | owner/admin/manager (:83) | W10 owner decision: the purchase manager runs AP without inheriting user management (rationale :78–82). |
| `reports.view` | owner/admin/manager/**readonly** (:91) | The analyst role exists to read reports and nothing else. |
| `users.manage` | owner/admin only (:92) | Staff & role management. |
| `settings.manage` | owner/admin only (:93) | Store settings, payroll, banking. |
| `timeclock.use` | owner/admin/manager/staff (:98) | Task S-b: its own permission instead of piggybacking on loyalty.view (comment :95–97). |
| `sales_limit.override` | owner/admin/manager (:100–102) | Authorizing an OVER-LIMIT sale is a manager+ decision (Slice 109); regular staff cannot. |

The matrix is rendered for humans too: `PERMISSION_LABELS` (:111–135) and
`ALL_PERMISSIONS` display order (:138–162) feed the read-only visual
permission matrix on the Users page
(`src/components/admin/users/PermissionMatrix.tsx`, embedded at
`src/app/admin/users/page.tsx:353`); `rolesForPermission` (:168–170) hands it
a **copy** so the UI can never mutate the real matrix.

Two sharper helpers: `isAdminRole` (:172–174) and `isOwnerRole` (:180–182) —
the latter's comment (:176–179) reserves it for "owner-reserved controls …
that even admins should NOT be able to change," and it gates exactly that:
editing statutory sales limits
(`src/app/admin/compliance/sales-limits/page.tsx:35`) and vendor-sample
acknowledgements (`src/app/admin/compliance/samples/actions.ts:100`).

The over-limit override shows the pattern end-to-end: completing an order over
the statutory limit requires the separate permission **plus a written
reason** — `src/app/admin/orders/actions.ts:60–77` checks
`can(role, "sales_limit.override")` (:69) and refuses without a reason; the
pure completion gate documents that the caller owns the permission check
(`src/lib/orders/completion-gate.ts:25`, :60).

---

## 4. The second wall: RLS, and the audit pen

Supabase Row Level Security is the wall behind the wall. Migration 0001
defines `current_staff_role()` (:128–131), `is_staff()` (:133–136 — you exist
in `staff_profiles` AND are active), and `is_admin()` (:138–144 —
owner/admin), all `security definer` so policies can call them without
recursion; tables then attach policies like `for select using
(public.is_staff())` (:182, :187, :190–194). Deactivated staff fail
`is_staff()` immediately.

Every consequential action writes to the append-only audit log through one
function: `recordAudit` (`src/lib/auth/audit.ts:18`). It uses the
service-role client "so inserts always succeed regardless of RLS, while reads
remain staff-gated" (:1–2), stamps the caller's IP and user-agent (:21–26),
writes actor / action / entity / before / after (:29–39), and **never lets an
audit failure break the user's action** (:40–42).

---

## 5. Guard rails on the Users page (Task S-c)

The owner asked for the Users page to be "protected from malicious behavior"
while still letting him cut access fast. Four rules live in a pure,
self-tested module (`src/lib/auth/user-guards-core.ts`, rules spelled out in
the header :9–24):

1. **You can't touch yourself.** No changing your own role, no deactivating
   yourself (`guardRoleChange` self-check :65–67; `guardActiveChange`
   self-deactivate check :97–99) — this stops both accidental lockouts and a
   compromised session quietly promoting itself.
2. **You can't touch anyone ranked above you** (:68–70, :100–106) — an admin
   cannot demote or deactivate the owner.
3. **Privilege ceiling: you can't grant a role above your own**
   (`guardGrantRole` :43–50) — an admin cannot mint owners, closing the
   escalation hole; the same check applies to invites.
4. **The last active owner is untouchable** (:73–80, :107–109) — the store
   can never be locked out of its own back office.

The server actions (`src/app/admin/users/actions.ts`) enforce all of it
server-side behind `users.manage` (`updateUserRole` :41, gate :42;
`setUserActive` :98, gate :99; `inviteUser` :179, gate :180) — the UI hints
are convenience only. Every outcome is audited, **including refusals**:
`user.role.update.blocked` (:68), `user.role.update` (:85),
`user.activate/deactivate.blocked` (:123), `user.activate/deactivate` (:153),
`user.invite.blocked` (:191), `user.invite.failed` (:205), `user.invite`
(:221).

Deactivation is defense-in-depth (comment :140–146): besides flipping
`active=false` (which kills `getStaffSession` and `is_staff()` on the next
request), the action **bans the auth account** at the Supabase layer
(`ban_duration` :149, using `BAN_PERMANENT` ≈ 100 years / `BAN_LIFT` from
`user-guards-core.ts:32–33`) so token refresh and the raw Supabase APIs go
dark too; reactivating lifts the ban. The audit row records whether the ban
call itself succeeded.

The pure rules are pinned by `__runUserGuardTests`
(`user-guards-core.ts:117`), registered in the pure self-test runner
(`scripts/compliance/run-pure-selftests.ts:24`).

---

## 6. Passkeys: Face ID / Touch ID sign-in (S-19)

Passkeys are an **additional, hardware-bound sign-in path** — they do not
weaken email/password (stated in the verify route header,
`src/app/api/webauthn/authenticate/verify/route.ts:1–10`).

- The pure plumbing (`src/lib/auth/webauthn-core.ts`) is grounded against the
  SimpleWebAuthn v13 docs (header :6–13): `rpIdFromOrigin` (:16) derives the
  bare-hostname Relying Party ID, `normalizeOrigin` (:30) the full expected
  origin, transports round-trip as a validated CSV (:53, :62), and
  `isChallengeValid` (:71) refuses expired challenges (the header notes
  challenges are short-lived — "we use 5 minutes" — and single-use). It carries
  its own self-tests (`__runWebauthnCoreTests` :108).
- The store (`src/lib/auth/webauthn-store.ts`) makes challenges **single-use**
  — `consumeChallenge` reads AND deletes in one motion (:96–97) — and holds
  credentials keyed to the auth user (insert :176, counter update :204,
  owner-scoped rename :214 and delete :226).
- **Registering** a passkey requires a live staff session
  (`src/app/api/webauthn/register/options/route.ts:18`,
  `register/verify/route.ts:24`) and audits `auth.passkey.register`
  (:89–91).
- **Signing in** (`authenticate/verify/route.ts`) consumes the challenge
  (:45), looks up the presented credential (:51), refuses a credential that
  doesn't belong to the resolved account (:56), and verifies the assertion
  with `requireUserVerification: true` (:72) — the S-19 comment (:70–71)
  insists on a real biometric/PIN check, not mere presence. Only after a
  cryptographically valid assertion does it update the signature counter
  (:89) and mint a one-time Supabase magic-link token hash (:99) for the
  browser to exchange for a session; the login is audited as
  `auth.passkey.login` (:104–106). Tables arrive with migration
  `0058_webauthn_passkeys.sql`.

---

## 7. The sales floor, part 1: the iPad's own identity

Registers don't sign in — they are **provisioned**
(`src/lib/pos/device-store.ts`):

- `provisionDevice` (:78) mints a random 192-bit key (:88) and stores **only
  its scrypt hash** (:96); the plaintext is returned exactly once for the
  manager to type into the iPad ("shown ONCE, never stored, never
  retrievable" — :68). `rotateDeviceKey` (:109) re-mints (old key dies
  immediately); `revokeDevice` (:126) flips status; `bindDeviceToRegister`
  (:135) ties the iPad to a register.
- All four management actions require `staffing.manage` and write audit rows
  (`src/app/admin/registers/devices/actions.ts` — provision :26/gate
  :30/audit :40, rotate :52/:56/:61, revoke :72/:73/:78, bind :89/:90/:96).
- Every POS API call then authenticates the device first:
  `authenticateDevice` (`src/lib/pos/sync-store.ts:108`) requires a
  well-formed id + key (:110–112), an **active** row (:122–124), and a
  scrypt-verified key (:125–127), stamping a best-effort heartbeat (:128–133).
- On the iPad itself, `checkSetupCredentials`
  (`src/lib/pos/device-setup-core.ts:67`) cleans pasted credentials before
  the network call — trimming iPad-paste whitespace and even detecting the
  id/key pasted into each other's fields (`swapped`, :52–60). Self-tests
  :147, registered in the pure runner
  (`scripts/compliance/run-pure-selftests.ts:65`).

---

## 8. The sales floor, part 2: PINs, throttles, and the manager tap

**Hashing (S-10).** Clock PINs are salted scrypt hashes
(`src/lib/security/pin-hash.ts`): the header (:1–16) explains why a 4–6 digit
PIN must never be stored deterministically (10⁶ possibilities), `hashPin`
(:26) salts and hashes, `verifyPin` (:38) compares in constant time
(`timingSafeEqual` :47), and the `scrypt$` prefix (:19) lets legacy plaintext
rows coexist. `getEmployeeByPin` (`src/lib/staffing/store.ts:117`) fetches
the small active roster and verifies each candidate (doc :110–116); a legacy
plaintext match is **upgraded to a hash on the spot** (:130–137). (The
verify-each-candidate cost is recorded as finding **GW-004**.)

**Throttling (S-10 → AN-8).** Five failures in a 60-second window lock the
pad for 60 seconds. The policy math is pure
(`src/lib/security/pin-throttle-core.ts` — constants :29–31, state parsing
that refuses to trust garbage or future timestamps :23–26/:50,
`throttleBlockedMessage` :74, `recordThrottleFailure` :86, tests :106,
registered at `run-pure-selftests.ts:59`). The durable wrapper
(`pin-throttle-store.ts`) keeps one row **per physical entry point** —
`pos-device:<uuid>` per register pad, one shared `timeclock` scope
(`pin-throttle-core.ts:96–101`) — because a failed PIN identifies no
employee; that's the attack (:17–18). Its header (:7–20) states the fallback
posture: when the `pin_throttle` table is missing (migration **0123**, applied
manually by the owner) or a read/write fails, every function falls back to
the legacy in-memory window (`pin-hash.ts:69/:78/:88`) so the pad is "NEVER
less protected than it was before AN-8." The serverless weakness of that
in-memory fallback is finding **GW-005** — one more reason to apply 0123.

**The entry points.** All PIN doors check the throttle before verifying and
record the outcome after:

- **Register unlock** (`src/app/api/pos/unlock/route.ts`): device key + PIN
  together — the header (:1–16) states the model: "PINs identify HUMANS; the
  device key identifies the IPAD. Both are required." Device auth :31,
  throttle check :42–44, employee resolve + failure/success notes :56–61,
  and a `register.unlocked` audit row on every unlock (:68–74). The response
  includes the employee's SAW **username only** — never a password (:83–85).
- **Manager approval** (`src/app/api/pos/approve/route.ts`): a second PIN
  authorizes register exceptions (today the audited no-sale drawer open).
  Same device auth (:32) + shared throttle (:37–39), then a **role gate**:
  only `manager` or `lead` job roles may approve (`APPROVER_ROLES` :27,
  refusal :58–63). The response is the minimum the register needs (approver
  id + name); the deliberate absence of a second audit row here (:65–67) is
  because the approved event itself is validated + audited at sync with the
  approver's id inside it — one drawer open, one audit trail.
- **Time clock** (`src/app/admin/staffing/actions.ts`): the shared staffing
  pad checks the `timeclock` scope before verifying (:58, :92) and notes
  failure/success (:64, :67).

---

## 9. Findings from this pass

No new formal findings. Existing findings that live in this chapter's
territory: **GW-004** (PIN lookup scrypt-verifies the whole active roster),
**GW-005** (durable throttle depends on migration 0123; in-memory fallback is
weaker on serverless), **GW-006** (the device key rests in plaintext
localStorage on the iPad). Three deliberate postures worth naming:

1. **Middleware refreshes, pages enforce.** `src/middleware.ts:1–3` is
   explicit that access control lives in the page/action guards
   (`requireStaff` / `requirePermission`), with RLS as the independent second
   wall. This is a coherent design, not a gap — but it means every NEW admin
   page must remember its `requirePermission` call; the Bible's per-area
   chapters verify existing pages one by one.
2. **Self-approval friction is role-shaped, not two-person.** The users-page
   guards stop self-promotion and self-deactivation, but a lone owner can
   still do everything else alone — consistent with a one-person business
   (compare chapter 13 §9.2 on payroll dual control).
3. **`__runWebauthnCoreTests` exists but is not registered** in
   `scripts/compliance/run-pure-selftests.ts` (verified: the only reference
   is its own definition, `webauthn-core.ts:108`). The pure helpers it covers
   are small and stable, but wiring it in is a one-line improvement worth
   folding into a future test-plan slice.

---

## 10. What SHOULD never happen (watchlist)

1. An admin page or server action reachable without its
   `requirePermission`/`requireStaff` call — the matrix only protects what
   asks it (`session.ts:74–84`).
2. A permission decision made anywhere except `can()` against the one matrix
   (`roles.ts:69–108`) — no page-local role lists.
3. An admin minting an owner, changing their own role, deactivating
   themselves, or demoting/deactivating the last active owner — the four
   guard-rail rules (`user-guards-core.ts:43–50/:65–80/:97–109`), enforced
   server-side and audited even when refused.
4. A deactivated account still working — profile `active=false` kills
   `getStaffSession` (:68) and `is_staff()`, and the Supabase ban
   (`users/actions.ts:147–150`) kills token refresh as defense-in-depth.
5. A passkey session issued without a cryptographically valid,
   **user-verified** assertion bound to the right account
   (`authenticate/verify/route.ts:56`, :72), or a challenge used twice
   (`webauthn-store.ts:96–97`).
6. A clock PIN or device key stored (or logged) in plaintext by the app — only
   `scrypt$` hashes persist (`pin-hash.ts:26–30`,
   `device-store.ts:96`); legacy plaintext PINs upgrade on first use
   (`staffing/store.ts:130–137`).
7. A PIN pad accepting unlimited guesses — every entry point checks the
   durable per-scope throttle first (`unlock/route.ts:42–44`,
   `approve/route.ts:37–39`, `staffing/actions.ts:58/:92`), falling back to
   the in-memory window, never to nothing.
8. A POS API call served without device authentication, or from a revoked
   device (`sync-store.ts:122–124`).
9. A register exception approved by a non-manager PIN
   (`approve/route.ts:27`, :58–63), or an over-limit order completed without
   the `sales_limit.override` permission plus a written reason
   (`orders/actions.ts:60–77`).
10. An employee's SAW password (or any password) riding in a register
    response — the unlock payload carries the username only
    (`unlock/route.ts:83–85`).
11. A role or permission change, invite, activation flip, device
    provision/rotate/revoke, or passkey register/login without an audit row —
    and an audit failure must never break the user's action
    (`audit.ts:40–42`).
12. Owner-reserved controls (statutory sales limits, vendor-sample
    acknowledgements) editable by a mere admin — `isOwnerRole` gates them
    (`roles.ts:176–182`).
