"use client";

/**
 * NewPostFromPicker — D237 N-5 (SOP-22 G-115; F-22-10, F-22-16).
 *
 * "New post from…": pick a post type, pick an item from this week's facts
 * (the This-week feed), add notes if the type needs them, then Draft with AI.
 * The draft shows 5 headline options, the excerpt, the body in sections, the
 * owner-rule issues and the compliance flags right away, and up to 3 pictures
 * from Digital Assets. Nothing is saved until "Create draft post" (drafts only,
 * audited; must-fix items are refused on the server too).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { reviewToNotes, type CuratedReviewChoice } from "@/lib/cms/curated-reviews-core";
import { Badge, Button, Textarea } from "@/components/admin/ui";
import {
  loadTemplateItemsAction,
  draftFromTemplateAction,
  createPostFromDraftAction,
} from "@/app/admin/blog/actions";
import { POST_TEMPLATES, type PostDraft, type DraftIssue, type PictureSuggestion } from "@/lib/cms/post-templates-core";

type Item = { id: string; label: string; facts: string[] };
type DraftState = {
  draft: PostDraft;
  issues: DraftIssue[];
  complianceFlags: string[];
  pictures: PictureSuggestion[];
  category: string;
  model: string;
  facts: string[];
};

const BOX = "rounded-[var(--admin-radius-xl)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const PILL = "rounded-full px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] transition";

export function NewPostFromPicker({ aiEnabled, reviews = [] }: { aiEnabled: boolean; reviews?: CuratedReviewChoice[] }) {
  const [key, setKey] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [held, setHeld] = useState<{ label: string; reason: string }[]>([]);
  const [partial, setPartial] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<DraftState | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hero, setHero] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const template = POST_TEMPLATES.find((t) => t.key === key) ?? null;

  if (!aiEnabled) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]" data-testid="new-post-from">
        &ldquo;New post from&hellip;&rdquo; is off because AI is not configured. Set <code>AI_API_KEY</code> (or <code>OPENAI_API_KEY</code>) to turn it on.
      </div>
    );
  }

  const pickTemplate = (k: string) => {
    setKey(k);
    setItems([]);
    setHeld([]);
    setItemId(null);
    setResult(null);
    setError(null);
    setBlocking([]);
    startTransition(async () => {
      const res = await loadTemplateItemsAction(k);
      if (res.ok) {
        setItems(res.items);
        setHeld(res.held);
        setPartial(res.partial);
        if (res.items.length === 1) setItemId(res.items[0]!.id);
      } else setError(res.error);
    });
  };

  const draftIt = () => {
    if (!key || !itemId) return;
    setError(null);
    setBlocking([]);
    startTransition(async () => {
      const res = await draftFromTemplateAction({ key, itemId, notes });
      if (!res.ok) {
        setResult(null);
        setError(res.error);
        return;
      }
      setResult(res);
      setTitle(res.draft.headlines[0] ?? "");
      setBody(sectionsToText(res.draft));
      setHero(res.pictures[0]?.id ?? null);
    });
  };

  const create = () => {
    if (!key || !itemId || !result) return;
    setError(null);
    setBlocking([]);
    const draft: PostDraft = { ...result.draft, headlines: [title], ...textToSections(body) };
    startTransition(async () => {
      const res = await createPostFromDraftAction({ key, itemId, notes, title, draft, heroMediaId: hero });
      if (res.ok) {
        window.location.href = `/admin/blog/${res.id}?saved=1`;
        return;
      }
      setError(res.error);
      setBlocking(res.blocking ?? []);
    });
  };

  return (
    <div className={BOX} data-testid="new-post-from">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-accent)]">New post from&hellip;</h2>
          <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
            Facts from this week at Greenway, words from the AI, a picture from Digital Assets, checks by you. Prices and dates only in Sale and Vendor-day posts, copied from the promotion. Drafts only.
          </p>
        </div>
        {result?.model ? <Badge tone="green">{result.model}</Badge> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {POST_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.blurb}
            onClick={() => pickTemplate(t.key)}
            className={`${PILL} ${key === t.key ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {template ? <p className="mt-2 text-xs text-[var(--admin-text-faint)]">{template.blurb}</p> : null}
      {partial ? <p className="mt-2 text-xs text-[var(--admin-gold)]">This week&apos;s facts could only be read in part; check Inventory before you rely on them.</p> : null}

      {template && !pending && items.length === 0 && !error ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">Nothing for this post type in this week&apos;s facts.</p>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Pick one</p>
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="npf_item" checked={itemId === it.id} onChange={() => setItemId(it.id)} className="mt-1" />
              <span>
                <span className="font-semibold text-[var(--admin-text)]">{it.label}</span>
                {it.facts.length ? <span className="block text-xs text-[var(--admin-text-faint)]">{it.facts.join(" ")}</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      {held.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-xs text-[var(--admin-danger)]">
          {held.map((h, i) => (
            <li key={i}>
              Held back: {h.label}. {h.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {template && items.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">
            Notes {template.needsNotes ? "(needed)" : "(optional)"}
          </p>
          {template.key === "review-spotlight" ? (
            reviews.length > 0 ? (
              <select
                value=""
                onChange={(e) => {
                  const r = reviews.find((x) => x.id === e.target.value);
                  if (r) setNotes(reviewToNotes(r));
                }}
                className="mb-2 mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]"
                data-testid="spotlight-review-pick"
                aria-label="Pick a curated review"
              >
                <option value="">Pick a curated review (permission given)…</option>
                {reviews.map((r) => (
                  <option key={r.id} value={r.id}>{`${r.firstName}: ${r.quote.slice(0, 70)}${r.quote.length > 70 ? "…" : ""}`}</option>
                ))}
              </select>
            ) : (
              <p className="mb-2 mt-1 text-xs text-[var(--admin-text-faint)]">
                No curated reviews yet. Add one with the customer&apos;s permission in <Link href="/admin/blog/reviews" className="text-[var(--admin-accent)] hover:underline">Curated reviews</Link>.
              </p>
            )
          ) : null}
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              template.key === "culture"
                ? "Paste the news and its source link (https://…)."
                : template.key === "review-spotlight"
                  ? "Paste the customer review you picked, word for word."
                  : "Anything else the AI should know (only true facts)."
            }
          />
          <div className="mt-3">
            <Button type="button" variant="confirm" onClick={draftIt} disabled={pending || !itemId}>
              {pending ? "Working…" : result ? "Draft again" : "Draft with AI"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-4 rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
          {error}
          {blocking.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4 border-t border-[var(--admin-border)] pt-4" data-testid="new-post-from-draft">
          {result.issues.length + result.complianceFlags.length > 0 ? (
            <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-3 text-xs text-[var(--admin-danger)]">
              <p className="font-semibold">Check these before you save</p>
              <ul className="mt-1 list-disc pl-5">
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
            <p className="text-xs text-[var(--admin-accent)]">No rule or compliance flags. A person still reads it before it goes live.</p>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Headline (pick one, then edit)</p>
            <div className="mt-1 space-y-1">
              {result.draft.headlines.map((h) => (
                <label key={h} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="npf_headline" checked={title === h} onChange={() => setTitle(h)} />
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

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Excerpt</p>
            <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{result.draft.excerpt || "(none)"}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">
              Body (a line starting with &ldquo;## &rdquo; is a heading; paragraphs are separated by a blank line)
            </p>
            <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">Picture from Digital Assets</p>
            {result.pictures.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--admin-text-faint)]">No matching picture found. You can add one on the next screen.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-3">
                {result.pictures.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setHero(hero === p.id ? null : p.id)}
                    className={`overflow-hidden rounded-lg border text-left text-xs ${hero === p.id ? "border-[var(--admin-accent)] ring-2 ring-[var(--admin-accent)]" : "border-[var(--admin-border)]"}`}
                  >
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={p.label} className="h-24 w-full object-cover" />
                    ) : null}
                    <span className="block truncate px-2 py-1">{p.label}</span>
                    <span className="block px-2 pb-1 text-[var(--admin-text-faint)]">{p.why}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <details className="text-xs text-[var(--admin-text-faint)]">
            <summary className="cursor-pointer">The facts the AI was given</summary>
            <ul className="mt-1 list-disc pl-5">
              {result.facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </details>

          <Button type="button" variant="confirm" onClick={create} disabled={pending || !title.trim()}>
            {pending ? "Saving…" : "Create draft post →"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function sectionsToText(d: PostDraft): string {
  const parts: string[] = [];
  for (const s of d.sections) {
    if (s.heading) parts.push(`## ${s.heading}`);
    parts.push(...s.paragraphs);
  }
  if (d.cta) parts.push(d.cta);
  return parts.join("\n\n");
}

/** Back from the edited text: "## " lines are headings; the CTA is kept in the body. */
function textToSections(text: string): Pick<PostDraft, "sections" | "cta"> {
  const sections: PostDraft["sections"] = [];
  let cur: PostDraft["sections"][number] = { heading: "", paragraphs: [] };
  for (const raw of text.split(/\n\s*\n/)) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith("## ")) {
      if (cur.heading || cur.paragraphs.length) sections.push(cur);
      cur = { heading: p.slice(3).trim(), paragraphs: [] };
    } else cur.paragraphs.push(p);
  }
  if (cur.heading || cur.paragraphs.length) sections.push(cur);
  return { sections: sections.filter((s) => s.paragraphs.length > 0 || s.heading), cta: "" };
}
