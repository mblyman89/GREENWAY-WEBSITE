# Platform changes register

Vendor changes (Supabase, Vercel, Next.js, GitHub Actions, Node.js) that could affect Greenway, what each one means for us, and what to do. Slice G-71b, owner message 12, standing rule 16.

The source of truth is `src/lib/platform/platform-changes.ts`. This file mirrors it so the register can be read on GitHub; `tests/compliance/g71b-platform-changes.test.ts` fails if an entry is in one and not the other, or if the reviewed-on dates differ.

**Last reviewed:** 2026-10-31

## How the review works

Once a month the daily platform-health run (about 6:25am Pacific) emails staff the review: what is open, what is due, and the sources below. Each open item with a deadline also gets an email 30 days, 7 days and 1 day before, and one when it is overdue. Every email is claimed in `compliance_reminder_log` first, so it is sent once.

At each review: read every source, add anything new that touches the database, hosting, runtime or CI, set its status, update this file and the .ts register together, and move `REGISTER_REVIEWED_ON` to today. An `action-needed` item becomes a slice before its deadline.

Statuses: `action-needed` (we must change something), `watch` (may affect us, check again), `not-affected` (checked, does not apply), `done` (handled).

## Sources

- [Supabase changelog, breaking changes](https://supabase.com/changelog?types=breaking-change)
- [Supabase changelog, deprecations](https://supabase.com/changelog?types=deprecation)
- [Vercel changelog](https://vercel.com/changelog)
- [Next.js support dates](https://endoflife.date/nextjs)
- [Next.js releases](https://github.com/vercel/next.js/releases)
- [GitHub changelog, Actions](https://github.blog/changelog/label/actions/)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)

## Register

### supabase-no-auto-expose

- **Vendor:** supabase
- **Title:** New tables and functions no longer granted to the API roles automatically
- **Deadline:** 2026-10-30
- **Status:** done
- **Notice:** https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- **Impact on Greenway:** Broke customer returns (R-RET, owner message 10): 0308 revoked record_customer_return and the server role lost it.
- **Action:** 0330 granted the server role everything it needs; 0331 and the daily Platform health check catch any new gap; standing rule 15 makes every migration write its own grants.

### supabase-tls12-cbc-ciphers

- **Vendor:** supabase
- **Title:** Four old TLS 1.2 CBC ciphers removed from project HTTP APIs
- **Deadline:** 2026-11-10
- **Status:** watch
- **Notice:** https://supabase.com/changelog/cbc-tls-ciphers-deprecated
- **Impact on Greenway:** Only clients on end-of-life systems are affected. The server (Vercel, Node) and the store iPads negotiate modern ciphers. Supabase emails owners of projects that used the old ciphers.
- **Action:** If Supabase emailed the owner about this project, or a device stops reaching the back office after Nov 10, update that device's OS.

### supabase-pg-15-19-minor

- **Vendor:** supabase
- **Title:** Postgres 15.19 / 17.11 minor upgrade (ltree, pgcrypto legacy ciphers, btree_gist on floats, custom operators)
- **Deadline:** none
- **Status:** not-affected
- **Notice:** https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes
- **Impact on Greenway:** Checked: no ltree, no pgp_sym/pgp_pub encryption, no custom operators. The one btree_gist index (pay_periods_no_overlap_excl, 0197) covers text and daterange, not float.
- **Action:** none

### supabase-extension-version-ignored

- **Vendor:** supabase
- **Title:** CREATE/ALTER EXTENSION ... VERSION is ignored
- **Deadline:** 2026-08-05
- **Status:** not-affected
- **Notice:** https://supabase.com/changelog/extension-version-pinning-ignored
- **Impact on Greenway:** Checked: no migration names an extension version.
- **Action:** none

### supabase-realtime-schema-locked

- **Vendor:** supabase
- **Title:** The realtime schema can no longer be changed
- **Deadline:** none
- **Status:** not-affected
- **Notice:** https://supabase.com/changelog/realtime-schema-locked-down-against-modification
- **Impact on Greenway:** Checked: no migration creates or alters objects in the realtime schema.
- **Action:** none

### supabase-js-node20

- **Vendor:** supabase
- **Title:** supabase-js drops Node.js 20
- **Deadline:** 2026-06-30
- **Status:** action-needed
- **Notice:** https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20
- **Impact on Greenway:** CI (.github/workflows, 3 jobs) still builds and tests on Node 20, which reached end of life on 2026-04-30. Production on Vercel is not on Node 20 (see vercel-node20). CI therefore tests on a different Node than production runs.
- **Action:** Move CI to the Node major production uses (22 or 24) and pin it in package.json engines (item 5, version pinning).

### vercel-node20

- **Vendor:** vercel
- **Title:** Node.js 20 disabled for new Vercel builds and functions
- **Deadline:** 2026-10-01
- **Status:** not-affected
- **Notice:** https://vercel.com/changelog/node-js-20-is-being-deprecated
- **Impact on Greenway:** Production deployments after 2026-10-01 succeeded (for example R-RET e1c8da0b on 2026-10-31), and Vercel says a project on 20 errors on every new deployment, so production is on 22 or 24. package.json has no engines field, so the version lives only in Project Settings.
- **Action:** Pin engines.node in package.json so the version is in the repo, not the dashboard (item 5).

### github-actions-node20

- **Vendor:** github
- **Title:** GitHub Actions runners removed Node 20 for JavaScript actions
- **Deadline:** 2026-09-23
- **Status:** not-affected
- **Notice:** https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners
- **Impact on Greenway:** CI uses actions/checkout@v4 and actions/setup-node@v4 and is green after the removal (G-71a run 41260189512), so the runner runs them on Node 24.
- **Action:** When a major version of these actions is released, move to it in its own PR.

### nextjs-15-eol

- **Vendor:** nextjs
- **Title:** Next.js 15 security support ends
- **Deadline:** 2027-01-31
- **Status:** not-affected
- **Notice:** https://endoflife.date/nextjs
- **Impact on Greenway:** Greenway runs Next.js 16 (16.2.9), which is the supported line.
- **Action:** none

### nextjs-16-patches

- **Vendor:** nextjs
- **Title:** Next.js 16 patch releases (security fixes ship as patches)
- **Deadline:** none
- **Status:** watch
- **Notice:** https://github.com/vercel/next.js/releases
- **Impact on Greenway:** Installed 16.2.9; the latest 16.x was 16.4.3 on 2026-10-23. Patch releases carry security fixes.
- **Action:** Each monthly review: read the 16.x release notes for security fixes; take them in a slice with the full CI gate (item 5).
