"""R19 S13: idempotent wiring of the batch lookup into the onboarding page."""
import io
NL = chr(10)
P = "src/app/admin/inventory/drafts/page.tsx"
s = io.open(P, encoding="utf-8").read()

def r(a, b, marker):
    global s
    if marker in s:
        return
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)

r('import { IntakeFactReviewPanel } from "./IntakeFactReviewPanel";',
  'import { IntakeFactReviewPanel } from "./IntakeFactReviewPanel";' + NL +
  '// R19 S13: "Look up all N products on this manifest" (server-side batch).' + NL +
  'import { lookupJobsOn, loadManifestLookup } from "@/lib/catalog/lookup-job-server";' + NL +
  'import { attachFactsV2Enabled } from "@/lib/catalog/fact-attach-policy-server";' + NL +
  'import {' + NL +
  '  LOOKUP_ALL_HELP,' + NL +
  '  LOOKUP_ATTACH_V2_OFF_COPY,' + NL +
  '  LOOKUP_MIGRATION_COPY,' + NL +
  '  costLine,' + NL +
  '  itemRowCopy,' + NL +
  '  jobHeadline,' + NL +
  '  lookupAllButtonLabel,' + NL +
  '  lookupBanner,' + NL +
  '  progressLine,' + NL +
  '} from "@/lib/catalog/lookup-job-core";',
  "lookup-job-server")

r('import { approveAllPricedAction, approveDraftAction, dismissDraftAction, restoreDraftAction } from "./actions";',
  'import { approveAllPricedAction, approveDraftAction, cancelLookupAction, dismissDraftAction, lookupAllAction, restoreDraftAction } from "./actions";',
  "lookupAllAction, restoreDraftAction")

r('fact?: string; fact_msg?: string }>;',
  'fact?: string; fact_msg?: string; lookup?: string; lookup_msg?: string }>;',
  "lookup_msg?: string")

r('''  const batchDone = parseBatchResult(sp);
''', '''  const batchDone = parseBatchResult(sp);
  // R19 S13: the batch lookup for the focused delivery (review tab only).
  // Hidden when the flag is off or AI is not set up; the job and the exact
  // button count are read on the server (never guessed).
  const batchLookupOn = Boolean(focus.manifestId) && view === "draft" && lookupJobsOn() && isAiConfigured;
  const batchLookup = batchLookupOn && focus.manifestId ? await loadManifestLookup(focus.manifestId) : null;
  const batchLookupJob = batchLookup?.state === "job" ? batchLookup.job : null;
  const batchLookupActive = batchLookupJob !== null && (batchLookupJob.status === "queued" || batchLookupJob.status === "running");
  const batchLookupEligible = batchLookup && (batchLookup.state === "job" || batchLookup.state === "none") ? batchLookup.eligible : null;
  const batchLookupAttachOn = attachFactsV2Enabled();
  const lookupResult = lookupBanner(sp.lookup, sp.lookup_msg);
''', "const batchLookupOn")

# The banner: its own block right under the page banner (own tone).
r('''        {/* S30: fact review cannot be saved until migration 0237 is applied. */}''',
  '''        {lookupResult && (
          <div
            role={lookupResult.tone === "error" ? "alert" : "status"}
            data-testid="lookup-result"
            className={
              lookupResult.tone === "error"
                ? "rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
                : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
            }
          >
            {lookupResult.text}
          </div>
        )}

        {/* S30: fact review cannot be saved until migration 0237 is applied. */}''',
  'data-testid="lookup-result"')

