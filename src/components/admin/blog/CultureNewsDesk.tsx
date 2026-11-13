"use client";

/**
 * CultureNewsDesk — D237 N-6 (SOP-22 G-116; F-22-13, F-22-14 S1).
 *
 * Culture posts for the CULTURE card on /blog (Q-22-7), from cited news only
 * (Q-22-1 (a)):
 *  - Regulatory Watch: WSLCB items with their links (loaded when opened);
 *  - Find news: a grounded web search, run only when a person presses the
 *    button (Q-22-6 (a)); results are shown here with their sources and are
 *    not stored;
 *  - Vendor wins: the same search about one vendor or brand.
 * Draft with AI writes from the picked item; the health-topic guard runs at
 * once and again on save. Create draft post saves a Draft only.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Textarea } from "@/components/admin/ui";
import { GoogleSearchSuggestions } from "@/components/admin/LookupFactsView";
import {
  listDeskNewsAction,
  findNewsAction,
  draftCultureAction,
  createCulturePostAction,
} from "@/app/admin/blog/actions";
import type { NewsItem, GuardResult } from "@/lib/cms/culture-desk-core";
import type { PostDraft, DraftIssue } from "@/lib/cms/post-templates-core";

type Tab = "wslcb" | "web" | "vendor";
type Result = { draft: PostDraft; issues: DraftIssue[]; complianceFlags: string[]; guard: GuardResult; model: string; facts: string[] };

const PILL = "rounded-full px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] transition";

export function CultureNewsDesk({ aiEnabled }: { aiEnabled: boolean }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<NewsItem | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setItems([]);
    setSuggestions([]);
    setNote(null);
    setPicked(null);
    setResult(null);
    setError(null);
    setBlocking([]);
  };

  const openTab = (t: Tab) => {
    setTab(t);
    reset();
    if (t === "wslcb") {
      startTransition(async () => {
        const res = await listDeskNewsAction();
        setItems(res.items);
        setNote(res.note ?? (res.items.length ? null : "No Regulatory Watch items with a link yet."));
      });
    }
  };

  const find = () => {
    if (tab !== "web" && tab !== "vendor") return;
    reset();
    startTransition(async () => {
      const res = await findNewsAction(tab, topic);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems(res.items);
      setSuggestions(res.searchSuggestions);
      setNote(
        !res.usedWebSearch
          ? "The live web search did not run, so nothing can be cited. Try again later."
          : res.items.length
            ? null
            : "No news with a source link was found. Try other words.",
      );
    });
  };

  const draftIt = () => {
    if (!picked) return;
    setError(null);
    setBlocking([]);
    startTransition(async () => {
      const res = await draftCultureAction({ news: picked, notes });
      if (!res.ok) {
        setResult(null);
        setError(res.error);
        return;
      }
      setResult(res);
      setTitle(res.draft.headlines[0] ?? "");
    });
  };

  const create = () => {
    if (!picked || !result) return;
    setError(null);
    setBlocking([]);
    startTransition(async () => {
      const res = await createCulturePostAction({ news: picked, notes, title, draft: result.draft });
      if (res.ok) {
        window.location.href = `/admin/blog/${res.id}?saved=1`;
        return;
      }
      setError(res.error);
      setBlocking(res.blocking ?? []);
    });
  };

  if (!aiEnabled) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]" data-testid="culture-desk">
        The culture news desk is off because AI is not configured. Set <code>AI_API_KEY</code> (or <code>OPENAI_API_KEY</code>) to turn it on.
      </div>
    );
  }

  return (
    <div className="rounded-[var(--admin-radius-xl)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5" data-testid="culture-desk">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-accent)]">Culture news desk</h2>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            Cited news only, for the CULTURE card on the blog. Health topics need a source, get the &ldquo;talk to your healthcare provider&rdquo; line, and may not link to products or deals. Therapeutic wording is blocked. Find news searches the web only when you press it.
          </p>
        </div>
        {result?.model ? <Badge tone="green">{result.model}</Badge> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["wslcb", "Regulatory Watch"],
            ["web", "Find news"],
            ["vendor", "Vendor wins"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => openTab(k)}
            className={`${PILL} ${tab === k ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "web" || tab === "vendor" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={tab === "vendor" ? "Vendor or brand name" : "Topic (optional), e.g. rescheduling"}
            className="min-w-[14rem] flex-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
            aria-label="Topic"
          />
          <Button type="button" variant="confirm" onClick={find} disabled={pending}>
            {pending ? "Searching…" : "Find news"}
          </Button>
        </div>
      ) : null}

      {note ? <p className="mt-3 text-xs text-[var(--admin-text-faint)]">{note}</p> : null}

      {items.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Pick one</p>
          {items.map((it) => (
            <label key={it.id + it.url} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="desk_item" checked={picked?.url === it.url} onChange={() => setPicked(it)} className="mt-1" />
              <span>
                <span className="font-semibold text-[var(--admin-text)]">{it.title}</span>
                <span className="block text-xs text-[var(--admin-text-faint)]">
                  {it.outlet}
                  {it.date ? ` · ${it.date}` : ""} ·{" "}
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline">
                    source
                  </a>
                </span>
                {it.summary ? <span className="block text-xs text-[var(--admin-text-muted)]">{it.summary}</span> : null}
              </span>
            </label>
          ))}
          <GoogleSearchSuggestions html={suggestions} />
        </div>
      ) : null}

      {picked ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Notes (optional)</p>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why it matters to our customers (only true facts)." />
          <div className="mt-3">
            <Button type="button" variant="confirm" onClick={draftIt} disabled={pending}>
              {pending ? "Working…" : result ? "Draft again" : "Draft with AI"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-4 rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
          {error}
          {blocking.length ? (
            <ul className="mt-1 list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4 border-t border-[var(--admin-border)] pt-4" data-testid="culture-desk-draft">
          {result.guard.blocking.length + result.issues.length + result.complianceFlags.length > 0 ? (
            <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs text-[var(--admin-danger)]">
              <p className="font-semibold">
                Check these before you save{result.guard.health ? " (this touches health)" : ""}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.guard.blocking.map((b, i) => (
                  <li key={`g${i}`}>Health guard: {b}</li>
                ))}
                {result.issues.map((i, n) => (
                  <li key={`i${n}`}>
                    {i.level === "must-fix" ? "Must fix: " : "Heads-up: "}
                    {i.text}
                  </li>
                ))}
                {result.complianceFlags.map((f, n) => (
                  <li key={`c${n}`}>Compliance: {f}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-[var(--admin-accent)]">
              Passes the health guard{result.guard.health ? " (health topic: the source and the provider line are added)" : ""}. A person still reads it before it goes live.
            </p>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Headline</p>
            <div className="mt-1 space-y-1">
              {result.draft.headlines.map((h) => (
                <label key={h} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="desk_headline" checked={title === h} onChange={() => setTitle(h)} />
                  {h}
                </label>
              ))}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm"
              aria-label="Headline"
            />
          </div>

          <div className="space-y-2 text-sm text-[var(--admin-text-muted)]">
            <p className="italic">{result.draft.excerpt}</p>
            {result.draft.sections.map((s, i) => (
              <div key={i}>
                {s.heading ? <p className="font-semibold text-[var(--admin-text)]">{s.heading}</p> : null}
                {s.paragraphs.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            ))}
            {result.draft.cta ? <p>{result.draft.cta}</p> : null}
            <p className="text-xs text-[var(--admin-text-faint)]">The source link and, on health topics, the provider line are added to the end of the body when you save. Edit the words on the next screen.</p>
          </div>

          <Button type="button" variant="confirm" onClick={create} disabled={pending || !title.trim()}>
            {pending ? "Saving…" : "Create draft culture post →"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
