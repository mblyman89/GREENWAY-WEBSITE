# R66: Gemini 3.8 Flash and batch lookup parity

Branch `r66-gemini`. This round is about the onboarding page's **"Look up all N products on this manifest"** (the background batch lookup).

## The owner's request

The owner asked for four things:

1. Move from Gemini 3.7 Flash to **3.8 Flash**, and make future model upgrades easy.
2. The batch was *"far far less effective at finding and presenting product facts than the ai lookup feature on the products row"*. Find out whether that is a time problem or a bug, and make the batch **as good as or better** than the row lookup. Time is no issue: *"data is gold to me"*.
3. Make the batch panel refresh itself, and add an estimated time to finish and a progress bar.
4. Do deep research on Gemini, using both the official docs and community reports. Test heavily, because this is a vital pipeline.

## 1. Research (read 2026-10-16)

### Official Google docs

**3.7 Flash is deprecated.** From the 3.7 Flash model page: *"Gemini 3.7 Flash (`gemini-3.7-flash`) is deprecated and has been replaced by Gemini 3.8 Flash"*. The 3.8 Flash page says the old id is *"automatically routed to `gemini-3.8-flash`"*. So a project still set to 3.7 is already being answered by 3.8, but the old id should not be relied on.
- Sources: <https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash>, <https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash>

**Thinking.** Gemini 3.x uses `thinking_level`. 3.8 Flash accepts `low`, `medium` and `high`, with `medium` as the default. It has **no `minimal`**, and older Flash models do. Thinking tokens count against `max_output_tokens`, and the synchronous cap is **65,536** tokens.
- Sources: <https://ai.google.dev/gemini-api/docs/generate-content/thinking#thinking-levels>, <https://ai.google.dev/gemini-api/docs/thinking#token-limits>

**Interactions API.**
- A reply that hits the output ceiling comes back with status **`incomplete`**. It is billed, and its answer is cut short.
- Usage is reported as `total_input_tokens`, `total_output_tokens`, `total_thought_tokens` and `total_tokens`.
- Long thinking needs long client timeouts.
- Source: <https://ai.google.dev/api/interactions-api>

**Grounding with Google Search billing (Gemini 3 and newer).** Billing is *"for **each** search query that the model decides to execute"*. There are *"5,000 free search requests per month shared across all Gemini 3 and newer models, and then costs **$14 per 1,000 search requests**"*. Deeper thinking can mean more searches per product.
- Source: <https://ai.google.dev/gemini-api/docs/google-search>

**Grounding terms (Gemini API Additional Terms → Grounding with Google Search).** The terms say we *"will not ... copy, store ... Grounded Results or Search Suggestions, except that"* we *"may copy and store, for up to two (2) years, the text of the Grounded Result(s)"* for limited purposes, including *"in chat history of an end user of your application only for the purpose of allowing that end user to view their chat history"*. Search Suggestions are only stored where the law requires it. See §4 for how R66 complies.
- Source: <https://ai.google.dev/gemini-api/terms>

### Community (Google AI Developers Forum)

- **Frequent `503 UNAVAILABLE` on 3.x Flash**, including tiny requests on paid tiers. The advice that works is a short back-off and retry. 429 means quota, and retrying it only burns the quota faster.
  - <https://discuss.ai.google.dev/t/handling-429-503-errors-from-the-gemini-api/124640>
  - <https://discuss.ai.google.dev/t/persistent-37-unavailable-503-on-generatecontent-with-gemini-3-6-flash-paid-tier-1-zero-429s-counttokens-unaffected/179971>
  - <https://discuss.ai.google.dev/t/gemini-3-5-flash-lite-repeated-503-unavailable-including-minimal-text-request/185876>
- **"Output cut short" when the output ceiling is set low with `high` thinking.** The thinking ate the whole budget. Fix it by raising the ceiling, or by thinking one level lower on the retry.
  - <https://discuss.ai.google.dev/t/gemini-3-8-flash-high-does-maxoutputtokens-include-thinking-tokens/181077>
  - <https://discuss.ai.google.dev/t/gemini-3-output-limited-to-4k-tokens-instead-of-65k/114011>
  - <https://discuss.ai.google.dev/t/interactions-api-output-tokens-exceed-max-output-tokens-1500/182722>

