# Regulatory Watch — Future-Compliance Command Center (SLICE 37)

> **Owner directive (2026):** funnel WA LCB newsletter emails into the back office;
> have the AI read and interpret them, follow links to RCW/WAC changes and proposed
> rules, and stay ONE STEP AHEAD of regulatory requirements — producing a strategy
> and roadmap for updating the codebase when rules change. Dedicated page, clean,
> powerful, insightful. "My license and livelihood depend on my remaining compliant."
>
> Everything below was verified against live sources during the SLICE 37 research
> pass (NEVER GUESS). This is operational guidance, not legal advice.

---

## 1. How Washington cannabis rules actually change (verified)

Rulemaking is governed by the Administrative Procedure Act (**chapter 34.05 RCW**).
Every LCB rule change moves through a public paper trail filed with the Code
Reviser and published in the **Washington State Register** (WSR numbers look like
`WSR 26-14-119` = year 26, issue 14, filing 119):

| Stage | Form | What it means for Greenway |
|---|---|---|
| Preproposal | **CR-101** | LCB announces it is *considering* rules. Earliest signal — months of runway. Informal comments open. |
| Proposal | **CR-102** | Draft rule text + public hearing + formal comment window. LCB must adopt (CR-103) within 180 days or it dies. This is when the final shape is knowable. |
| Adoption | **CR-103** | Final rules filed; effective **31 days after filing** unless stated otherwise. Compliance clock starts. |
| Expedited | **CR-105** | Skips the hearing; adopted after a 45-day objection window. Less runway. |
| Emergency | **CR-103E** | Effective **immediately**, lasts 120 days. Zero runway — highest alert. |

Legislation feeds the pipeline: session laws (e.g. EHB 2681 license fees, ESB 5206
retail advertising, ESSB 5403 retail financial-interest agreements) direct the LCB
to write implementing rules, which then flow through CR-101 → CR-102 → CR-103.

### Where the signals are published (all verified live)

1. **GovDelivery email bulletins** — the newsletter the owner subscribes to.
   Bulletins live at `content.govdelivery.com/bulletins/gd/WALCB-<id>` as plain
   HTML with the full text and direct links (WAC cites at `app.leg.wa.gov/WAC/…`,
   bill summaries, CR/WSR PDFs on lcb.wa.gov).
2. **GovDelivery widget feed** — `content.govdelivery.com/accounts/WALCB/widgets/`
   `WALCB_WIDGET_1/0.json` returns the most recent bulletins as JSON
   (`subject`, `pub_date`, `href`). **This makes the whole system work without
   waiting for email** — a daily poll catches every bulletin.
3. **Current Rulemaking Activity** — `lcb.wa.gov/laws/current-rulemaking-activity`,
   the per-project inventory (stage, WSR numbers, comment deadlines, documents).
4. **Recent Rulemaking Activity** — `lcb.wa.gov/rules/recent-rulemaking-activity`,
   chronological board actions (CR approvals, petitions granted/denied).
5. **Enforcement bulletins / interim policies / policy statements / board
   meetings** — lower-frequency pages, watched as registry entries.
