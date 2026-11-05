"use client";

/**
 * D177 S6 — the store's saved label designs, shared by every device.
 *
 * Owner: "enterprise grade, easy to use." A manager builds "Glass price tag
 * 2.25×1.25" once; every iPad and PC then picks it by name, and the store
 * default opens automatically on a device that has never printed before.
 *
 * Designs live in label_templates (migration 0342). If 0342 has not been
 * applied, this panel shows a one-line hint and the studio keeps working on
 * per-device settings — printing never depends on it.
 */
import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/admin/ui";
import { ConfirmDialog, useToast } from "@/components/admin/ux";
import {
  archiveLabelTemplateAction,
  saveLabelTemplateAction,
  setDefaultLabelTemplateAction,
  type SavedListResult,
  type SavedWriteResult,
} from "@/app/admin/labels/actions";
import { KIND_LABEL, TEMPLATE_NAME_MAX, type SavedTemplate } from "@/lib/printing/label-saved-core";
import { stockById, stockSizeText } from "@/lib/printing/label-stock-core";
import { SYMBOLOGY_LABEL, type Symbology } from "@/lib/printing/label-barcode-core";
import type { LabelTemplate, SubjectKind } from "@/lib/printing/label-layout-core";

export type SavedDesignsProps = {
  kind: SubjectKind;
  templates: SavedTemplate[];
  /** Load problem (e.g. 0342 not applied) — shown as a hint. */
  loadError: string | null;
  migrationMissing: boolean;
  /** The design the current settings came from (null = hand-built). */
  activeId: string | null;
  /** Do the current settings differ from the active design? */
  dirty: boolean;
  current: { printerId: string; stockId: string; template: LabelTemplate };
  onApply: (t: SavedTemplate) => void;
  onListChange: (list: SavedListResult, activeId?: string | null) => void;
};

function designSummary(t: SavedTemplate): string {
  const stock = stockById(t.stockId);
  const sym = SYMBOLOGY_LABEL[t.template.symbology as Symbology] ?? t.template.symbology;
  return `${stock ? stockSizeText(stock) : t.stockId} · ${sym}`;
}

