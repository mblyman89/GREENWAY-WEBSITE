/**
 * SLICE L-39 — "the button works, but the progress bar keeps spinning until
 * the 5-minute cap and the button can't be pressed again."
 *
 * ROOT CAUSE (proven in real Chromium, scripts/recon/l39-status-hang-probe.mjs):
 * the order page's status actions end with revalidatePath() and no redirect,
 * so the page re-renders IN PLACE — same URL, same <button> node, new label.
 * The layout's PendingKeeper clears only when the URL changes, the pressed
 * button leaves the document, or the button disables itself; otherwise it
 * waits for the 5-minute FORM ceiling. With a plain submit button none of the
 * three happened: the bar spun for five minutes and the form stayed stamped
 * busy, so the keeper's double-submit guard swallowed the next press.
 *
 * THE FIX: every in-place submit on that page is a SaveButton, which disables
 * itself for exactly the life of its own form's request (useFormStatus) — the
 * keeper's "self-managed" clear. These tests pin the fix AND the keeper facts
 * the fix depends on, so a later change to either side shows up here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { shouldClearPending, PENDING_FORM_SAFETY_TIMEOUT_MS } from "../../src/lib/admin/pending-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = code(read("src/app/admin/orders/[id]/page.tsx"));
const SAVE_BUTTON = code(read("src/components/admin/orders/SaveButton.tsx"));
const ACTIONS = code(read("src/app/admin/orders/actions.ts"));

/** Every `<form action={X} ...> … </form>` block on the page. */
function formsFor(action: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<form action=\\{${action}\\}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(PAGE))) {
    const end = PAGE.indexOf("</form>", m.index);
    out.push(PAGE.slice(m.index, end === -1 ? PAGE.length : end));
  }
  return out;
}

function actionBody(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = ACTIONS.indexOf("\nexport async function", start + 10);
  return ACTIONS.slice(start, next === -1 ? ACTIONS.length : next);
}

describe("L-39 · the keeper facts the fix relies on", () => {
  const base = {
    hrefAtStart: "https://x/admin/orders/o1",
    hrefNow: "https://x/admin/orders/o1",
    submitterConnected: true,
    submitterDisabled: false,
    kind: "form" as const,
  };

  it("an in-place re-render with a plain button does NOT clear (the bug)", () => {
    // Same URL, same node, not disabled, one second in → still busy. This is
    // the state the owner watched for five minutes.
    expect(shouldClearPending({ ...base, elapsedMs: 1_000 }).clear).toBe(false);
    expect(shouldClearPending({ ...base, elapsedMs: PENDING_FORM_SAFETY_TIMEOUT_MS - 1 }).clear).toBe(false);
    expect(PENDING_FORM_SAFETY_TIMEOUT_MS).toBe(300_000);
  });

  it("a button that disables itself clears immediately (the fix)", () => {
    expect(shouldClearPending({ ...base, submitterDisabled: true, elapsedMs: 50 })).toEqual({
      clear: true,
      reason: "self-managed",
    });
  });
});

describe("L-39 · the status actions really do re-render in place", () => {
  it("setOrderStatusAction and updateOrderNoteAction finish WITHOUT a redirect", () => {
    // If a future change makes them redirect, the URL change would clear the
    // keeper on its own — this pins WHY the page needs SaveButton today.
    for (const name of ["setOrderStatusAction", "updateOrderNoteAction"]) {
      const body = actionBody(name);
      const tail = body.slice(body.lastIndexOf("revalidatePath("));
      expect(tail).not.toContain("redirect(");
    }
  });
});

