"use client";

/**
 * D234 C-6 (SOP-11b G-107; F-11-30): the "Save this design to brand banners"
 * name dialog. Replaces the old browser `window.prompt` box: the name starts
 * as the headline's first line (`suggestBrandName`), an empty or too-long
 * name is explained (`brandNameError`), and a name already in the list gets
 * a gentle note that saving adds another one (`brandNameNote`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { BRAND_NAME_MAX, brandNameError, brandNameNote } from "@/lib/cms/studio-help-core";

export function BrandNameDialog({
  open,
  initial,
  existing,
  busy,
  onSave,
  onCancel,
}: {
  open: boolean;
  initial: string;
  existing: readonly { name: string }[] | null;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const hintId = useId();
  const [name, setName] = useState(initial);
  const [tried, setTried] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Latest busy/onCancel without re-running the effect (it selects the name once, on open).
  const live = useRef({ busy, onCancel });
  useEffect(() => {
    live.current = { busy, onCancel };
  });

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.select(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !live.current.busy) live.current.onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;
  const error = brandNameError(name);
  const note = brandNameNote(name, existing);
  const submit = () => {
    setTried(true);
    if (!error && !busy) onSave(name.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-brand-name-dialog
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-md rounded-[var(--admin-radius-xl)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 shadow-[var(--admin-shadow-lg)]">
        <h2 id={titleId} className="text-lg font-semibold text-white">
          Save this design to brand banners
        </h2>
        <p className="mt-2 text-sm text-white/70">
          It goes to Website → Branding → Saved banners, so any Design Studio can start from it. Your picture is saved with it.
        </p>
        <label className="mt-4 block">
          <span className="text-xs text-white/60">Name</span>
          <input
            ref={inputRef}
            value={name}
            maxLength={BRAND_NAME_MAX + 20}
            aria-describedby={hintId}
            aria-invalid={tried && !!error}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="mt-1 w-full rounded-lg border border-white/15 bg-[#161616] px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]/60"
          />
        </label>
        <p id={hintId} className="mt-1 text-xs text-white/60">
          {tried && error ? <span className="text-[var(--admin-danger,#f87171)]">{error}</span> : note ? <span className="text-[var(--admin-gold)]">{note}</span> : `${name.trim().length}/${BRAND_NAME_MAX} characters.`}
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <Button type="button" variant="neutral" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy || (tried && !!error)} onClick={submit}>
            {busy ? "Saving…" : "Save to brand banners"}
          </Button>
        </div>
      </div>
    </div>
  );
}
