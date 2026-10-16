"use client";

/**
 * PromptBox — a Playground-style prompt editor (R62). What you type is sent to
 * FLUX exactly as written (line breaks included). Templates and snippets are
 * optional, visible insertions — nothing is ever appended behind your back.
 */
import { useState } from "react";
import { insertSnippet, promptLengthHint, type PromptSnippet, type SnippetGroup } from "@/lib/marketing/flux-presets-core";

export function PromptBox({
  value,
  onChange,
  templates,
  snippets,
  warnings,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  templates: PromptSnippet[];
  snippets: SnippetGroup[];
  warnings: string[];
  placeholder: string;
  onSubmit?: () => void;
}) {
  const [group, setGroup] = useState<string>("");
  const len = promptLengthHint(value);
  const activeGroup = snippets.find((g) => g.id === group);

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={7}
        placeholder={placeholder}
        aria-label="Prompt"
        className="admin-focus w-full resize-y rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] p-3 text-sm leading-relaxed text-[var(--admin-text)] outline-none placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)]"
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-[var(--admin-text-faint)]">
        <span>
          {len.words} words{len.note ? ` · ${len.note}` : ""}
        </span>
        <span>Sent exactly as written · Ctrl/⌘ + Enter to generate</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            if (t) onChange(value.trim() ? `${value.replace(/\s+$/, "")}\n\n${t.text}` : t.text);
          }}
          aria-label="Insert a template"
          className="rounded-md border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs text-[var(--admin-text)]"
        >
          <option value="">+ Template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {snippets.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup((cur) => (cur === g.id ? "" : g.id))}
            aria-expanded={group === g.id}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${group === g.id ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"}`}
          >
            + {g.label}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange("")} className="ml-auto text-xs text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]">
            Clear
          </button>
        )}
      </div>
      {activeGroup && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {activeGroup.snippets.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.text}
              onClick={() => onChange(insertSnippet(value, s.text))}
              className="rounded-full border border-[var(--admin-border-strong)] px-2.5 py-0.5 text-[0.7rem] text-[var(--admin-text)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[0.72rem] text-[var(--admin-orange)]">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
