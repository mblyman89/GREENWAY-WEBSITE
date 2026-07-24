import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import { getRegulatoryOverview } from "@/lib/regulatory/regulatory-store";
import {
  STAGE_LABELS,
  stageUrgency,
  type RulemakingStage,
  type Extraction,
} from "@/lib/regulatory/regulatory-core";
import { areaByKey } from "@/lib/regulatory/compliance-surface";
import { isAiConfigured } from "@/lib/ai/provider";
import {
  ingestTextAction,
  ingestUrlAction,
  checkNowAction,
  analyzeItemAction,
  setItemStatusAction,
  setRoadmapStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Regulatory Watch (SLICE 37) — the future-compliance command center. LCB
 * bulletins funnel in (daily cron poll of the GovDelivery feed, forwarded
 * emails, manual paste/URL); the AI analyst reads each one against the
 * codebase compliance-surface map and produces a briefing + strategy +
 * proposed roadmap tasks. ADVISORY ONLY — a human reviews everything here.
 */

function stageBadge(stage: string) {
  const s = stage as RulemakingStage;
  const label = STAGE_LABELS[s] ? STAGE_LABELS[s].split(" — ")[0] : stage;
  const urgency = STAGE_LABELS[s] ? stageUrgency(s) : "low";
  const tone =
    urgency === "critical" ? "danger" : urgency === "high" ? "orange" : urgency === "medium" ? "gold" : "neutral";
  return <Badge tone={tone}>{label}</Badge>;
}

function impactBadge(impact: string) {
  const tone =
    impact === "critical" ? "danger" : impact === "high" ? "orange" : impact === "medium" ? "gold" : "neutral";
  return <Badge tone={tone}>impact: {impact}</Badge>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function RegulatoryWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("reports.view");
  const [overview, sp] = await Promise.all([getRegulatoryOverview(), searchParams]);

  const { migrationApplied, sources, items, analyses, roadmap } = overview;

  // Deadline timeline: every date the analyst confirmed, soonest first.
  const today = new Date().toISOString().slice(0, 10);
  const timeline = Object.values(analyses)
    .flatMap((a) =>
      a.deadlines.map((d) => ({
        ...d,
        itemTitle: items.find((i) => i.id === a.item_id)?.title ?? "",
      })),
    )
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  const newCount = items.filter((i) => i.status === "new").length;
  const openTasks = roadmap.filter((r) => r.status !== "done" && r.status !== "dismissed");
  const commentWindows = timeline.filter((d) => d.kind === "comment_deadline").length;

  return (
    <div>
      <AdminPageHeader
        title="Regulatory Watch"
        subtitle="Stay one step ahead of LCB rule changes — bulletins in, AI briefings and a codebase roadmap out."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Compliance", href: "/admin/compliance/health" }, { label: "Regulatory Watch" }]}
          />
        }
        help={
          <HelpPanel
            id="regulatory-watch"
            title="How Regulatory Watch works"
            steps={[
              "Every day the system polls the LCB's bulletin feed and pulls in anything new — no email setup required.",
              "You can also forward LCB emails to the watch mailbox, or paste a bulletin / official URL below.",
              "The AI reads each cannabis-relevant bulletin, figures out the rulemaking stage (CR-101 early warning → CR-103 adopted), rates the impact on THIS store, and proposes a strategy + roadmap.",
              "Deadlines that matter (comment windows, effective dates) land on the timeline — comment windows are your chance to influence rules via rules@lcb.wa.gov.",
              "Accept a proposed roadmap task to track it; the accepted list is exactly what you hand to the AI to build next.",
              "Everything here is advisory — nothing changes store behavior until a human builds and reviews the change.",
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.saved ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-emerald-300/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {sp.saved}
          </div>
        ) : null}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {sp.error}
          </div>
        ) : null}

        {!migrationApplied && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Migration 0137 hasn&apos;t been applied yet — apply{" "}
            <code>0137_regulatory_watch.sql</code> in the Supabase SQL editor to turn on Regulatory
            Watch (the daily bulletin poll, the AI briefings, and the roadmap board).
          </div>
        )}

        {migrationApplied && !isAiConfigured && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            AI is not configured (set <code>OPENAI_API_KEY</code>) — bulletins still flow in and
            citations/dates are extracted, but the plain-English briefings and roadmap proposals
            are paused until a key is set.
          </div>
        )}

        {/* Pulse */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="New bulletins" value={String(newCount)} accent={newCount > 0 ? "gold" : "muted"} hint="Waiting for review" />
          <StatCard label="Open comment windows" value={String(commentWindows)} accent={commentWindows > 0 ? "orange" : "muted"} hint="Chances to influence rules" />
          <StatCard label="Upcoming deadlines" value={String(timeline.length)} accent={timeline.length > 0 ? "gold" : "green"} hint="Effective dates + hearings" />
          <StatCard label="Open roadmap tasks" value={String(openTasks.length)} accent={openTasks.length > 0 ? "gold" : "green"} hint="Accepted work to stay compliant" />
        </div>

        {/* Deadline timeline */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Deadline timeline
          </h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              No upcoming confirmed deadlines. New bulletins with comment windows or effective
              dates will appear here automatically.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {timeline.map((d, i) => (
                <li key={`${d.date}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{fmtDate(d.date)}</span>
                  <Badge tone={d.kind === "effective" ? "orange" : d.kind === "comment_deadline" ? "gold" : "neutral"}>
                    {d.kind.replace("_", " ")}
                  </Badge>
                  <span className="text-[var(--admin-text-muted)]">{d.itemTitle}</span>
                  {d.note ? <span className="w-full pl-1 text-xs text-[var(--admin-text-muted)]">{d.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Intake inbox */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Bulletin inbox
            </h2>
            <form action={checkNowAction}>
              <Button type="submit" variant="save" size="sm" disabled={!migrationApplied}>
                Check for new bulletins now
              </Button>
            </form>
          </div>

          {items.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              Nothing here yet. The daily check pulls in LCB bulletins automatically, or use the
              manual intake below.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--admin-border)]">
              {items.map((item) => {
                const analysis = analyses[item.id];
                const ex = item.extracted as Extraction;
                const citations = Array.isArray(ex?.citations) ? ex.citations : [];
                return (
                  <li key={item.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {analysis ? stageBadge(analysis.stage) : ex?.stage ? stageBadge(ex.stage) : null}
                      {analysis ? impactBadge(analysis.impact) : null}
                      {item.status === "new" ? <Badge tone="gold">new</Badge> : null}
                      {item.status === "reviewed" ? <Badge tone="green">reviewed</Badge> : null}
                      <span className="text-xs text-[var(--admin-text-muted)]">
                        {fmtDate(item.published_at)} · via {item.ingested_via}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </div>

                    {analysis ? (
                      <div className="mt-2 space-y-2 rounded-lg bg-[var(--admin-surface-2)] p-3 text-sm">
                        <p>{analysis.summary}</p>
                        {analysis.areas.length > 0 && (
                          <p className="text-xs text-[var(--admin-text-muted)]">
                            Affects:{" "}
                            {analysis.areas
                              .map((k) => areaByKey(k)?.label ?? k)
                              .join(" · ")}
                          </p>
                        )}
                        {analysis.strategy.length > 0 && (
                          <ol className="list-decimal space-y-1 pl-5 text-xs">
                            {analysis.strategy.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        )}
                      </div>
                    ) : null}

                    {citations.length > 0 && (
                      <p className="mt-2 flex flex-wrap gap-2 text-xs">
                        {citations.map((c) => (
                          <span key={c.cite}>
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-gold)] hover:underline">
                                {c.cite}
                              </a>
                            ) : (
                              <span className="text-[var(--admin-text-muted)]">{c.cite}</span>
                            )}
                          </span>
                        ))}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={analyzeItemAction}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <Button type="submit" variant="special" size="sm" disabled={!isAiConfigured}>
                          {analysis ? "Re-analyze" : "Analyze with AI"}
                        </Button>
                      </form>
                      {item.status !== "reviewed" && (
                        <form action={setItemStatusAction}>
                          <input type="hidden" name="item_id" value={item.id} />
                          <input type="hidden" name="status" value="reviewed" />
                          <Button type="submit" variant="neutral" size="sm">Mark reviewed</Button>
                        </form>
                      )}
                      <form action={setItemStatusAction}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="status" value="archived" />
                        <Button type="submit" variant="neutral" size="sm">Archive</Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Roadmap board */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Compliance roadmap
          </h2>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            AI-proposed changes to keep the store ahead of rule changes. Accept a task to track
            it — the accepted list is what you hand to the AI to build.
          </p>
          {roadmap.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              No roadmap tasks yet. They appear when the analyst finds a rule change that touches
              the store.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--admin-border)]">
              {roadmap.map((task) => (
                <li key={task.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          task.status === "done"
                            ? "green"
                            : task.status === "in_progress"
                              ? "gold"
                              : task.status === "accepted"
                                ? "orange"
                                : "neutral"
                        }
                      >
                        {task.status.replace("_", " ")}
                      </Badge>
                      {task.area ? (
                        <span className="text-xs text-[var(--admin-text-muted)]">
                          {areaByKey(task.area)?.label ?? task.area}
                        </span>
                      ) : null}
                      {task.due_at ? (
                        <span className="text-xs text-[var(--admin-text-muted)]">due {fmtDate(task.due_at)}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{task.title}</div>
                    {task.detail ? (
                      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{task.detail}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {task.status === "proposed" && (
                      <form action={setRoadmapStatusAction}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="status" value="accepted" />
                        <Button type="submit" variant="save" size="sm">Accept</Button>
                      </form>
                    )}
                    {task.status === "accepted" && (
                      <form action={setRoadmapStatusAction}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="status" value="in_progress" />
                        <Button type="submit" variant="save" size="sm">Start</Button>
                      </form>
                    )}
                    {(task.status === "accepted" || task.status === "in_progress") && (
                      <form action={setRoadmapStatusAction}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="status" value="done" />
                        <Button type="submit" variant="neutral" size="sm">Done</Button>
                      </form>
                    )}
                    {task.status === "proposed" && (
                      <form action={setRoadmapStatusAction}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <Button type="submit" variant="neutral" size="sm">Dismiss</Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Manual intake */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Add from a link
            </h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Paste an official URL (lcb.wa.gov, content.govdelivery.com, or leg.wa.gov) — the
              page is fetched, read, and analyzed.
            </p>
            <form action={ingestUrlAction} className="mt-3 flex flex-wrap gap-2">
              <input
                type="url"
                name="url"
                required
                placeholder="https://content.govdelivery.com/bulletins/gd/WALCB-…"
                className="min-w-0 flex-1 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              />
              <Button type="submit" variant="save" size="sm" disabled={!migrationApplied}>
                Fetch &amp; analyze
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Paste a bulletin
            </h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Copy the text of any LCB email or notice and paste it here — works with zero setup.
            </p>
            <form action={ingestTextAction} className="mt-3 space-y-2">
              <input
                type="text"
                name="title"
                required
                placeholder="Bulletin subject line"
                className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              />
              <textarea
                name="body"
                required
                rows={4}
                placeholder="Paste the bulletin text…"
                className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              />
              <Button type="submit" variant="save" size="sm" disabled={!migrationApplied}>
                Ingest &amp; analyze
              </Button>
            </form>
          </Card>
        </div>

        {/* Sources */}
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Watched sources
          </h2>
          {sources.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              Sources appear after migration 0137 is applied (it seeds the LCB bulletin feed and
              rulemaking pages).
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sources.map((s) => (
                <li key={s.source_key} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={s.kind === "feed" ? "green" : "neutral"}>{s.kind}</Badge>
                  {s.url.startsWith("http") ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {s.label}
                    </a>
                  ) : (
                    <span className="font-medium">{s.label}</span>
                  )}
                  <span className="text-xs text-[var(--admin-text-muted)]">
                    last checked {s.last_checked_at ? fmtDate(s.last_checked_at) : "never"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
            Not legal advice. To comment on proposed rules, email rules@lcb.wa.gov before the
            comment window closes.
          </p>
        </Card>
      </div>
    </div>
  );
}
