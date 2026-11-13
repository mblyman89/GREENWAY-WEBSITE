"use client";

/**
 * RegisterKeypad (D241) — the on-screen keypad for every hand-typed box on
 * the register.
 *
 * Owner (2026-11-12): "my employees would like a digital key pad for the
 * register screen. Anytime something needs to be typed by hand, I want a
 * keypad button to be available for them."
 *
 * Mounted ONCE beside <RegisterShell/> (the browser page and the iPad app),
 * so it covers the lock screen, the sale, the drawer screens and every modal
 * without touching each box. When a box that takes typing gets focus, a
 * "Keypad" button appears beside it; tapping it opens a big-key pad at the
 * bottom of the screen: a number pad for PINs, counts, money and phone
 * numbers, letters for names, reasons, notes and email
 * (register-keypad-core decides which).
 *
 * How it types: through the box's own React onChange (native value setter +
 * an "input" event), so every box keeps its own rules (digits only, 6-digit
 * PIN, money format). "Enter" sends a real Enter key, so search boxes search.
 * While the pad is open the box's inputmode is set to "none" so the iPad's
 * own keyboard stays down; it is put back when the pad closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALPHA_EXTRAS,
  ALPHA_ROWS,
  NUMERIC_ROWS,
  applyKeypadKey,
  eligibleForKeypad,
  keypadKindFor,
  keypadPreview,
  type KeypadKey,
  type KeypadKind,
} from "@/lib/pos/register-keypad-core";

type Field = HTMLInputElement | HTMLTextAreaElement;

function asField(el: EventTarget | null): Field | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const ok = eligibleForKeypad({
      tag: el.tagName,
      type: el instanceof HTMLInputElement ? el.type : null,
      inputMode: el.getAttribute("inputmode"),
      readOnly: el.readOnly,
      disabled: el.disabled,
      ariaHidden: el.getAttribute("aria-hidden"),
      keypadOptOut: el.dataset.keypad === "off",
    });
    return ok ? el : null;
  }
  return null;
}

function fieldLabel(el: Field): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  if (el.placeholder) return el.placeholder;
  const lab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
  const t = lab?.textContent?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 60) : "Type here";
}

/** Set a React-controlled box's value so its own onChange runs. */
function writeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function readSelection(el: Field): [number | null, number | null] {
  try {
    return [el.selectionStart, el.selectionEnd];
  } catch {
    return [null, null]; // email / number boxes have no selection API
  }
}

function setCaret(el: Field, caret: number) {
  try {
    const c = Math.min(caret, el.value.length);
    el.setSelectionRange(c, c);
  } catch {
    /* email / number boxes: the caret stays at the end */
  }
}

/** Keep the box focused: every keypad control acts on pointer-down without stealing focus. */
const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

