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
- **Status:** done
- **Notice:** https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20
- **Impact on Greenway:** Until G-71e, CI (.github/workflows, 3 jobs) built and tested on Node 20, which reached end of life on 2026-04-30, so CI tested on a different Node than production ran.
- **Action:** G-71e (owner message 14): package.json and merch-site/package.json set engines.node 24.x, every CI job reads its Node from package.json (node-version-file), and tests/compliance/g71e-version-pins.test.ts fails if a Node literal comes back.

### vercel-node20

- **Vendor:** vercel
- **Title:** Node.js 20 disabled for new Vercel builds and functions
- **Deadline:** 2026-10-01
- **Status:** done
- **Notice:** https://vercel.com/changelog/node-js-20-is-being-deprecated
- **Impact on Greenway:** Production deployments after 2026-10-01 succeeded (for example R-RET e1c8da0b on 2026-10-31), so production was already off Node 20, but the version lived only in Project Settings.
- **Action:** G-71e: engines.node is 24.x in both package.json files; Vercel reads it and it overrides Project Settings, so the version is in the repo and changes only by pull request.

### github-actions-node20

- **Vendor:** github
- **Title:** GitHub Actions runners removed Node 20 for JavaScript actions
- **Deadline:** 2026-09-23
- **Status:** done
- **Notice:** https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners
- **Impact on Greenway:** CI used actions/checkout@v4 and actions/setup-node@v4, which kept working after the removal (G-71a run 41260189512) because the runner forced them onto Node 24.
- **Action:** G-71e: moved to actions/checkout v7.0.1 and actions/setup-node v7.1.0 (both run on node24), pinned to commit SHAs; Dependabot proposes newer versions monthly.

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
- **Action:** Dependabot opens the upgrade PR (weekly, grouped minor and patch; G-71e). Read the 16.x release notes, then follow standing rule 17 (re-author, full CI gate, rebase-merge, verify production).

### npm-12-install-scripts

- **Vendor:** nodejs
- **Title:** npm 12 blocks dependency install scripts unless allowScripts approves them
- **Deadline:** none
- **Status:** watch
- **Notice:** https://github.com/npm/cli/blob/latest/CHANGELOG.md
- **Impact on Greenway:** Node 24 ships npm 11.19.1, which still runs install scripts and only warns (checked in G-71e: esbuild, sharp and unrs-resolver are listed). npm 12 blocks them by default, so each one must be approved or proven unnecessary first.
- **Action:** Before moving to a Node or npm that bundles npm 12: add an allowScripts policy to package.json (npm install-scripts approve) and prove npm ci plus next build in the same PR.

### nodejs-24-eol

- **Vendor:** nodejs
- **Title:** Node.js 24 end of life (production and CI run 24.x)
- **Deadline:** 2028-04-30
- **Status:** watch
- **Notice:** https://nodejs.org/en/about/previous-releases
- **Impact on Greenway:** G-71e pinned 24.x: LTS since 2025-10-28, maintenance until 2028-04-30. Node 26 became LTS only on 2026-10-28 (Vercel's default for new projects); 24 has a year of LTS fixes and is the Node GitHub's runners use for actions.
- **Action:** Move to 26.x in its own slice after 26 has had some months of LTS fixes: change PRODUCTION_NODE_MAJOR in version-pins-core.ts and engines.node in both package.json files, run the full CI gate.