## 2. Why the batch found less than the row (root causes, verified in code)

Several causes stacked up. None of them was a crash, which is why the batch "works a little bit":

| # | Cause | Where | Fix |
|---|---|---|---|
| 1 | The output ceiling was ~4,000 tokens while thinking counts against it. A deep-thinking reply ran out of tokens and came back `incomplete` (cut short), and nothing checked for that. | provider.ts | **S1**: the ceiling is sized for thinking (answer + 16k, capped at the model max). An `incomplete` reply is retried once, with a higher ceiling or one thinking level lower. |
| 2 | The batch used the same `low` thinking and 290 s deadline as the interactive row lookup, which a person is waiting on. Nobody waits on the batch. | lookup-job-server.ts | **S2**: the batch thinks **`high`** and waits up to **600 s** per product (both settable by env var). |
| 3 | A product that timed out or hit a 503 was marked failed at once, with no retry. | tick loop | **S2**: up to **3 tries**. Each retry runs on a later worker run and thinks one level lower (high → medium → low). 429/401/403 and budget errors are never retried. |
| 4 | **Presentation.** The batch kept only counts and a sentence. Everything it found that did not auto-attach or become a pending suggestion was thrown away: category, size, cannabinoids, images, low-confidence descriptions and the field-by-field evidence. The row panel shows all of it. | result_json | **S2**: a compact **snapshot** of the gated findings is stored per item. The row's AI Lookup panel opens **pre-filled** with the batch's findings, using the same worksheet and the same server-side "Save selected". |

**Result:** the batch now gets more thinking, more time and more tries than the row lookup, and shows everything it found in the same panel. Nothing is lost between "the batch looked" and "a person reviews".

## 3. What shipped, slice by slice

### S1 — model-aware Gemini requests (`60abc8b2`)

- `src/lib/ai/gemini-models-core.ts` (pure, self-tested) holds **one capability table** per model: allowed thinking levels, default thinking and output cap.
  - It resolves exact ids, dated/numbered variants (longest prefix) and deprecated ids (3.7 → 3.8).
  - An unknown future id such as `gemini-3.9-flash` gets **safe defaults** (low/medium/high, 65,536), so it works the day it ships.
- The thinking level is **clamped** to what the model accepts. For example, `minimal` on 3.8 is sent as `low` instead of returning a 400.
- The output ceiling is sized for thinking.
- `incomplete` replies are detected and retried once.
- Transient 5xx errors are retried up to 2 times (waits of 2 s, then 6 s), and only when enough of the deadline is left for a real answer.
- Usage is read under both the Interactions and the older field names.
- `lookupProduct` accepts a per-call `thinkingLevel` and `timeoutMs`.

### S2 — batch parity (`687f87d5`, tests `37b19ef8`)

- `AI_BATCH_THINKING_LEVEL` (default `high`) and `AI_BATCH_TIMEOUT_MS` (default 600,000; clamped to 60,000–700,000).
- Timing within a worker run:
  - The first product of a run gets the full deadline.
  - A later product starts only if the row lookup's 290 s plus 10 s of I/O still fits in the 760 s run budget.
  - A product never runs past the function's 800 s limit.
- Retries:
  - A failed product is requeued with a plain note ("Try 1 did not finish (…). 2 more tries queued.").
  - It is never retried in the same run, so the rest of the delivery keeps moving.
  - Paid calls add up across tries, so the cost line never under-counts.
  - A "Search again" marker survives a retry.
- `src/lib/catalog/lookup-snapshot-core.ts` (pure, self-tested) builds and parses the snapshot.
  - The parser is defensive and re-validates every value through the same validators a live reply goes through.
  - Only http(s) URLs are kept, and the snapshot is capped at 48 KB.