# The button + progress panel right after the S17 form.
r('''            <span className="text-xs text-[var(--admin-text-muted)]">{BATCH_BUTTON_HELP}</span>
          </form>
        )}
''', '''            <span className="text-xs text-[var(--admin-text-muted)]">{BATCH_BUTTON_HELP}</span>
          </form>
        )}
        {/* R19 S13 (bible S13.4): look up the whole delivery on the server.
            The press only writes a job; the every-minute worker
            (/api/cron/lookup-jobs) does the lookups, so closing this tab
            loses nothing. Facts attach only under the S10 attach policy. */}
        {batchLookupOn && focus.manifestId && batchLookup && (
          <section
            data-testid="batch-lookup"
            className="flex flex-col gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm"
          >
            {batchLookup.state === "migration" ? (
              <p className="text-xs text-[var(--admin-text-muted)]" data-testid="batch-lookup-migration">{LOOKUP_MIGRATION_COPY}</p>
            ) : batchLookup.state === "error" ? (
              <p className="text-xs text-[var(--admin-text-muted)]">The batch lookup could not be read just now. Refresh to try again; AI Lookup on each row still works.</p>
            ) : !batchLookupAttachOn ? (
              <p className="text-xs text-[var(--admin-text-muted)]">{LOOKUP_ATTACH_V2_OFF_COPY}</p>
            ) : (
              <>
                {batchLookupJob && (
                  <div data-testid="batch-lookup-progress" aria-live="polite">
                    <p className="font-semibold text-[var(--admin-text)]">{jobHeadline(batchLookupJob.status, batchLookupJob.summary)}</p>
                    <p className="text-xs text-[var(--admin-text-muted)]">{progressLine(batchLookupJob.summary)}</p>
                    <p className="text-xs text-[var(--admin-text-muted)]">{costLine(batchLookupJob.summary, batchLookupJob.model)}</p>
                    {batchLookupJob.summary.failed > 0 && (
                      <p className="text-xs text-[var(--admin-danger)]">
                        {batchLookupJob.summary.failed} could not be looked up; the reason is on each row. AI Lookup on that row tries again.
                      </p>
                    )}
                  </div>
                )}
                {batchLookupActive && batchLookupJob ? (
                  <form action={cancelLookupAction.bind(null, batchLookupJob.jobId)} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="return_manifest" value={focus.manifestId} />
                    <Button type="submit" variant="neutral" size="sm">Stop the batch lookup</Button>
                    <span className="text-xs text-[var(--admin-text-muted)]">Refresh to see progress. Products not started yet are skipped; the one in progress finishes.</span>
                  </form>
                ) : batchLookupEligible && batchLookupEligible.count > 0 ? (
                  <form action={lookupAllAction.bind(null, focus.manifestId)} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="return_manifest" value={focus.manifestId} />
                    <Button type="submit" variant="special" size="sm" data-testid="batch-lookup-button">
                      {"\\u2728 "}{lookupAllButtonLabel(batchLookupEligible.count, batchLookupEligible.skippedDone)}
                    </Button>
                    <span className="text-xs text-[var(--admin-text-muted)]">
                      {LOOKUP_ALL_HELP}
                      {batchLookupEligible.truncated > 0 ? ` This press covers the first ${batchLookupEligible.count}; press again afterwards for the other ${batchLookupEligible.truncated}.` : ""}
                    </span>
                  </form>
                ) : null}
              </>
            )}
          </section>
        )}
''', 'data-testid="batch-lookup"')

# Per-row line next to the AI Lookup panel.
r('''                  const lookupPanel = (
                    <AiLookupPanel''', '''                  // R19 S13: this row's line from the delivery's batch lookup.
                  const batchItem = batchLookupJob?.items.get(d.id.toLowerCase()) ?? null;
                  const batchRowLine = batchItem ? (
                    <p
                      className={`max-w-[28rem] text-right text-xs ${batchItem.status === "failed" ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}
                      data-testid="batch-lookup-row"
                    >
                      {itemRowCopy(batchItem)}
                    </p>
                  ) : null;
                  const lookupPanel = (
                    <>
                    {batchRowLine}
                    <AiLookupPanel''', "const batchRowLine")
r('''                      manifestStrainType={strainEvidence.get(d.id)?.manifest ?? null}
                    />
                  );''', '''                      manifestStrainType={strainEvidence.get(d.id)?.manifest ?? null}
                    />
                    </>
                  );''', "                    </>\n                  );")
io.open(P, "w", encoding="utf-8").write(s)
print("ok")
