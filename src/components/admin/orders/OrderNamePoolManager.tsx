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
import { parseBulkNames, rotationCapacity } from "@/lib/orders/order-name-rotation-core";
import { reviewOrderName } from "@/lib/orders/order-name-compliance-core";
import {
  addPoolNameAction,
  bulkAddPoolNamesAction,
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
  dailyVolume = 200,
}: {
  names: OrderNamePoolRow[];
  /** False when migration 0147 isn't applied yet (table missing). */
  migrationReady: boolean;
  message?: string | null;
  error?: string | null;
  /** The shop's typical transactions per day, used to translate gap → hours. */
  dailyVolume?: number;
}) {
  // SLICE 23 — COLLAPSED BY DEFAULT. The owner: "please make the overlay box
  // completely collapsable it takes up way too much space right now." With
  // fifty-plus names this panel was taller than the orders list it sits above,
  // so the default is now closed and the header alone carries the status.
  const [open, setOpen] = useState(false);
  const [showList, setShowList] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [draft, setDraft] = useState("");
  const [bulkDraft, setBulkDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const enabledCount = names.filter((n) => n.enabled).length;

  // Live "next few will be…" — the exact rotation the server uses.
  const preview = useMemo(() => previewNextOrderNames(names, 6), [names]);

  // What this pool size can actually promise, in the owner's own numbers.
  const capacity = useMemo(
    () => rotationCapacity(enabledCount, 25, dailyVolume),
    [enabledCount, dailyVolume],
  );

  // Bulk paste: parse on the client with the SAME pure function the server
  // uses, so the "will add N" count cannot disagree with what actually lands.
  const bulkParsed = useMemo(() => parseBulkNames(bulkDraft), [bulkDraft]);
  const bulkReport = useMemo(() => {
    const running: Pick<OrderNamePoolRow, "id" | "name">[] = names.map((r) => ({
      id: r.id,
      name: r.name,
    }));
    const willAdd: string[] = [];
    const willSkip: { name: string; reason: string }[] = [];
    for (const candidate of bulkParsed) {
      const check = validateOrderName(running, candidate);
      if (!check.ok) {
        willSkip.push({ name: candidate, reason: check.error ?? "Invalid." });
        continue;
      }
      willAdd.push(check.value);
      running.push({ id: `pending-${willAdd.length}`, name: check.value });
    }
    const flagged = willAdd.filter((n) => reviewOrderName(n).level === "caution");
    return { willAdd, willSkip, flagged };
  }, [bulkParsed, names]);

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
          {/* Collapsed summary carries the whole story in one line, so the
              panel does not need to be open to be useful. */}
          <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
            Fun names for online orders and register receipts, in rotation.{" "}
            {enabledCount > 0 ? (
              <>
                <span className="font-bold text-[var(--admin-text)]">
                  {enabledCount} active
                </span>
                {capacity.hoursBetweenRepeats !== null ? (
                  <> · a name repeats about every {capacity.hoursBetweenRepeats} h</>
                ) : null}
                {!capacity.healthy ? (
                  <span className="text-[var(--admin-gold)]"> · pool is thin</span>
                ) : null}
              </>
            ) : (
              "None active — receipts use the real number."
            )}
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

          {/* SLICE 23 — honest capacity. With P names the best possible spacing
              is P-1, so this states the real ceiling and, when the pool is too
              thin, exactly how many more names would fix it. */}
          {enabledCount > 0 ? (
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                capacity.meetsTarget && capacity.healthy
                  ? "border-[var(--admin-border)] bg-[var(--admin-surface-2)]"
                  : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]"
              }`}
            >
              <p className={LABEL}>Rotation health</p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                With <strong className="text-[var(--admin-text)]">{enabledCount}</strong>{" "}
                active name{enabledCount === 1 ? "" : "s"}, a name can go at best{" "}
                <strong className="text-[var(--admin-text)]">{capacity.maxGap}</strong>{" "}
                other sale{capacity.maxGap === 1 ? "" : "s"} before it comes back
                {capacity.hoursBetweenRepeats !== null ? (
                  <> — roughly every {capacity.hoursBetweenRepeats} hours at ~{dailyVolume} sales a day</>
                ) : null}
                .{" "}
                {capacity.meetsTarget ? (
                  <span className="text-[var(--admin-accent)]">
                    That clears the 25-sale target.
                  </span>
                ) : (
                  <span className="font-semibold text-[var(--admin-gold)]">
                    Add {capacity.namesNeeded} more to clear the 25-sale target.
                  </span>
                )}
              </p>
            </div>
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

          {/* SLICE 23 — one name, or a whole pasted list. */}
          <div className="flex gap-1.5">
            {(["single", "bulk"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  mode === m
                    ? "bg-[var(--admin-accent)] text-black"
                    : "border border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {m === "single" ? "Add one" : "Paste a list"}
              </button>
            ))}
          </div>

          {mode === "bulk" ? (
            <form action={bulkAddPoolNamesAction} className="space-y-1.5">
              <label className={LABEL} htmlFor="pool-bulk">
                Paste names — one per line (commas, semicolons and tabs work too)
              </label>
              <textarea
                id="pool-bulk"
                name="names"
                value={bulkDraft}
                onChange={(e) => setBulkDraft(e.target.value)}
                rows={6}
                placeholder={"High Life\nPurple Rain\nSunset Sherbet"}
                className={INPUT + " font-mono"}
                autoComplete="off"
              />
              {/* Show the outcome BEFORE submitting — numbering and detail so
                  nothing disappears silently. */}
              {bulkParsed.length > 0 ? (
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-[var(--admin-text)]">
                    {bulkReport.willAdd.length} will be added
                    {bulkReport.willSkip.length > 0
                      ? `, ${bulkReport.willSkip.length} skipped`
                      : ""}
                    .
                  </p>
                  {bulkReport.willSkip.length > 0 ? (
                    <ul className="space-y-0.5 text-[var(--admin-danger)]">
                      {bulkReport.willSkip.slice(0, 6).map((s, i) => (
                        <li key={`${s.name}-${i}`}>
                          “{s.name}” — {s.reason}
                        </li>
                      ))}
                      {bulkReport.willSkip.length > 6 ? (
                        <li>…and {bulkReport.willSkip.length - 6} more.</li>
                      ) : null}
                    </ul>
                  ) : null}
                  {bulkReport.flagged.length > 0 ? (
                    <p className="text-[var(--admin-gold)]">
                      ⚠️ Compliance heads-up on {bulkReport.flagged.length} name
                      {bulkReport.flagged.length === 1 ? "" : "s"}:{" "}
                      {bulkReport.flagged.slice(0, 4).join(", ")}. You can still add
                      them — just double-check they’re fine on a public receipt.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button
                type="submit"
                variant="confirm"
                size="sm"
                disabled={bulkReport.willAdd.length === 0}
              >
                Add {bulkReport.willAdd.length > 0 ? bulkReport.willAdd.length : ""} name
                {bulkReport.willAdd.length === 1 ? "" : "s"}
              </Button>
            </form>
          ) : null}

          {/* Add a name */}
          <form
            action={addPoolNameAction}
            className={mode === "single" ? "space-y-1.5" : "hidden"}
          >
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

          {/* The list. SLICE 23 — this is the part that "takes up way too much
              space": at fifty-plus names it ran for pages. It is now behind its
              own toggle and scroll-capped, so managing the pool never buries
              the orders table underneath it. */}
          {names.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--admin-border)] px-3 py-4 text-center text-xs text-[var(--admin-text-muted)]">
              No names yet. Add a few fun ones above — they’ll be assigned to new
              orders and register receipts in rotation.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowList((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs font-bold text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
              >
                <span>
                  All {names.length} name{names.length === 1 ? "" : "s"}
                  {names.length - enabledCount > 0
                    ? ` (${names.length - enabledCount} disabled)`
                    : ""}
                </span>
                <span aria-hidden="true">{showList ? "▲" : "▼"}</span>
              </button>
              {showList ? (
            <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
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
              ) : null}
            </>
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
