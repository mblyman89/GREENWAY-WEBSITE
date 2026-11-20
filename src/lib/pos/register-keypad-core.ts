/**
 * D241 — the register's on-screen keypad (pure core).
 *
 * Owner (2026-11-12): "my employees would like a digital key pad for the
 * register screen. Anytime something needs to be typed by hand, I want a
 * keypad button to be available for them."
 *
 * ONE keypad for EVERY hand-typed box on the register: RegisterKeypad
 * (src/app/(site)/pos/RegisterKeypad.tsx) watches which box has focus and
 * shows a "Keypad" button beside it. This core decides:
 *   - which boxes get the button (eligibleForKeypad): text-like inputs and
 *     textareas that are not read-only / disabled / hidden, never the
 *     scanner's hidden focus sink (aria-hidden, inputMode "none");
 *   - which pad opens (keypadKindFor): number pad for PINs, counts, money
 *     and phone numbers; full letters for names, reasons, notes, email;
 *   - what a key press does to the text (applyKeypadKey), honouring the
 *     caret / selection and the box's maxLength.
 *
 * Pure: no DOM, no React. Self-tested below and in vitest.
 */

export type KeypadKind = "numeric" | "decimal" | "alpha";

/** What the keypad needs to know about a box (read from the element). */
export type KeypadFieldInfo = {
  tag: string;
  type?: string | null;
  inputMode?: string | null;
  readOnly?: boolean;
  disabled?: boolean;
  ariaHidden?: string | null;
  /** data-keypad="off" opts a box out (none do today). */
  keypadOptOut?: boolean;
};

/** Input types a person types into. Everything else (checkbox, date, file…) is skipped. */
const TYPEABLE_INPUT_TYPES = new Set(["", "text", "search", "tel", "email", "password", "number", "url"]);

export function eligibleForKeypad(f: KeypadFieldInfo): boolean {
  const tag = (f.tag ?? "").toLowerCase();
  if (tag !== "input" && tag !== "textarea") return false;
  if (f.readOnly || f.disabled || f.keypadOptOut) return false;
  if ((f.ariaHidden ?? "").toLowerCase() === "true") return false;
  if ((f.inputMode ?? "").toLowerCase() === "none") return false;
  if (tag === "input" && !TYPEABLE_INPUT_TYPES.has((f.type ?? "").toLowerCase())) return false;
  return true;
}

export function keypadKindFor(f: Pick<KeypadFieldInfo, "tag" | "type" | "inputMode">): KeypadKind {
  const im = (f.inputMode ?? "").toLowerCase();
  const type = (f.type ?? "").toLowerCase();
  if (im === "decimal") return "decimal";
  if (im === "numeric" || im === "tel" || type === "tel" || type === "number") return "numeric";
  return "alpha";
}

/** A key on the pad. Characters are typed as-is; the rest are actions. */
export type KeypadKey =
  | { t: "char"; c: string }
  | { t: "backspace" }
  | { t: "clear" }
  | { t: "space" };

export type KeypadEdit = { value: string; caret: number };

/**
 * Apply one key to the box's text. `selStart`/`selEnd` are the caret or the
 * selection (null = unknown, e.g. an email box: edit at the end). A typed
 * character replaces the selection; maxLength (<= 0 / null = none) is kept.
 */
export function applyKeypadKey(
  value: string,
  selStart: number | null,
  selEnd: number | null,
  key: KeypadKey,
  maxLength?: number | null,
): KeypadEdit {
  const v = value ?? "";
  const len = v.length;
  let a = selStart == null || !Number.isFinite(selStart) ? len : Math.max(0, Math.min(len, selStart));
  let b = selEnd == null || !Number.isFinite(selEnd) ? a : Math.max(0, Math.min(len, selEnd));
  if (b < a) [a, b] = [b, a];

  if (key.t === "clear") return { value: "", caret: 0 };
  if (key.t === "backspace") {
    if (a !== b) return { value: v.slice(0, a) + v.slice(b), caret: a };
    if (a === 0) return { value: v, caret: 0 };
    return { value: v.slice(0, a - 1) + v.slice(a), caret: a - 1 };
  }
  const ins = key.t === "space" ? " " : key.c;
  const next = v.slice(0, a) + ins + v.slice(b);
  if (maxLength != null && maxLength > 0 && next.length > maxLength) return { value: v, caret: a };
  return { value: next, caret: a + ins.length };
}