6. **Law text** — `app.leg.wa.gov/WAC/default.aspx?cite=314-55-XXX` (current WAC),
   `app.leg.wa.gov/RCW/…` (statutes), `lawfilesext.leg.wa.gov` (session laws).
   No official RSS feed exists for LCB rulemaking (probed and 404'd), so polling
   the widget JSON + pages is the honest mechanism.

Comments go to **rules@lcb.wa.gov** — comment windows are *opportunities*, and the
command center surfaces them as deadlines so Greenway can weigh in before rules
harden.

---

## 2. Architecture (what this slice builds)

Three ingestion paths → one deterministic extraction layer → one AI analyst →
a strategy/roadmap surface on a dedicated page.

```
GovDelivery widget JSON  ─┐  (daily cron poll — no email needed)
LCB bulletin emails      ─┼→ regulatory_items ─→ deterministic extraction
Manual paste / URL       ─┘        │              (citations, stage, dates)
                                   ▼
                        AI analyst (generateJSON)
                     grounded in the COMPLIANCE SURFACE MAP
                                   │
                    regulatory_analyses (summary, stage,
                    impact, deadlines, strategy, roadmap)
                                   │
                    regulatory_roadmap_items (owner accepts →
                    trackable task list for future slices)
```

### 2.1 Data model — migration `0137_regulatory_watch.sql` (manual apply)

* **`regulatory_sources`** — the watch registry (seeded: GovDelivery widget,
  current/recent rulemaking pages, enforcement bulletins, interim policies,
  policy statements). Tracks `last_checked_at` + content hash for change alerts.
* **`regulatory_items`** — one row per bulletin/notice/document. Unique on
  `(source_key, external_id)` so cron re-runs and email + poll overlap dedupe
  cleanly. Holds raw text, extracted citations/links (jsonb), review status.
* **`regulatory_analyses`** — the AI's read: plain-English summary, rulemaking
  stage, impact level, affected compliance areas, deadlines, strategy, proposed
  roadmap steps. Model id recorded for provenance.
* **`regulatory_roadmap_items`** — the actionable task list. Proposals become
  accepted tasks the owner tracks to done (proposed → accepted → in_progress →
  done / dismissed).

All four tables get RLS (staff read; writes via service role / server actions),
matching GW-019 discipline.

### 2.2 Deterministic layer (pure, self-tested)

`src/lib/regulatory/regulatory-core.ts` — no I/O, wired into the pure-test runner:
* `parseGovDeliveryWidget()` — parse the JSONP feed into items.
* `extractCitations()` — WAC / RCW / WSR / bill-number regexes.
* `classifyStage()` — CR-101/102/103/103E/105/petition/enforcement heuristics.
* `extractDates()` — comment deadlines + effective dates.
* `linkForCitation()` — deep links into app.leg.wa.gov.
The AI **refines** these; it never replaces them. Numbers and cites shown in the
UI come from the deterministic layer, so nothing on screen is hallucinated.

### 2.3 The compliance surface map (what feeds the AI)

`src/lib/regulatory/compliance-surface.ts` — a static, reviewed map from citation
→ what Greenway runs on it (area, the real modules, why it matters). Seeded from
`docs/COMPLIANCE_BIBLE.md`, `docs/INVENTORY_COMPLIANCE_WA.md`,
`docs/PROMOTIONS_COMPLIANCE.md`, `docs/EMPLOYEE_COMPLIANCE.md`. Examples:
WAC 314-55-155 → advertising/labels → copy guardrails + promotions;
314-55-087 → recordkeeping → CCRS command center + retention;
RCW 69.50.360 → sales limits → the register's sales-limit gate.
When a bulletin cites a WAC, the analyst is TOLD which modules are on the hook —
so its roadmap points at the actual code that would change.

### 2.4 Ingestion

* **Cron** — `/api/cron/regulatory-watch` added to `vercel.json` (Hobby allows
  100 daily crons; verified). Polls the widget JSON, fetches new bulletin pages,
  ingests + extracts, and runs AI analysis for cannabis-relevant items
  (keyword-gated to respect the AI budget). Secured exactly like the existing
  compliance-reminders cron (CRON_SECRET, fail closed in production).
* **Email funnel** — the existing inbound-email webhook (Slice 99) learns a
  second mailbox (`REGULATORY_MAILBOX`, default `lcb-watch`): forwarded LCB
  bulletins are logged and ingested as regulatory items. Same signature/token
  security; drafts-only.
* **Manual** — on-page server actions: paste a bulletin's text, or drop in a
  URL to fetch. This works on day one with zero email/DNS setup.

### 2.5 The page — `/admin/compliance/regulatory` ("Regulatory Watch")

Nav: CCRS group, `reports.view`. Sections:
1. **Pulse header** — new items, open comment windows, upcoming effective dates,
   open roadmap tasks.
2. **Deadline timeline** — every extracted comment deadline + effective date,
   soonest first, color-coded by urgency.
3. **Intake inbox** — items with stage + impact badges; expand for the AI
   briefing (summary, what it means for Greenway, strategy, citations deep-linked
   to the law).
4. **Roadmap board** — accepted tasks with status flips; this list is exactly
   what the owner hands to the AI ("build slice N for this rule change").
5. **Sources panel** — the registry with last-checked stamps + check-now button.
6. **Manual ingest** — paste/URL form. A 0137 setup notice renders until the
   migration is applied (42P01 graceful, standing pattern).

### 2.6 Guardrails

* **Advisory only.** Nothing here changes store behavior automatically; analyses
  and roadmaps are drafts a human reviews (standing DRAFTS-ONLY rule).
* AI unavailability degrades gracefully (`isAiConfigured` false → deterministic
  extraction still works; UI says AI is off).
* Every analysis records the model id; the usage ledger logs cost.
* No legal advice — the UI says so, and points at rules@lcb.wa.gov for comments.
