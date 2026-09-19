"use client";

/**
 * src/components/admin/leafly/LeaflyWalkthrough.tsx   (Slice B)
 *
 * THE RENDERER. IT KNOWS NOTHING.
 *
 * Every sentence this component displays comes from `helper-core.ts`. There is
 * not one instructional string in this file, and that is the entire point:
 * the handbook is DATA, so CI can read it, count it, and check every button
 * name it quotes against the real source. Prose baked into JSX can only be
 * checked by a human reading it, and a human reading it is exactly the control
 * that failed when the first draft shipped four wrong button names.
 *
 * So the split is strict:
 *
 *     helper-core.ts   what is true, and why            <- tested in CI
 *     this file        what it looks like               <- no facts at all
 *
 * WHY A "SAFETY LADDER" INSTEAD OF A WALL OF TEXT
 * -----------------------------------------------
 * The push page has thirteen cards. Presented as thirteen cards, it stays
 * intimidating forever, and an intimidated user either avoids the page or
 * clicks the biggest button on it. Presented as a ladder from "cannot possibly
 * hurt" to "replaces your public menu", the same thirteen cards become
 * obvious. Each control therefore renders with a visible SAFE / CAREFUL badge
 * taken from the core's `safe` flag, and anything unsafe cannot render without
 * its caution -- the type makes the caution required in practice and a CI test
 * makes it required in fact.
 *
 * WHY THE STEPS ARE NUMBERED AND COLLAPSIBLE
 * ------------------------------------------
 * The owner asked to be walked through "one baby step at a time". Numbering
 * gives a place to stand ("I am on step 4"); collapsing keeps step 4 from
 * being buried under steps 1-3 once they are done. Progress is deliberately
 * NOT persisted to a server: a half-finished checklist that survives a reload
 * would imply the system knows what you actually did on Leafly's side, and it
 * does not. It knows what you ticked.
 */

import { useState } from "react";
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import type {
  HelperFeature,
  HelperFix,
  HelperQA,
  HelperStep,
  HelperWalkthrough,
} from "@/lib/leafly/helper-core";

/* ------------------------------------------------------------------ steps */

