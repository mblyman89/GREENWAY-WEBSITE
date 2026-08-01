"use client";

/**
 * BlogContentEditor — the novice-safe editor for the public /blog page CHROME
 * (Blog & Newsletter → Blog wording, MIG-6 Slice 1).
 *
 * ONE job, kept deliberately simple (per owner): edit the blog page's wording —
 * the hero eyebrow/heading/intro, the "Read article" card button label, and the
 * "Back to blog" link on an article. Each block is its own little form with
 * Save draft / Publish and a History → restore disclosure, reusing the SAME
 * content-store machinery as Site Content and the Medical page editor, so the
 * public blog stays byte-identical until a staff member edits and Publishes.
 *
 * SCOPE: this editor does NOT touch blog POSTS (those live in /admin/blog), and
 * it does NOT edit the blog card DESIGN — only the wording. No page-hide switch.
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";

export type BlogRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

export type BlogBlockVM = {
  key: string;
  label: string;
  help: string | null;
  /** True when the field should render as a multi-line textarea. */
  multiline: boolean;
  draftValue: string;
  publishedValue: string;
  hasUnpublishedDraft: boolean;
  revisions: BlogRevisionVM[];
};

/** One friendly section (hero / card / detail) for grouped UI. */
export type BlogSectionVM = {
  id: string;
  heading: string;
  blocks: BlogBlockVM[];
};

type Actions = {
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  restoreAction: (formData: FormData) => void | Promise<void>;
};

type Props = Actions & {
  sections: BlogSectionVM[];
};

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// History disclosure (one per copy block).
// ---------------------------------------------------------------------------
function History({
  blockKey,
  revisions,
  restoreAction,
}: {
  blockKey: string;
  revisions: BlogRevisionVM[];
  restoreAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (revisions.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-[var(--admin-text-muted)] underline underline-offset-2 hover:text-[var(--admin-text)]"
      >
        {open ? "Hide history" : `History (${revisions.length})`}
      </button>
      {open ? (
        <ul className="mt-2 space-y-2">
          {revisions.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs"
            >
              <span className="text-[var(--admin-text-muted)]">
                Published {fmtWhen(r.created_at)}
                {r.actor_email ? ` \u00b7 ${r.actor_email}` : ""}
              </span>
              <form action={restoreAction} data-block={blockKey}>
                <input type="hidden" name="revision_id" value={r.id} />
                <Button type="submit" variant="neutral" size="sm">
                  Restore to draft
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single editable copy block.
// ---------------------------------------------------------------------------
function CopyBlock({
  block,
  saveDraftAction,
  publishAction,
  restoreAction,
}: { block: BlogBlockVM } & Actions) {
  const [value, setValue] = useState(block.draftValue);
  const dirty = value !== block.draftValue;

  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`f-${block.key}`}
          className="text-sm font-black text-[var(--admin-text)]"
        >
          {block.label}
        </label>
        {block.hasUnpublishedDraft ? (
          <span className="text-xs font-semibold text-[var(--admin-gold)]">
            Unpublished change
          </span>
        ) : null}
      </div>
      {block.help ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{block.help}</p>
      ) : null}

      <form action={saveDraftAction} className="mt-2">
        <input type="hidden" name="block_key" value={block.key} />
        {block.multiline ? (
          <textarea
            id={`f-${block.key}`}
            name="draft_value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
          />
        ) : (
          <input
            id={`f-${block.key}`}
            name="draft_value"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
          />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="save" size="sm">
            Save draft
          </Button>
          <Button type="submit" variant="primary" size="sm" formAction={publishAction}>
            Publish
          </Button>
          {dirty ? (
            <span className="text-xs text-[var(--admin-gold)]">
              Unsaved edits &mdash; Save draft to keep them.
            </span>
          ) : null}
        </div>
      </form>

      <History
        blockKey={block.key}
        revisions={block.revisions}
        restoreAction={restoreAction}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor.
// ---------------------------------------------------------------------------
export function BlogContentEditor({
  sections,
  saveDraftAction,
  publishAction,
  restoreAction,
}: Props) {
  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-black text-[var(--admin-text)]">
            Edit the blog page wording
          </h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Each field is saved and published on its own. <strong>Save draft</strong> keeps a
            private change; <strong>Publish</strong> makes it live on the blog page. Every publish
            is stored so you can roll back. This edits the page&rsquo;s wording only &mdash; your
            actual posts live in Blog &amp; Newsletter.
          </p>
        </div>

        {sections.map((sec) => (
          <div
            key={sec.id}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
          >
            <h3 className="text-sm font-black uppercase tracking-wide text-[var(--admin-gold)]">
              {sec.heading}
            </h3>
            <div className="mt-3 space-y-3">
              {sec.blocks.map((b) => (
                <CopyBlock
                  key={b.key}
                  block={b}
                  saveDraftAction={saveDraftAction}
                  publishAction={publishAction}
                  restoreAction={restoreAction}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs text-[var(--admin-text-muted)]">
        Preview the live page any time at{" "}
        <a
          href="/blog"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          /blog
        </a>
        .
      </p>
    </div>
  );
}
