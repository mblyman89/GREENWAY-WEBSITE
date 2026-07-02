"use client";

/**
 * BlogIdeaAssistant (B7) — the GPT-4o "what should we write about" helper on the
 * New Post page. It suggests IDEAS, HEADLINES, or TRENDS tuned to Greenway's
 * LOCAL audience (Kitsap County + surrounding + Seattle). DRAFTS-ONLY: nothing
 * is saved; picking an idea just fills the New Post form fields below it.
 *
 * When the user clicks "Use this idea", we set the title + category inputs (by
 * name) and stash the angle/keywords into the topic box so the next screen's
 * body-draft AI has context. Purely client-side convenience over the existing,
 * permission-gated createPostAction.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Textarea } from "@/components/admin/ui";
import { suggestBlogIdeasAction, type BlogIdeaResultOut } from "@/app/admin/blog/actions";
import type { BlogIdea, BlogIdeaKind } from "@/lib/cms/ai-blog-ideas";

const TABS: { key: BlogIdeaKind; label: string; blurb: string }[] = [
  { key: "idea", label: "Post ideas", blurb: "Fresh topics worth writing about for local customers." },
  { key: "headline", label: "Headlines", blurb: "Specific, ready-to-use title ideas." },
  { key: "trend", label: "Trends", blurb: "Timely, season-aware angles (no invented news)." },
];

function setInputValue(name: string, value: string) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  );
  if (!el) return;
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function BlogIdeaAssistant({ aiEnabled }: { aiEnabled: boolean }) {
  const [tab, setTab] = useState<BlogIdeaKind>("idea");
  const [topic, setTopic] = useState("");
  const [ideas, setIdeas] = useState<BlogIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  if (!aiEnabled) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]">
        The blog idea assistant is off because AI is not configured. Set{" "}
        <code className="rounded bg-[var(--admin-surface-2)] px-1 py-0.5 text-[var(--admin-text)]">AI_API_KEY</code>{" "}
        (or <code className="rounded bg-[var(--admin-surface-2)] px-1 py-0.5 text-[var(--admin-text)]">OPENAI_API_KEY</code>) to enable it.
      </div>
    );
  }

  const run = () => {
    setError(null);
    setUsed(null);
    startTransition(async () => {
      const res: BlogIdeaResultOut = await suggestBlogIdeasAction(tab, topic);
      if (res.ok) {
        setIdeas(res.ideas);
        setModel(res.model);
      } else {
        setIdeas(null);
        setError(res.error);
      }
    });
  };

  const useIdea = (idea: BlogIdea, index: number) => {
    setInputValue("title", idea.headline);
    setInputValue("category", idea.category);
    const seed = [idea.angle, idea.keywords.length ? `Keywords: ${idea.keywords.join(", ")}` : ""]
      .filter(Boolean)
      .join(" — ");
    setInputValue("ai_topic_seed", seed);
    setUsed(index);
    // Bring the form into view.
    document.querySelector('[name="title"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="rounded-[var(--admin-radius-xl)] border border-[var(--admin-accent)]/25 bg-[var(--admin-accent-soft)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-accent)]">
            ✨ Blog idea assistant
          </h2>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            Ideas, headlines &amp; trends for our local audience — Kitsap County, the surrounding area
            &amp; Seattle. Drafts only; nothing is saved until you create the post.
          </p>
        </div>
        {model && (
          <Badge tone="green">{model}</Badge>
        )}
      </div>

      {/* Mode tabs */}
      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] transition ${
              tab === t.key
                ? "bg-[var(--admin-accent)] text-black"
                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
        {TABS.find((t) => t.key === tab)?.blurb}
      </p>

      {/* Topic + generate */}
      <div className="mt-3 space-y-2">
        <Textarea
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Optional: a theme to bias the ideas (e.g. 'edibles for beginners', 'fall on the Peninsula', 'ferry-friendly picks')"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="confirm" size="sm" onClick={run} disabled={pending}>
            {pending ? "Thinking…" : `Suggest ${TABS.find((t) => t.key === tab)?.label.toLowerCase()}`}
          </Button>
          {ideas && ideas.length > 0 && (
            <span className="text-xs text-[var(--admin-text-faint)]">{ideas.length} suggestions</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {error}
        </div>
      )}

      {/* Results */}
      {ideas && ideas.length > 0 && (
        <ul className="mt-4 space-y-3">
          {ideas.map((idea, i) => (
            <li
              key={i}
              className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-sm font-bold text-[var(--admin-text)]">{idea.headline}</h3>
                <Badge tone="outline">{idea.category}</Badge>
              </div>
              {idea.angle && (
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{idea.angle}</p>
              )}
              {idea.hook && (
                <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
                  <span className="font-semibold text-[var(--admin-text-muted)]">Why now:</span> {idea.hook}
                </p>
              )}
              {idea.keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {idea.keywords.map((k, ki) => (
                    <Badge key={ki} tone="neutral">
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
              {idea.complianceFlags.length > 0 && (
                <div className="mt-2 text-xs text-[var(--admin-gold)]">
                  ⚠ {idea.complianceFlags.length} compliance note(s) — review the copy before publishing.
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                <Button type="button" variant="primary" size="sm" onClick={() => useIdea(idea, i)}>
                  Use this idea
                </Button>
                {used === i && (
                  <span className="text-xs text-[var(--admin-accent)]">Filled the form below ↓</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