export function SavedDesigns({ kind, templates, loadError, migrationMissing, activeId, dirty, current, onApply, onListChange }: SavedDesignsProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SavedTemplate | null>(null);

  const active = templates.find((t) => t.id === activeId) ?? null;

  const handle = (res: SavedWriteResult, okMessage: string, nextActive?: string | null) => {
    if (res.ok) {
      onListChange({ ok: true, templates: res.templates }, nextActive);
      toast({ tone: "success", message: okMessage });
      return true;
    }
    toast({ tone: "error", message: res.error });
    return false;
  };

  const saveNew = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the design a name.");
      return;
    }
    startTransition(async () => {
      const res = await saveLabelTemplateAction({ kind, name: trimmed, printerId: current.printerId, stockId: current.stockId, template: current.template, makeDefault });
      if (!res.ok) {
        setNameError(res.error);
        return;
      }
      if (handle(res, `Saved “${trimmed}” for the whole store${makeDefault ? " as the default" : ""}.`, res.id ?? null)) {
        setSaveOpen(false);
        setName("");
        setMakeDefault(false);
        setNameError(null);
      }
    });
  };

  const updateActive = () => {
    if (!active) return;
    startTransition(async () => {
      const res = await saveLabelTemplateAction({ id: active.id, kind, name: active.name, printerId: current.printerId, stockId: current.stockId, template: current.template });
      handle(res, `Updated “${active.name}”. Every device will use the new version.`, active.id);
    });
  };

  const makeDefaultActive = (t: SavedTemplate) => {
    startTransition(async () => {
      const res = await setDefaultLabelTemplateAction(t.id, kind);
      handle(res, `“${t.name}” now opens by default on devices with no saved settings.`, activeId);
    });
  };

  const remove = async () => {
    const t = removeTarget;
    if (!t) return;
    const res = await archiveLabelTemplateAction(t.id, kind);
    setRemoveTarget(null);
    handle(res, `Removed “${t.name}”. Labels already printed are not affected.`, activeId === t.id ? null : activeId);
  };

  if (migrationMissing) {
    return (
      <p className="rounded-[var(--admin-radius-md)] border border-dashed border-[var(--admin-border)] px-3 py-2 text-[0.7rem] text-[var(--admin-text-faint)]">
        Store-wide saved designs and print history turn on once migration <code>0342_label_studio.sql</code> is applied (docs/MIGRATIONS_TO_RUN.md). This device still remembers its own settings.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {loadError ? (
        <p role="alert" className="rounded-[var(--admin-radius-md)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs text-[var(--admin-danger)]">
          {loadError}
        </p>
      ) : null}

      {templates.length === 0 && !loadError ? (
        <p className="text-xs text-[var(--admin-text-muted)]">
          No saved designs for {KIND_LABEL[kind].toLowerCase()} yet. Set up the label below, then <strong>Save as a store design</strong> so every device can pick it by name.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Saved designs">
          {templates.map((t) => {
            const isActive = t.id === activeId;
            return (
              <li key={t.id}>
                <div
                  className={`flex h-full flex-col gap-1 rounded-[var(--admin-radius-md)] border p-2.5 text-left transition ${
                    isActive ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]" : "border-[var(--admin-border)] hover:border-[var(--admin-accent)]/60"
                  }`}
                >
                  <button type="button" onClick={() => onApply(t)} className="admin-focus min-w-0 text-left" aria-pressed={isActive} title="Use this design">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-[var(--admin-text)]">{t.name}</span>
                      {t.isDefault ? <Badge tone="green">Default</Badge> : null}
                      {isActive && dirty ? <Badge tone="gold">Edited</Badge> : null}
                    </span>
                    <span className="block truncate text-[0.7rem] text-[var(--admin-text-faint)]">{designSummary(t)}</span>
                  </button>
                  <span className="mt-auto flex flex-wrap gap-3 pt-1 text-[0.7rem]">
                    {!t.isDefault ? (
                      <button type="button" disabled={pending} onClick={() => makeDefaultActive(t)} className="font-semibold text-[var(--admin-accent)] underline disabled:opacity-40">
                        Make default
                      </button>
                    ) : null}
                    <button type="button" disabled={pending} onClick={() => setRemoveTarget(t)} className="font-semibold text-[var(--admin-text-muted)] underline hover:text-[var(--admin-danger)] disabled:opacity-40">
                      Remove
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {active && dirty ? (
          <Button variant="save" size="sm" disabled={pending} onClick={updateActive}>
            Update “{active.name.length > 24 ? `${active.name.slice(0, 23)}…` : active.name}”
          </Button>
        ) : null}
        <Button
          variant="neutral"
          size="sm"
          disabled={pending}
          onClick={() => {
            setSaveOpen((o) => !o);
            setNameError(null);
          }}
          aria-expanded={saveOpen}
        >
          ＋ Save as a store design
        </Button>
      </div>

      {saveOpen ? (
        <form
          className="space-y-2 rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveNew();
          }}
        >
          <label className="block text-xs font-semibold text-[var(--admin-text)]" htmlFor={`gw-design-name-${kind}`}>
            Design name
          </label>
          <input
            id={`gw-design-name-${kind}`}
            value={name}
            maxLength={TEMPLATE_NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            placeholder={kind === "nc" ? "e.g. Glass price tag 2.25×1.25" : "e.g. Re-barcode 2×1 QR"}
            className="admin-focus w-full rounded-[var(--admin-radius-md)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `gw-design-err-${kind}` : undefined}
            autoFocus
          />
          {nameError ? (
            <p id={`gw-design-err-${kind}`} role="alert" className="text-xs text-[var(--admin-danger)]">
              {nameError}
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            Make this the store default for {KIND_LABEL[kind].toLowerCase()}
          </label>
          <p className="text-[0.7rem] text-[var(--admin-text-faint)]">
            Saves the printer, label size, code type and the lines you picked. Copy counts are not saved.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="save" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save design"}
            </Button>
            <Button type="button" variant="neutral" size="sm" disabled={pending} onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove “${removeTarget?.name ?? ""}”?`}
        description="It disappears from the list on every device. Labels already printed, and the print history, are not affected."
        confirmLabel="Remove design"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
