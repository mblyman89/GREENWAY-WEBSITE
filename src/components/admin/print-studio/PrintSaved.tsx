"use client";

/**
 * D263 S8 - Save / Save as new / My designs / Templates for Print Studio.
 * Opening something replaces the piece on screen (asks first).
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import { BUILTIN_TEMPLATES, builtinDoc, type PrintDesignSummary, type PrintDoc } from "@/lib/printing/print-designs-core";
import { archivePrintDesignAction, listPrintDesignsAction, openPrintDesignAction, savePrintDesignAction } from "@/app/admin/marketing/print-studio/design-actions";

export type SavedRef = { id: string; rev: number };

const input = "rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white";

export function PrintSaved({ getDoc, saved, onSaved, onOpen, hasDraft }: { getDoc: () => PrintDoc | null; saved: SavedRef | null; onSaved: (r: SavedRef, name: string) => void; onOpen: (doc: PrintDoc, ref: SavedRef | null) => void; hasDraft: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [items, setItems] = useState<PrintDesignSummary[] | null>(null);
  const [tpl, setTpl] = useState(BUILTIN_TEMPLATES[0].id);

  async function refresh() {
    const r = await listPrintDesignsAction();
    setItems(r.items);
    if (r.error) setMsg(r.error);
  }

  async function save(asNew: boolean, isTemplate = false) {
    const doc = getDoc();
    if (!doc) return setMsg("Start a design first.");
    let name = doc.name;
    if (asNew || isTemplate) {
      const n = window.prompt(isTemplate ? "Template name" : "Name for the new copy", isTemplate ? `${doc.name} template` : `${doc.name} copy`);
      if (n === null) return;
      name = n;
    }
    setBusy(true);
    setMsg(null);
    try {
      const keep = !asNew && !isTemplate && saved;
      const r = await savePrintDesignAction({ id: keep ? saved.id : null, baseRev: keep ? saved.rev : 0, doc: { ...doc, name }, isTemplate });
      if (!r.ok) return setMsg(r.error);
      if (!isTemplate) onSaved({ id: r.id, rev: r.rev }, name);
      setMsg(isTemplate ? `Saved template “${name}”.` : `Saved “${name}”.`);
      if (items) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function open(s: PrintDesignSummary) {
    if (hasDraft && !window.confirm(`Open “${s.name}”? The piece on screen will be replaced (save it first if you need it).`)) return;
    setBusy(true);
    try {
      const r = await openPrintDesignAction(s.id);
      if (!r.ok) return setMsg(r.error);
      // A template opens as a fresh unsaved copy so the template stays as it is.
      onOpen(r.isTemplate ? { ...r.doc, name: r.doc.name.replace(/ template$/i, "") } : r.doc, r.isTemplate ? null : { id: r.id, rev: r.rev });
      setMsg(r.isTemplate ? `Started from template “${s.name}”. Save gives it its own copy.` : `Opened “${s.name}”.`);
    } finally {
      setBusy(false);
    }
  }

  async function archive(s: PrintDesignSummary) {
    if (!window.confirm(`Archive “${s.name}”? It disappears from this list (kept in the database).`)) return;
    const r = await archivePrintDesignAction(s.id);
    if (!r.ok) return setMsg(r.error ?? "Archive failed.");
    await refresh();
  }

  function useBuiltin() {
    const doc = builtinDoc(tpl);
    if (!doc) return;
    if (hasDraft && !window.confirm("Start from this template? The piece on screen will be replaced.")) return;
    onOpen(doc, null);
    setMsg("Template loaded - change the words and pictures, then Save.");
  }

  const mine = (items ?? []).filter((i) => !i.isTemplate);
  const tpls = (items ?? []).filter((i) => i.isTemplate);
  const row = (s: PrintDesignSummary) => (
    <li key={s.id} className="flex flex-wrap items-center gap-2">
      <button type="button" className="text-left underline decoration-white/30 hover:text-[var(--admin-gold)]" onClick={() => void open(s)} disabled={busy}>
        {s.name}
      </button>
      <span className="text-white/50">
        {s.size} · {s.pages} page{s.pages === 1 ? "" : "s"} · {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ""}
        {saved?.id === s.id ? " · open now" : ""}
      </span>
      <button type="button" className="text-white/40 hover:text-red-300" onClick={() => void archive(s)} aria-label={`Archive ${s.name}`}>
        archive
      </button>
    </li>
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || !hasDraft} onClick={() => void save(false)}>
          {saved ? "Save" : "Save to my designs"}
        </Button>
        {saved ? (
          <Button type="button" size="sm" variant="neutral" disabled={busy || !hasDraft} onClick={() => void save(true)}>
            Save as new
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="neutral" disabled={busy || !hasDraft} onClick={() => void save(true, true)}>
          Save as template
        </Button>
        <Button type="button" size="sm" variant="neutral" disabled={busy} onClick={() => void refresh()}>
          {items ? "Refresh list" : "My designs & templates"}
        </Button>
        <span className="text-white/50">|</span>
        <select aria-label="Starter template" className={input} value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {BUILTIN_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="neutral" onClick={useBuiltin}>
          Start from starter
        </Button>
      </div>
      <p className="text-white/50">{BUILTIN_TEMPLATES.find((t) => t.id === tpl)?.blurb}</p>
      {msg ? <p className="text-[var(--admin-gold)]">{msg}</p> : null}
      {items ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold">My designs ({mine.length})</div>
            {mine.length ? <ul className="space-y-1">{mine.map(row)}</ul> : <p className="text-white/50">Nothing saved yet.</p>}
          </div>
          <div>
            <div className="mb-1 font-semibold">Shop templates ({tpls.length})</div>
            {tpls.length ? <ul className="space-y-1">{tpls.map(row)}</ul> : <p className="text-white/50">No templates yet - use “Save as template”.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