/**
 * Where the caret belongs after a box REFORMATS what the keypad typed
 * (owner: the DOB keypad "jumbles up the numbers"). A masked box such as
 * MM/DD/YYYY turns "110" into "11/0"; putting the caret back at the raw
 * index lands it BEFORE the last digit, so the next key is inserted in the
 * wrong place. Instead: count the letters/digits before the intended caret
 * and place the caret after that many letters/digits in what the box shows.
 */
export function caretAfterReformat(intended: string, intendedCaret: number, actual: string): number {
  const sig = /[0-9A-Za-z]/;
  const want = Math.max(0, Math.min(intended.length, intendedCaret));
  if (intended === actual) return want;
  let n = 0;
  for (let i = 0; i < want; i++) if (sig.test(intended[i])) n++;
  if (n === 0) return 0;
  let seen = 0;
  for (let i = 0; i < actual.length; i++) {
    if (sig.test(actual[i])) seen++;
    if (seen === n) return i + 1;
  }
  return actual.length;
}

/**
 * register-keypad-usability — data-keypad on a box:
 *   "auto" → the pad opens by itself when the box gets focus (date of birth);
 *   "off"  → no Keypad button (cash-count grids, where it covered the next box).
 */
export function keypadAutoOpen(dataKeypad: string | null | undefined): boolean {
  return (dataKeypad ?? "").toLowerCase() === "auto";
}

/** The rows of each pad (labels are what is typed). */
export const NUMERIC_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];
export const ALPHA_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
/** Extra characters on the letter pad (email, names, reasons). */
export const ALPHA_EXTRAS: readonly string[] = ["@", ".", "-", "_", "'", ",", "#", "/", "$", "&"];

/** Show a PIN as dots in the keypad's preview line. */
export function keypadPreview(value: string, masked: boolean): string {
  return masked ? "•".repeat((value ?? "").length) : value ?? "";
}

