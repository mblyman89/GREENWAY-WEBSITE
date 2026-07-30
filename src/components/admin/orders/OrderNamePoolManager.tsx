"use client";

/**
 * src/components/admin/orders/OrderNamePoolManager.tsx
 *
 * SLICE 113 — the "Order name pool" manager on /admin/orders.
 *
 * Michael maintains a small recycling list of fun, custom order names. The
 * system hands them to online orders in a fair Least-Recently-Used rotation and
 * reuses them. This panel lets him add / rename / enable / disable / remove /
 * reorder names, with:
 *   - a live, deterministic "next few orders will be named…" preview,
 *   - a case/space-insensitive duplicate guard (client hint + server enforce),
 *   - a NON-BLOCKING I-502 compliance nudge (appeal-to-minors / profanity), and
 *   - honest messaging when the pool is empty or migration 0147 isn't applied
 *     (orders simply keep their GWY-XXXXXX numbers).
 *
 * All mutations go through server actions (add/update/toggle/delete/reorder);
 * the preview + nudge are computed on the client with the SAME pure cores the
 * server uses, so they can never disagree.
 */

import { useMemo, useState } from "react";
import { Button, Card } from "@/components/admin/ui";
import {
  ORDER_NAME_MAX_LEN,
  previewNextOrderNames,
  validateOrderName,
  type OrderNamePoolRow,
} from "@/lib/orders/order-name-pool-core";
import { reviewOrderName } from "@/lib/orders/order-name-compliance-core";
import {
  addPoolNameAction,
  updatePoolNameAction,
  togglePoolNameAction,
  deletePoolNameAction,
  reorderPoolNamesAction,
} from "@/app/admin/orders/actions";

const INPUT =
  "w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none";
const LABEL = "text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-muted)]";

