# Greenway Back Office — Full-Scope Audit & Recommendations

**Prepared for:** Owner, Greenway Marijuana (Port Orchard, WA — I-502 retailer)
**Date of audit:** main @ `2bf499e` (post Slice 42)
**Goal of the build:** Replace Cultivera (~$5,000/yr) with a Wix/Squarespace-style back
office that non-technical employees can run, on a locked Supabase backend.

---

## 1. The one-paragraph summary

You have built a genuinely large, coherent retail-operations platform: **49 database
migrations, 77 admin pages, and 36 feature libraries** spanning POS import, inventory and
lots, compliance (CCRS, excise, sales limits, medical/DOH), purchasing, registers/drawers,
staffing/timeclock, loyalty, promotions, a full CMS/blog/SEO surface, accounting export
(Sage 50), a reporting suite, and now two live menu-syndication integrations (Leafly v2 and
WeedMaps 2025-07) with AI drafting that is always "drafts-only." The foundation is strong and
the architecture is consistent. The gaps that remain are **not "more features"** so much as
**three hardening themes**: (1) it has almost no automated test coverage, (2) several
power-features are gated on credentials/owner actions that haven't been turned on yet, and
(3) it has never been load/break-tested by a real user. This report inventories what exists,
then lays out *need / should-have / could-have* with clear priorities.

---

## 2. What is actually built (fact-grounded inventory)

### 2.1 Core platform
| Area | What exists | Evidence |
|---|---|---|
| **Auth & roles** | Role model (owner / admin / manager / staff) with rank, labels, descriptions; ~20 fine-grained permissions (`inventory.manage`, `settings.manage`, `menu.publish`, etc.); per-action audit log. | `src/lib/auth/*`, `/admin/audit`, `/admin/users` |
| **POS import** | Cultivera/POS data transform pipeline + menu-import flow with versioned, publishable menus. | `scripts/pos/transform_pos_data.ts`, `/admin/menu-imports`, `src/lib/pos/menu-version.ts` |
| **Products & catalog** | Product records, product *masters*, bulk AI enrichment, catalog drafts, image substitutes. | `/admin/products`, `/admin/products/masters`, `/admin/products/bulk-ai` |

### 2.2 Inventory & compliance (the regulated core)
| Area | What exists |
|---|---|
| **Inventory** | Inventory items, lots, intake, drafts, **cycle counts**, **disposition/returns/destruction/samples**, category types. |
| **Compliance** | **CCRS license export**, **CCRS lot external id**, **excise return**, **sales limits**, **manifest source + transport**, **COA/potency** (with archive). |
| **Medical** | **DOH medical** endorsement, medical card handling. |
| **Tax** | Tax settings, base mode, per-jurisdiction handling feeding receipts + accounting. |

### 2.3 Front-of-house operations
| Area | What exists |
|---|---|
| **Registers** | Registers + cash drawers, register history. |
| **Receipts** | Receipt printing + printer settings (migration 0047). |
| **Orders** | Order management, order detail, **printable tickets**. |
| **Customers** | Customer records, import, detail, new-customer flow. |
| **Staffing** | Employees + **timeclock** (migration 0037). |
| **Loyalty** | Loyalty engine, signups, email opt-out, reporting. |
| **Promotions** | Promotions + a **promotion simulator**. |
| **Equipment** | Equipment/asset register. |

### 2.4 Marketing / web surface
- Full **CMS**: pages, page sections, home carousel, media library, SEO/metadata, blog with
  revisions and typography, FAQ items, newsletter sends.

### 2.5 Integrations & reporting
- **Sage 50 accounting export** (balanced General Journal CSV; no API needed).
- **Leafly Menu API v2.0** — OAuth2, preview/dry-run, POST full-sync / PUT upsert, status,
  AI description drafter (drafts-only). (Slice 40)
- **WeedMaps Menu API 2025-07** — verified auth, preview/dry-run, POST push, menu-access
  verify, image PATCH, retry/backoff, scope inspection, AI drafter. (Slices 41–42)
- **Syndication logs** for both channels.
- **Reports suite**: sales, tax, excise, COGS, accounting, compliance, customers, employees,
  loyalty, medical.

### 2.6 AI infrastructure
- Central provider with structured/JSON generation, a schema system, a **compliance gate**
  (`COMPLIANCE_SYSTEM`, `checkCompliance`), an **AI usage ledger**, and suggestion provenance.
- **Standing rule honored everywhere:** every AI output is a *draft* that an employee
  validates before it is published or pushed.

---

## 3. Health check — what's solid vs. what's thin

**Solid 🟢**
- Consistent architecture (pure `*-core` logic + server modules; one PR per slice).
- Real regulatory coverage (CCRS, excise, sales limits, medical/DOH) — this is the hard part
  and it's largely present.
- Money in minor units; idempotent migrations; RLS helpers (`is_staff`, `is_admin`).
- Integrations grounded in *authoritative source docs*, with honest "do-not-guess" flags.
- Audit logging on sensitive actions.