// ─────────────────────────────────────────────────────────── self-tests ──
export function __runRegisterKeypadTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ register-keypad: ${name}`);
    }
  };
  const ch = (c: string): KeypadKey => ({ t: "char", c });

  ok(eligibleForKeypad({ tag: "input" }), "a plain input gets the keypad");
  ok(eligibleForKeypad({ tag: "INPUT", type: "password", inputMode: "numeric" }), "a PIN box gets the keypad");
  ok(eligibleForKeypad({ tag: "textarea" }), "a textarea gets the keypad");
  ok(eligibleForKeypad({ tag: "input", type: "email" }), "an email box gets the keypad");
  ok(!eligibleForKeypad({ tag: "input", type: "checkbox" }), "a checkbox does not");
  ok(!eligibleForKeypad({ tag: "input", type: "date" }), "a date picker does not");
  ok(!eligibleForKeypad({ tag: "input", type: "text", inputMode: "none", ariaHidden: "true" }), "the scanner sink does not");
  ok(!eligibleForKeypad({ tag: "input", inputMode: "none" }), "inputMode none does not");
  ok(!eligibleForKeypad({ tag: "input", readOnly: true }), "a read-only box does not");
  ok(!eligibleForKeypad({ tag: "input", disabled: true }), "a disabled box does not");
  ok(!eligibleForKeypad({ tag: "input", keypadOptOut: true }), "data-keypad=off opts out");
  ok(!eligibleForKeypad({ tag: "button" }), "a button does not");
  ok(!eligibleForKeypad({ tag: "select" }), "a select does not");

  ok(keypadKindFor({ tag: "input", inputMode: "numeric" }) === "numeric", "numeric box → number pad");
  ok(keypadKindFor({ tag: "input", type: "password", inputMode: "numeric" }) === "numeric", "PIN → number pad");
  ok(keypadKindFor({ tag: "input", inputMode: "decimal" }) === "decimal", "money box → pad with a point");
  ok(keypadKindFor({ tag: "input", inputMode: "tel" }) === "numeric", "phone → number pad");
  ok(keypadKindFor({ tag: "input", type: "email", inputMode: "email" }) === "alpha", "email → letters");
  ok(keypadKindFor({ tag: "input" }) === "alpha", "name / reason → letters");
  ok(keypadKindFor({ tag: "textarea" }) === "alpha", "textarea → letters");

  let e = applyKeypadKey("", null, null, ch("1"));
  ok(e.value === "1" && e.caret === 1, "type into an empty box");
  e = applyKeypadKey("12", 2, 2, ch("3"));
  ok(e.value === "123" && e.caret === 3, "append at the caret");
  e = applyKeypadKey("13", 1, 1, ch("2"));
  ok(e.value === "123" && e.caret === 2, "insert in the middle");
  e = applyKeypadKey("hello", 0, 5, ch("x"));
  ok(e.value === "x" && e.caret === 1, "replace a selection");
  e = applyKeypadKey("123", 3, 3, { t: "backspace" });
  ok(e.value === "12" && e.caret === 2, "backspace at the end");
  e = applyKeypadKey("123", 0, 0, { t: "backspace" });
  ok(e.value === "123" && e.caret === 0, "backspace at the start does nothing");
  e = applyKeypadKey("12345", 1, 4, { t: "backspace" });
  ok(e.value === "15" && e.caret === 1, "backspace deletes a selection");
  e = applyKeypadKey("abc", 1, 1, { t: "clear" });
  ok(e.value === "" && e.caret === 0, "clear empties the box");
  e = applyKeypadKey("Purple", null, null, { t: "space" });
  ok(e.value === "Purple " && e.caret === 7, "space");
  e = applyKeypadKey("123456", 6, 6, ch("7"), 6);
  ok(e.value === "123456" && e.caret === 6, "maxLength 6 holds a PIN at 6 digits");
  e = applyKeypadKey("12345", 5, 5, ch("6"), 6);
  ok(e.value === "123456", "maxLength allows up to the limit");
  e = applyKeypadKey("ab", 9, 9, ch("c"));
  ok(e.value === "abc" && e.caret === 3, "an out-of-range caret is clamped");
  e = applyKeypadKey("abcd", 3, 1, ch("x"));
  ok(e.value === "axd" && e.caret === 2, "a reversed selection is normalized");
  e = applyKeypadKey("12", null, null, ch("3"), 0);
  ok(e.value === "123", "maxLength 0 means no limit");

  ok(keypadPreview("1234", true) === "••••", "a PIN previews as dots");
  ok(keypadPreview("Sam", false) === "Sam", "a name previews as typed");
  ok(NUMERIC_ROWS.flat().length === 9 && ALPHA_ROWS[1].length === 10, "pads have their keys");

  // caretAfterReformat — typing 11/1/1980 on the keypad into a MM/DD/YYYY mask
  const mask = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 8);
    return d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0, 2)}/${d.slice(2)}` : `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  };
  let v = "";
  let caret = 0;
  for (const c of "11011980") {
    const r = applyKeypadKey(v, caret, caret, ch(c));
    v = mask(r.value);
    caret = caretAfterReformat(r.value, r.caret, v);
  }
  ok(v === "11/01/1980", "DOB typed digit by digit comes out in order (was jumbled)");
  ok(caret === v.length, "caret ends at the end of the masked date");
  ok(caretAfterReformat("abc", 2, "abc") === 2, "unchanged value keeps the caret");
  ok(caretAfterReformat("12/3", 4, "12/3") === 4, "end caret stays at the end");
  ok(caretAfterReformat("1234", 2, "12/34") === 2, "caret mid-value maps through the slash");
  ok(keypadAutoOpen("auto") && !keypadAutoOpen("off") && !keypadAutoOpen(null), "data-keypad=auto opens the pad by itself");

  return { passed, failed };
}