describe("L-39 · every in-place submit on the order page manages its own pending", () => {
  it("no plain submit Button is left on the page", () => {
    expect(PAGE).not.toMatch(/<Button[^>]*type="submit"/);
  });

  it("the only raw <button type=submit> is Reroll name, whose action REDIRECTS (clears by navigation)", () => {
    // Every raw submit button must sit inside a form whose action ends in a
    // redirect to a new URL; today that is exactly the header's Reroll name.
    const raw = [...PAGE.matchAll(/<button\s[^>]*type="submit"/g)];
    expect(raw.length).toBe(1);
    const formStart = PAGE.lastIndexOf("<form action={", raw[0].index);
    expect(PAGE.slice(formStart, raw[0].index)).toContain("<form action={rerollOrderNameAction.bind(");
    const body = actionBody("rerollOrderNameAction");
    const tail = body.slice(body.lastIndexOf("revalidatePath("));
    expect(tail).toMatch(/redirect\(`\$\{ORDERS_BASE\}\/\$\{orderId\}\?ok=/);
  });

  it("each status form (step, override, cancel, no-show, reopen) uses SaveButton", () => {
    const forms = formsFor("setOrderStatusAction");
    expect(forms.length).toBe(5);
    for (const f of forms) expect(f).toMatch(/<SaveButton[\s\n]/);
  });

  it("the staff-note form uses SaveButton", () => {
    const forms = formsFor("updateOrderNoteAction");
    expect(forms.length).toBe(1);
    expect(forms[0]).toMatch(/<SaveButton[\s\n]/);
  });

  it("each SaveButton says what it is doing while busy", () => {
    const buttons = PAGE.match(/<SaveButton[\s\S]*?\/>/g) ?? [];
    expect(buttons.length).toBe(6);
    for (const b of buttons) expect(b).toMatch(/busyLabel="[^"]+…"/);
  });

  it("the forward step button keeps the step name in its label", () => {
    expect(PAGE).toContain("label={`Mark ${ORDER_STATUS_LABELS[next]}`}");
  });
});

describe("L-39 · SaveButton is the self-managing button the keeper steps aside for", () => {
  it("disables itself from its own form's pending state", () => {
    expect(SAVE_BUTTON).toContain("const { pending } = useFormStatus();");
    expect(SAVE_BUTTON).toMatch(/disabled=\{pending\}/);
    expect(SAVE_BUTTON).toMatch(/aria-busy=\{pending\}/);
    // A SaveButton must never render its own <form>: useFormStatus would then
    // watch the wrong form and report pending:false forever.
    expect(SAVE_BUTTON).not.toMatch(/<form\b/);
  });

  it("the new size prop defaults to the old value, so existing saves are unchanged", () => {
    expect(SAVE_BUTTON).toMatch(/size = "sm",/);
    expect(SAVE_BUTTON).toMatch(/size=\{size\}/);
  });

  it("the real-browser proof ships with the fix", () => {
    expect(existsSync(join(ROOT, "scripts/recon/l39-status-hang-probe.mjs"))).toBe(true);
    expect(read(".gitignore")).toContain(".l39-probe-*/");
  });
});

describe("L-39 · the medical section's detach button (same bug class, failure path)", () => {
  const MED = code(read("src/components/admin/orders/MedicalSaleSection.tsx"));

  it("detachMedicalCardAction can finish with a bare revalidatePath (no redirect)", () => {
    const body = actionBody("detachMedicalCardAction");
    const tail = body.slice(body.lastIndexOf("revalidatePath("));
    expect(tail).not.toContain("redirect(");
  });

  it("so its form uses SaveButton with a busy label", () => {
    const start = MED.indexOf("<form action={detachMedicalCardAction}>");
    expect(start).toBeGreaterThan(-1);
    const form = MED.slice(start, MED.indexOf("</form>", start));
    expect(form).toMatch(/<SaveButton[\s\S]*busyLabel="Detaching…"/);
    expect(form).not.toMatch(/<Button[^>]*type="submit"/);
  });

  it("attach is safe without it: every failure redirects, success replaces the chip", () => {
    const body = actionBody("attachMedicalCardAction");
    // Three guarded failure exits, each a redirect to ?blocked=.
    expect((body.match(/redirect\(/g) ?? []).length).toBe(3);
    expect((body.match(/\?blocked=/g) ?? []).length).toBe(3);
  });
});

describe("L-39 · the fix changes behavior, not appearance", () => {
  const BUTTON = code(read("src/components/admin/ui/Button.tsx"));

  it("plain Button's default size is md (what the status buttons rendered at before)", () => {
    expect(BUTTON).toContain('SIZES[p.size ?? "md"]');
  });

  it("all five status SaveButtons pass size=\"md\"; the note button keeps SaveButton's sm", () => {
    for (const f of formsFor("setOrderStatusAction")) {
      const tag = f.slice(f.indexOf("<SaveButton"), f.indexOf("/>", f.indexOf("<SaveButton")));
      expect(tag).toContain('size="md"');
    }
    const [note] = formsFor("updateOrderNoteAction");
    const tag = note.slice(note.indexOf("<SaveButton"), note.indexOf("/>", note.indexOf("<SaveButton")));
    expect(tag).not.toContain("size=");
  });
});
