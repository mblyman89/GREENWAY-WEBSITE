# GREENWAY-WEBSITE

Greenway Marijuana website built with Next.js.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Build

Create a production build:

```bash
npm run build
```

## Deploy on Vercel

Import this repository into Vercel as a Next.js project. Use the default Vercel settings:

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank/default

The current development preview uses a smaller sampled POS menu dataset so the site can deploy and be inspected reliably while preserving the full POS preview data in the repository for later integration work.

## Key documents (start here)

| Document | What it is |
|---|---|
| [**`SAGE_50_WHAT_TO_SEND_ME.md`**](./SAGE_50_WHAT_TO_SEND_ME.md) | **Owner checklist — the 7 files to export out of Sage 50, with the exact menu path for each.** No rush; gathered while the app is battle-tested. |
| [**`IRS_MISSING_RECORDS_AND_SAGE_SEPARATION.md`**](./IRS_MISSING_RECORDS_AND_SAGE_SEPARATION.md) | **How the IRS treats missing records (Cohan, and the *Alterman* dispensary case), plus the plan to split the four books out of one Sage chart.** Read before the cut-over. |
| [`BATTLE_PLAN.md`](./BATTLE_PLAN.md) | The full-system battle plan — how every branch gets tested to destruction, in six phases. |
| [`BATTLE_PLAN_STAGING_SETUP.md`](./BATTLE_PLAN_STAGING_SETUP.md) | How to build the staging site the battle plan runs against. Read before the battle plan. |
| [`docs/security/IS-ADMIN-AUDIT-REPORT.md`](./docs/security/IS-ADMIN-AUDIT-REPORT.md) | Security audit of the admin access-control model, with findings and a remediation roadmap. |
| [`AGENTS.md`](./AGENTS.md) | Engineering rules of the road for this repository. |
| [`todo.md`](./todo.md) | Live build plan and standing rules. |