**Thin / unverified 🟠**
- **Automated tests:** only one Playwright smoke spec (`e2e/smoke.spec.ts`, ~97 lines) plus
  the per-module pure unit tests run ad-hoc via `tsx`. There is **no CI gate** and **no broad
  regression suite**. This is the single biggest risk before "break testing."
- **Migrations 0047–0049 are not yet applied** in Supabase (owner-run). Until applied,
  receipt printing, purchase orders, and *both* syndication logs won't persist.
- **Live integration credentials** (Leafly key + OAuth; WeedMaps menu id + OAuth) are not yet
  set, so the live push paths have never executed against the real APIs.
- **No documented backup/restore or disaster-recovery runbook.**
- **No rate-limit / abuse protection** on AI endpoints beyond the usage ledger.

---

## 4. Recommendations — Need / Should-have / Could-have

### 4.1 🔴 NEED (do before you try to break it / go live)
1. **Apply migrations 0047, 0048, 0049** in the Supabase SQL editor. Nothing below the receipt/
   PO/syndication features truly works until these exist.
2. **Set the integration secrets** (Leafly + WeedMaps) in the environment and run **one preview
   then one live push each** against sandbox/real menus to confirm the wire format end-to-end.
3. **A real regression test pass.** At minimum: a Playwright happy-path suite covering login,
   menu import → publish, an order, a register open/close, and one report. Add a **CI workflow**
   (GitHub Actions) that runs `tsc`, `eslint`, `next build`, and the e2e smoke on every PR so
   nothing silently regresses while you keep building.
4. **Backup/restore runbook.** Document (and test once) a Supabase point-in-time restore and an
   export of the critical tables. A retailer cannot lose inventory/compliance data.
5. **Role/permission review with real staff names.** Confirm a budtender cannot reach
   `settings.manage`, `users.manage`, or compliance exports; confirm managers can.

### 4.2 🟡 SHOULD HAVE (clear operational value, low controversy)
1. **Error visibility for staff.** A simple "Integration health" panel that surfaces recent
   syndication-log errors and the last successful push time (you already record the logs —
   surface them prominently). Tie WeedMaps' 423-paused / 401-scope messages to plain-English
   guidance.
2. **Scheduled menu sync.** Right now pushes are manual. A nightly (or on-publish) automatic
   push to Leafly/WeedMaps with a visible "last synced" stamp removes a daily chore. Keep a
   manual override.
3. **WeedMaps Orders API (2026-01).** You already documented it (HMAC callbacks, order
   statuses). Online ordering through WeedMaps is a revenue feature, not just a menu mirror —
   worth a dedicated slice once menu sync is proven live.
4. **Image pipeline for menu items.** WeedMaps supports one image per item (you built the PATCH
   path). Wire product images from your media library into the push so menus look complete.
5. **Reporting exports + scheduling.** Let staff export any report to CSV/PDF and optionally
   email a daily/weekly summary (sales, excise due, low stock).
6. **Low-stock / reorder alerts** feeding the purchasing module (you have POs and inventory —
   connect them with a reorder threshold).
7. **Data validation guardrails** on import (e.g., flag items missing category/price/COA before
   they can be published or pushed).

### 4.3 🟢 COULD HAVE (nice, future, or competitive polish)
1. **Customer-facing online menu/store** rendered from the same published menu version (you
   have the CMS + menu engine; this is mostly presentation).
2. **Dashboards/analytics home** — a single landing screen with today's sales, drawer status,
   sync health, and compliance flags.
3. **Two-factor auth** for owner/admin logins.
4. **Audit-log search/filter UI** and retention policy.
5. **Mobile-friendly POS/register view** for tablet use at the counter.
6. **Vendor/brand self-service portal** (low priority).
7. **Additional accounting targets** (QuickBooks export) if you ever leave Sage 50.

---

## 5. Suggested sequence (matches our roadmap)

1. **You:** apply 0047–0049; set Leafly/WeedMaps secrets. *(Need #1, #2)*
2. **Me:** add the CI workflow + a focused Playwright happy-path suite. *(Need #3)*
3. **Me:** integration-health panel + scheduled sync + menu images. *(Should #1, #2, #4)*
4. **You:** break-test the whole thing; log anything that breaks.
5. **Me:** fix what you find + final **back-office beautification round** (declutter,
   consistent colors/buttons/styles, easy navigation).
6. **Later slice:** WeedMaps Orders API for true online ordering. *(Should #3)*

---

## 6. Bottom line

The platform is **broad and well-built**; it already does the genuinely hard regulated-retail
work. To turn it into the "all-inclusive powerhouse," the priority is **not more features —
it's proving it works**: turn on the three pending migrations and the integration credentials,
add a real automated-test safety net with CI, and document backups. After that, the
should-have list (sync automation, health visibility, online ordering, images, alerts) is what
will make it feel like a product rather than a toolkit — and the final beautification round
ties it together for everyday staff use.