- On the page:
  - The row's AI Lookup button reads "AI Lookup · batch found N facts".
  - The panel says *"From the batch lookup on …"* until the person runs a search of their own.

### S3 — the batch panel (`d999800a`)

- **Progress bar.** An accessible `role="progressbar"` showing settled out of total. It never shows 100% while anything is left.
- **Time left** is **measured, not guessed**: wall-clock time from the job start to the newest finish, divided by the products finished. That rate already includes cron gaps, deep thinking and retries.
  - Until the first product finishes, the panel says "estimating" rather than showing an invented number.
  - Example: "Time left: about 42 min, done around 3:10 PM (about 6 min per product so far)."
- **Auto-refresh** (`BatchLookupAutoRefresh`) calls `router.refresh()` every 20 s while the job is open. An open AI Lookup panel and typed edits are kept.
  - It never refreshes while the tab is hidden or while someone is typing in a field.
  - It has a **Pause** button and stops by itself when the job finishes.
- The "Refresh to see progress" instruction is gone.

## 4. Google Grounding terms: what is stored

- **Search Suggestions** (Google's HTML chips) are **never stored**. A test asserts the stored JSON never contains them.
- The snapshot stores only the **compliance-gated field values**, their confidences and source URLs. These are the same things a row lookup already writes into suggestions and the knowledge base. Cited text and the model's raw reply are never stored.
- The snapshot is shown **only inside this shop's admin**, as the requesting shop's own lookup history. That matches the terms' "chat history ... to view their chat history" allowance.
- **Two-year limit:** a snapshot older than 730 days is **never shown again** (`snapshotExpired`), matching *"for up to two (2) years"*. This is pinned by a test.

## 5. Upgrading the model next time (runbook)

1. Read the new model's page for its thinking levels, default and output cap.
2. Add **one row** to `GEMINI_MODEL_TABLE` in `src/lib/ai/gemini-models-core.ts`, and add a self-test line.
   - If Google deprecates an id, give the old row `routedTo: "<new id>"`.
3. Set `AI_MODEL_HEAVY=<new id>` in Vercel (Production + Preview) and redeploy.
4. Without step 2, an unknown id still works on safe defaults (low/medium/high, 65,536). Step 2 only makes the clamp exact.

## 6. Settings (Vercel)

| Variable | Recommended | Notes |
|---|---|---|
| `AI_MODEL_HEAVY` | `gemini-3.8-flash` | `gemini-3.7-flash` also works today (Google routes it to 3.8), but it is deprecated. |
| `AI_BATCH_THINKING_LEVEL` | unset (`high`) | Set `medium` only if lookups keep running out of time. |
| `AI_BATCH_TIMEOUT_MS` | unset (`600000`) | Ten minutes per product. |
| `AI_THINKING_LEVEL` | unchanged | The interactive row lookup only. |

**Cost note:** `high` thinking can make Gemini run more Google searches per product. Searches are billed per query after the 5,000 free per month ($14 per 1,000). The batch panel's cost line still counts every paid lookup.

## 7. Tests

- `tests/compliance/r66-gemini-provider.test.ts` (S1).
- `tests/compliance/r66-batch-lookup.test.ts` drives the REAL cron tick, runOneItem and page read through postgrest-js on the in-memory PostgREST. It covers depth, env overrides, bounded later items, retries, step-down, the marker, the snapshot round-trip, no Search Suggestions, the two-year expiry and the wiring pins.
- `tests/compliance/r66-batch-progress.test.tsx` covers the progress core and runs the auto-refresh component's effect for real with fake timers (visible / hidden / typing / paused / finished / cleanup).
- Mutation checks: every behaviour above was broken on purpose, one at a time (15 mutations across S2, S3 and the expiry guard), and each one turned the tests red.
- Pure self-tests registered in `scripts/compliance/run-pure-selftests.ts`:
  - gemini-models-core 45
  - gemini-request-core 19
  - lookup-job-core 154
  - lookup-snapshot-core 48
  - lookup-progress-core 33