function StepRow({ step, index }: { step: HelperStep; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-[var(--admin-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 py-3 text-left"
        aria-expanded={open}
      >
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            step.irreversible
              ? "bg-[var(--admin-danger-soft,#3a1d1d)] text-[var(--admin-danger)]"
              : "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
          }`}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[var(--admin-text)]">
            {step.do}
          </span>
          {/* The warning rides with the step, not in a legend somewhere else.
              A caution you have to go and look up is a caution you will not
              read at the moment you need it. */}
          {step.irreversible ? (
            <span className="mt-1 inline-block">
              <Badge tone="danger">Cannot be undone</Badge>
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 shrink-0 text-xs text-[var(--admin-muted)]">
          {open ? "Hide" : "Why?"}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 pb-4 pl-9 pr-2 text-sm">
          <p className="text-[var(--admin-muted)]">
            <span className="font-medium text-[var(--admin-text)]">Why: </span>
            {step.why}
          </p>
          {step.expect ? (
            <p className="text-[var(--admin-muted)]">
              <span className="font-medium text-[var(--admin-text)]">
                You should see:{" "}
              </span>
              {step.expect}
            </p>
          ) : null}
          {step.ifStuck ? (
            <p className="text-[var(--admin-muted)]">
              <span className="font-medium text-[var(--admin-text)]">
                If that is not what happens:{" "}
              </span>
              {step.ifStuck}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* --------------------------------------------------------------- features */

function FeatureRow({ feature }: { feature: HelperFeature }) {
  return (
    <div className="border-b border-[var(--admin-border)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-[var(--admin-surface-raised,#20242a)] px-1.5 py-0.5 text-xs font-medium text-[var(--admin-text)]">
          {feature.control}
        </code>
        {feature.safe ? (
          <Badge tone="green">Safe to click</Badge>
        ) : (
          <Badge tone="orange">Careful</Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--admin-text)]">{feature.does}</p>
      <p className="mt-1 text-sm text-[var(--admin-muted)]">
        <span className="font-medium">Why it works this way: </span>
        {feature.why}
      </p>
      <p className="mt-1 text-sm text-[var(--admin-muted)]">
        <span className="font-medium">Use it when: </span>
        {feature.useWhen}
      </p>
      {feature.caution ? (
        <p className="mt-2 rounded border-l-2 border-l-[var(--admin-danger)] bg-[var(--admin-danger-soft,#2a1717)] px-3 py-2 text-sm text-[var(--admin-text)]">
          {feature.caution}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ fixes */

function FixRow({ fix }: { fix: HelperFix }) {
  return (
    <div className="border-b border-[var(--admin-border)] py-3 last:border-b-0">
      <p className="text-sm font-medium text-[var(--admin-text)]">
        {fix.symptom}
      </p>
      <p className="mt-1 text-sm text-[var(--admin-muted)]">
        <span className="font-medium">What it means: </span>
        {fix.meaning}
      </p>
      <p className="mt-1 text-sm text-[var(--admin-muted)]">
        <span className="font-medium">What to do: </span>
        {fix.fix}
      </p>
    </div>
  );
}

function QaRow({ qa }: { qa: HelperQA }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--admin-border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 py-3 text-left"
      >
        <span className="text-sm font-medium text-[var(--admin-text)]">
          {qa.q}
        </span>
        <span className="shrink-0 text-xs text-[var(--admin-muted)]">
          {open ? "\u2212" : "+"}
        </span>
      </button>
      {open ? (
        <p className="pb-3 text-sm text-[var(--admin-muted)]">{qa.a}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

type Tab = "steps" | "features" | "fixes" | "faq";

const TABS: readonly { key: Tab; label: string }[] = [
  { key: "steps", label: "Walk me through it" },
  { key: "features", label: "What every control does" },
  { key: "fixes", label: "When something looks wrong" },
  { key: "faq", label: "Questions" },
];

export function LeaflyWalkthrough({
  walkthrough,
  defaultTab = "steps",
}: {
  walkthrough: HelperWalkthrough;
  defaultTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const w = walkthrough;

  const counts: Record<Tab, number> = {
    steps: w.steps.length,
    features: w.features.length,
    fixes: w.fixes.length,
    faq: w.faq.length,
  };

  return (
    <Card>
      <CardHeader title={w.title} subtitle={w.purpose} />

      {/* READ FIRST sits above the tabs, outside them, and cannot be tabbed
          away from. It carries the one fact that is irreversible or
          time-limited on this screen; burying that behind a tab would make it
          optional reading, and it is not optional. */}
      <p className="mt-3 rounded border-l-2 border-l-[var(--admin-gold)] bg-[var(--admin-gold-soft,#2a2415)] px-3 py-2 text-sm text-[var(--admin-text)]">
        <span className="font-semibold">Read this first: </span>
        {w.readFirst}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === t.key
                ? "bg-[var(--admin-accent)] text-[var(--admin-on-accent,#0b0d10)]"
                : "bg-[var(--admin-surface-raised,#20242a)] text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
            }`}
            aria-pressed={tab === t.key}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <div className="mt-2">
        {tab === "steps" ? (
          <ol className="list-none">
            {w.steps.map((s, i) => (
              <StepRow key={s.do} step={s} index={i} />
            ))}
          </ol>
        ) : null}

        {tab === "features" ? (
          <div>
            {w.features.map((f) => (
              <FeatureRow key={f.control} feature={f} />
            ))}
          </div>
        ) : null}

        {tab === "fixes" ? (
          <div>
            {w.fixes.map((f) => (
              <FixRow key={f.symptom} fix={f} />
            ))}
          </div>
        ) : null}

        {tab === "faq" ? (
          <div>
            {w.faq.map((q) => (
              <QaRow key={q.q} qa={q} />
            ))}
          </div>
        ) : null}
      </div>

      {/* The sources are shown, not hidden. Anyone who doubts a sentence in
          here can go and read the file it came from -- which is the only
          honest way to publish a document that claims to describe code. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-[var(--admin-muted)]">
          Where these facts come from ({w.source.length} files)
        </summary>
        <ul className="mt-2 space-y-0.5">
          {w.source.map((s) => (
            <li key={s} className="text-xs text-[var(--admin-muted)]">
              <code>{s}</code>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