export function OrderNamePoolManager({
  names,
  migrationReady,
  message,
  error,
}: {
  names: OrderNamePoolRow[];
  /** False when migration 0147 isn't applied yet (table missing). */
  migrationReady: boolean;
  message?: string | null;
  error?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const enabledCount = names.filter((n) => n.enabled).length;

  // Live "next few will be…" — the exact LRU rotation the server uses.
  const preview = useMemo(() => previewNextOrderNames(names, 6), [names]);

  // Client-side duplicate + length hint for the add box (server re-enforces).
  const addCheck = useMemo(
    () => validateOrderName(names, draft),
    [names, draft],
  );
  const draftNudge = useMemo(
    () => (draft.trim() ? reviewOrderName(draft) : null),
    [draft],
  );

  const showAddError = draft.trim().length > 0 && !addCheck.ok;

  return (
    <Card padding="sm" className="sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-[var(--admin-text)]">
            🎟️ Order name pool
          </h2>
          <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
            Fun names the system gives online orders and recycles.{" "}
            {enabledCount > 0
              ? `${enabledCount} active name${enabledCount === 1 ? "" : "s"}.`
              : "None active — orders use their GWY number."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs font-bold text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
        >
          {open ? "Hide" : "Manage"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          {/* Status banners */}
          {message ? (
            <p className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--admin-accent)]">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--admin-danger)]">
              {error}
            </p>
          ) : null}

          {!migrationReady ? (
            <p className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-3 py-2 text-xs font-semibold text-[var(--admin-gold)]">
              Heads up: the order-name pool database table isn’t set up yet
              (migration 0147). You can still add names below once it’s applied —
              until then every order keeps its GWY-XXXXXX number.
            </p>
          ) : null}

          {/* Live preview */}
          {preview.length > 0 ? (
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2.5">
              <p className={LABEL}>Next few orders will be named…</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {preview.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      i === 0
                        ? "bg-[var(--admin-accent)] text-black"
                        : "border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)]"
                    }`}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Add a name */}
          <form action={addPoolNameAction} className="space-y-1.5">
            <label className={LABEL} htmlFor="pool-add">
              Add a name
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="pool-add"
                name="name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={ORDER_NAME_MAX_LEN + 5}
                placeholder="e.g. High Life"
                className={INPUT + " min-w-[12rem] flex-1"}
                autoComplete="off"
              />
              <Button type="submit" variant="confirm" size="sm" disabled={!addCheck.ok}>
                Add name
              </Button>
            </div>
            {showAddError ? (
              <p className="text-xs font-semibold text-[var(--admin-danger)]">{addCheck.error}</p>
            ) : null}
            {draftNudge && draftNudge.level === "caution" ? (
              <p className="text-xs text-[var(--admin-gold)]">
                ⚠️ Compliance heads-up: {draftNudge.reasons.join(" ")} You can still add it —
                just double-check it’s appropriate for a public receipt.
              </p>
            ) : null}
          </form>

          {/* The list */}
          {names.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--admin-border)] px-3 py-4 text-center text-xs text-[var(--admin-text-muted)]">
              No names yet. Add a few fun ones above — they’ll be assigned to new
              online orders in rotation.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {names.map((n, idx) => {
                const nudge = reviewOrderName(n.name);
                const isEditing = editingId === n.id;
                return (
                  <li
                    key={n.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
                  >
                    {/* Reorder */}
                    <div className="flex flex-col">
                      <ReorderButton
                        ids={move(names.map((x) => x.id), idx, idx - 1)}
                        disabled={idx === 0}
                        label="▲"
                      />
                      <ReorderButton
                        ids={move(names.map((x) => x.id), idx, idx + 1)}
                        disabled={idx === names.length - 1}
                        label="▼"
                      />
                    </div>

                    {/* Name / inline edit */}
                    {isEditing ? (
                      <form
                        action={updatePoolNameAction}
                        className="flex flex-1 flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={n.id} />
                        <input
                          name="name"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          maxLength={ORDER_NAME_MAX_LEN + 5}
                          className={INPUT + " min-w-[10rem] flex-1"}
                          autoComplete="off"
                        />
                        <Button type="submit" variant="save" size="sm">
                          Save
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-1 items-center gap-2">
                        <span
                          className={`text-sm font-bold ${
                            n.enabled
                              ? "text-[var(--admin-text)]"
                              : "text-[var(--admin-text-faint)] line-through"
                          }`}
                        >
                          {n.name}
                        </span>
                        {nudge.level === "caution" ? (
                          <span title={nudge.reasons.join(" ")} className="text-xs">
                            ⚠️
                          </span>
                        ) : null}
                        {n.assigned_count > 0 ? (
                          <span className="text-[0.65rem] text-[var(--admin-text-faint)]">
                            used {n.assigned_count}×
                          </span>
                        ) : null}
                      </div>
                    )}

                    {/* Row actions */}
                    {!isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(n.id);
                            setEditValue(n.name);
                          }}
                          className="rounded-md border border-[var(--admin-border)] px-2 py-1 text-[0.65rem] font-bold text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                        >
                          Edit
                        </button>
                        <form action={togglePoolNameAction}>
                          <input type="hidden" name="id" value={n.id} />
                          <input type="hidden" name="enabled" value={(!n.enabled).toString()} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--admin-border)] px-2 py-1 text-[0.65rem] font-bold text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                          >
                            {n.enabled ? "Disable" : "Enable"}
                          </button>
                        </form>
                        <form action={deletePoolNameAction}>
                          <input type="hidden" name="id" value={n.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--admin-danger)]/40 px-2 py-1 text-[0.65rem] font-bold text-[var(--admin-danger)] hover:bg-[var(--admin-danger-soft)]"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/** A one-click reorder submit that posts the new id order to the server. */
function ReorderButton({
  ids,
  disabled,
  label,
}: {
  ids: string[];
  disabled: boolean;
  label: string;
}) {
  return (
    <form action={reorderPoolNamesAction}>
      <input type="hidden" name="ids" value={ids.join(",")} />
      <button
        type="submit"
        disabled={disabled}
        className="px-1 text-[0.6rem] leading-tight text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)] disabled:opacity-25"
        aria-label={label === "▲" ? "Move up" : "Move down"}
      >
        {label}
      </button>
    </form>
  );
}

/** Pure array move (returns a new array with element at `from` moved to `to`). */
function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr.slice();
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