export function RegisterKeypad() {
  const [target, setTarget] = useState<Field | null>(null);
  const [btnPos, setBtnPos] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<KeypadKind>("numeric");
  const [shift, setShift] = useState(false);
  const [, setTick] = useState(0); // re-render the preview after each key
  const savedInputMode = useRef<string | null>(null);
  /** The box whose inputmode the open pad changed (so close() can restore it). */
  const padFieldRef = useRef<Field | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const place = useCallback((el: Field | null) => {
    if (!el || !el.isConnected) {
      setBtnPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
    const vw = window.innerWidth;
    const w = 104;
    const h = 40;
    let top = r.bottom + 6;
    if (top + h > vh - 4) top = Math.max(4, r.top - h - 6);
    const left = Math.max(4, Math.min(vw - w - 4, r.right - w));
    setBtnPos({ top, left });
  }, []);

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setShift(false);
    const el = padFieldRef.current;
    if (el) {
      // Put the box's own inputmode back (the iPad keyboard works again).
      if (savedInputMode.current === null) el.removeAttribute("inputmode");
      else el.setAttribute("inputmode", savedInputMode.current);
    }
    padFieldRef.current = null;
    savedInputMode.current = null;
  }, []);

  // Follow focus: a typeable box gets the button; anything else hides it.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-register-keypad]")) return;
      // Same box (its inputmode is "none" while the pad is open): the pad stays.
      if (openRef.current && e.target === padFieldRef.current) return;
      const f = asField(e.target);
      if (openRef.current) close(); // another box (or none): close; the button moves to it
      setTarget(f);
      place(f);
    };
    const onFocusOut = () => {
      // Let the next focusin land first; hide only if focus went nowhere typeable.
      window.setTimeout(() => {
        if (openRef.current) return;
        const f = asField(document.activeElement);
        setTarget(f);
        place(f);
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [close, place]);

  // Keep the button beside its box while the screen scrolls or resizes, and
  // close the pad if the box goes away (its screen closed).
  useEffect(() => {
    if (!target) return;
    const re = () => place(target);
    window.addEventListener("scroll", re, true);
    window.addEventListener("resize", re);
    window.visualViewport?.addEventListener("resize", re);
    const gone = window.setInterval(() => {
      if (!target.isConnected) {
        close();
        setTarget(null);
        setBtnPos(null);
      }
    }, 400);
    return () => {
      window.removeEventListener("scroll", re, true);
      window.removeEventListener("resize", re);
      window.visualViewport?.removeEventListener("resize", re);
      window.clearInterval(gone);
    };
  }, [target, place, close]);

  const openPad = () => {
    const el = target;
    if (!el) return;
    setKind(
      keypadKindFor({
        tag: el.tagName,
        type: el instanceof HTMLInputElement ? el.type : null,
        inputMode: el.getAttribute("inputmode"),
      }),
    );
    // Hold the iPad's own keyboard down while the pad is open.
    savedInputMode.current = el.getAttribute("inputmode");
    padFieldRef.current = el;
    openRef.current = true; // before the re-focus below, so focusin keeps the pad
    el.setAttribute("inputmode", "none");
    el.blur();
    el.focus({ preventScroll: true });
    setOpen(true);
  };

  const press = (key: KeypadKey) => {
    const el = target;
    if (!el || !el.isConnected) {
      close();
      return;
    }
    const [a, b] = readSelection(el);
    const max = el.maxLength > 0 ? el.maxLength : null;
    const next = applyKeypadKey(el.value, a, b, key, max);
    writeValue(el, next.value);
    requestAnimationFrame(() => setCaret(el, next.caret));
    if (shift && key.t === "char") setShift(false);
    setTick((t) => t + 1);
  };

  const enter = () => {
    const el = target;
    if (!el) return;
    const opts: KeyboardEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    close();
  };

  const keyCls =
    "flex h-14 items-center justify-center rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-xl font-bold text-[var(--pos-text)] active:bg-[var(--pos-accent-soft)] select-none touch-manipulation";
  const smallKeyCls =
    "flex h-12 min-w-0 items-center justify-center rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-lg font-semibold text-[var(--pos-text)] active:bg-[var(--pos-accent-soft)] select-none touch-manipulation";
  const key = (label: string, k: KeypadKey, cls: string = keyCls, aria?: string, reactKey?: string) => (
    <button key={reactKey} type="button" tabIndex={-1} aria-label={aria ?? label} className={cls} onPointerDown={keep} onMouseDown={keep} onClick={() => press(k)}>
      {label}
    </button>
  );

  const masked = target instanceof HTMLInputElement && target.type === "password";
  const preview = target ? keypadPreview(target.value, masked) : "";

  return (
    <div data-register-keypad="">
      {target && btnPos && !open ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open the on-screen keypad"
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={openPad}
          style={{ position: "fixed", top: btnPos.top, left: btnPos.left, width: 104, height: 40, zIndex: 95 }}
          className="flex items-center justify-center gap-1.5 rounded-full border-2 border-[var(--pos-accent)] bg-[var(--pos-surface)] text-sm font-bold text-[var(--pos-accent)] shadow-lg select-none touch-manipulation"
        >
          <span aria-hidden="true">⌨</span> Keypad
        </button>
      ) : null}
      {open && target ? (
        <div
          role="dialog"
          aria-label="On-screen keypad"
          onPointerDown={keep}
          onMouseDown={keep}
          style={{ zIndex: 96 }}
          className="fixed inset-x-0 bottom-0 border-t-2 border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        >
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-2 flex items-center gap-2">
              <div className="min-w-0 flex-1 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">{fieldLabel(target)}</p>
                <p className={`min-h-[1.75rem] truncate text-lg font-bold text-[var(--pos-text)] ${masked ? "tracking-[0.4em]" : ""}`}>
                  {preview || <span className="font-normal text-[var(--pos-text-muted)]">&nbsp;</span>}
                </p>
              </div>
              {kind !== "alpha" ? (
                <button type="button" tabIndex={-1} onClick={() => setKind("alpha")} className="h-12 rounded-lg border border-[var(--pos-border-strong)] px-3 text-sm font-semibold text-[var(--pos-text)]">
                  ABC
                </button>
              ) : (
                <button type="button" tabIndex={-1} onClick={() => setKind("numeric")} className="h-12 rounded-lg border border-[var(--pos-border-strong)] px-3 text-sm font-semibold text-[var(--pos-text)]">
                  123
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={close}
                className="h-12 rounded-lg bg-[var(--pos-accent)] px-5 text-base font-bold text-[var(--pos-accent-ink)]"
              >
                Done
              </button>
            </div>

            {kind === "alpha" ? (
              <div className="space-y-1.5">
                {ALPHA_ROWS.map((row, i) => (
                  <div key={i} className="flex justify-center gap-1.5">
                    {row.map((c) => {
                      const out = shift ? c.toUpperCase() : c;
                      return (
                        <div key={c} className="w-[9.2%]">
                          {key(out, { t: "char", c: out }, `${smallKeyCls} w-full`)}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="flex justify-center gap-1.5">
                  {ALPHA_EXTRAS.map((c) => (
                    <div key={c} className="w-[9.2%]">
                      {key(c, { t: "char", c }, `${smallKeyCls} w-full`)}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-pressed={shift}
                    onClick={() => setShift((v) => !v)}
                    className={`${smallKeyCls} w-[14%] ${shift ? "!bg-[var(--pos-accent-soft)]" : ""}`}
                  >
                    ⇧ Caps
                  </button>
                  <div className="flex-1">
                    {key("space", { t: "space" }, `${smallKeyCls} w-full`)}
                  </div>
                  <div className="w-[12%]">
                    {key("⌫", { t: "backspace" }, `${smallKeyCls} w-full`, "Backspace")}
                  </div>
                  <div className="w-[12%]">
                    {key("Clear", { t: "clear" }, `${smallKeyCls} w-full`)}
                  </div>
                  <button type="button" tabIndex={-1} onClick={enter} className={`${smallKeyCls} w-[14%]`}>
                    Enter ↵
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-sm grid-cols-3 gap-2">
                {NUMERIC_ROWS.flat().map((c) => key(c, { t: "char", c }, keyCls, undefined, c))}
                {kind === "decimal" ? key(".", { t: "char", c: "." }) : key("Clear", { t: "clear" }, `${keyCls} text-base`)}
                {key("0", { t: "char", c: "0" })}
                {key("⌫", { t: "backspace" }, keyCls, "Backspace")}
                {kind === "decimal" ? (
                  <div className="col-span-3">
                    {key("Clear", { t: "clear" }, `${keyCls} w-full text-base`)}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
