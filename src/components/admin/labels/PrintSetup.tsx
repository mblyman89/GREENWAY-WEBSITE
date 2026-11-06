"use client";

/**
 * D191 — Printer calibration & setup panel for the Label Studio.
 *
 * Owner: "I tested the 2x1" labels, it prints two labels, the first blank, the
 * second nearly prints off the bottom of the label."
 *
 * All maths lives in the pure label-print-core; this is only the controls:
 * orientation (Auto sends a portrait page with the artwork turned, dodging
 * Chromium bug 372435414), nudge X/Y, scale, a one-click test label, the
 * print-dialog steps for this computer's OS, and a symptom → fix table.
 * Calibration is remembered per device, per label size.
 */
import { Button } from "@/components/admin/ui";
import {
  OFFSET_MAX_IN,
  OFFSET_STEP_IN,
  ORIENTATIONS,
  ORIENTATION_LABEL,
  SCALE_MAX_PCT,
  SCALE_MIN_PCT,
  SYMPTOM_FIXES,
  dialogSteps,
  isDefaultCalibration,
  windowsRolloDriverSteps,
  pageGeometry,
  sanitizeCalibration,
  type ClientOs,
  type PrintCalibration,
  type PrintOrientation,
} from "@/lib/printing/label-print-core";
import { stockSizeText, type LabelStock, type PrinterProfile } from "@/lib/printing/label-stock-core";

const OS_NAME: Record<ClientOs, string> = {
  mac: "Mac",
  windows: "Windows",
  chromeos: "Chromebook",
  ios: "iPhone / iPad",
  android: "Android",
  other: "this computer",
};

const ORIENT_TITLE: Record<PrintOrientation, string> = {
  auto: "Recommended. Sends every label straight, on a page exactly the label's size — what Rollo asks for.",
  straight: "Same as Auto: the page is exactly the label, as previewed.",
  rotate_cw: "Only if your printer driver turns pages itself: turn the artwork a quarter-turn clockwise onto a tall page.",
  rotate_ccw: "Only if your printer driver turns pages itself: turn the artwork counter-clockwise onto a tall page.",
};

function fmtIn(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}″`;
}

function Stepper({
  label,
  hint,
  value,
  display,
  onStep,
  minus,
  plus,
}: {
  label: string;
  hint: string;
  value: number;
  display: string;
  onStep: (dir: -1 | 1) => void;
  minus: string;
  plus: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[var(--admin-text-muted)]">{label}</span>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label}: ${minus}`}
          title={minus}
          onClick={() => onStep(-1)}
          className="admin-focus h-8 w-8 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] text-sm font-bold text-[var(--admin-text)]"
        >
          −
        </button>
        <output aria-live="polite" className={`w-16 text-center font-mono text-sm ${value === 0 ? "text-[var(--admin-text-muted)]" : "font-bold text-[var(--admin-accent)]"}`}>
          {display}
        </output>
        <button
          type="button"
          aria-label={`${label}: ${plus}`}
          title={plus}
          onClick={() => onStep(1)}
          className="admin-focus h-8 w-8 rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] text-sm font-bold text-[var(--admin-text)]"
        >
          +
        </button>
      </div>
      <span className="text-[0.65rem] text-[var(--admin-text-faint)]">{hint}</span>
    </div>
  );
}

export function PrintSetup({
  stock,
  printer,
  calibration,
  os,
  onChange,
  onTestPrint,
}: {
  stock: LabelStock;
  printer: PrinterProfile;
  calibration: PrintCalibration;
  os: ClientOs;
  onChange: (c: PrintCalibration) => void;
  onTestPrint: () => void;
}) {
  const cal = sanitizeCalibration(calibration);
  const g = pageGeometry(stock, cal);
  const set = (patch: Partial<PrintCalibration>) => onChange(sanitizeCalibration({ ...cal, ...patch }));
  const steps = dialogSteps(os, stock, printer, g);
  const isRollo = printer.id.startsWith("rollo");

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--admin-radius-md)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-3 py-2 text-xs text-[var(--admin-text)]">
        <strong>New roll or new size? Print one test label first.</strong> If its border is complete on all four sides and the cross is
        centred, every label will land right. Settings below are saved on this computer for {stockSizeText(stock)}.
        <div className="mt-2">
          <Button size="sm" variant="save" onClick={onTestPrint}>
            🎯 Print test label
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--admin-text-muted)]">Orientation</p>
        <div role="radiogroup" aria-label="Print orientation" className="inline-flex flex-wrap gap-1 rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-1">
          {ORIENTATIONS.map((o) => {
            const on = cal.orientation === o;
            return (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={on}
                title={ORIENT_TITLE[o]}
                onClick={() => set({ orientation: o })}
                className={`admin-focus rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-semibold ${
                  on ? "bg-[var(--admin-accent)] text-black shadow" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {ORIENTATION_LABEL[o]}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-[var(--admin-text-faint)]">
          {g.orientation === "straight"
            ? `Sent as a ${g.pageWIn}″ × ${g.pageHIn}″ page — exactly the label's size, exactly as previewed.`
            : `Sent as a tall ${g.pageWIn}″ × ${g.pageHIn}″ page with the artwork turned ${g.orientation === "rotate_cw" ? "↻" : "↺"}. Only use this if Auto prints sideways on your setup — on a Rollo set to Orientation “A” it will run across two labels.`}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stepper
          label="Nudge right / left"
          hint="Positive moves the print right"
          value={cal.offsetXIn}
          display={fmtIn(cal.offsetXIn)}
          minus={`Move left ${OFFSET_STEP_IN}″`}
          plus={`Move right ${OFFSET_STEP_IN}″`}
          onStep={(d) => set({ offsetXIn: cal.offsetXIn + d * OFFSET_STEP_IN })}
        />
        <Stepper
          label="Nudge down / up"
          hint="Positive moves the print down"
          value={cal.offsetYIn}
          display={fmtIn(cal.offsetYIn)}
          minus={`Move up ${OFFSET_STEP_IN}″`}
          plus={`Move down ${OFFSET_STEP_IN}″`}
          onStep={(d) => set({ offsetYIn: cal.offsetYIn + d * OFFSET_STEP_IN })}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--admin-text-muted)]">Scale · {cal.scalePct}%</span>
          <input
            type="range"
            min={SCALE_MIN_PCT}
            max={SCALE_MAX_PCT}
            step={1}
            value={cal.scalePct}
            onChange={(e) => set({ scalePct: Number(e.target.value) })}
            aria-label="Print scale percent"
            className="w-40"
          />
          <span className="text-[0.65rem] text-[var(--admin-text-faint)]">Edges clipped all round? Try 97–98%</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="neutral" disabled={isDefaultCalibration(cal)} onClick={() => onChange(sanitizeCalibration(null))}>
          Reset calibration
        </Button>
        <span className="text-[0.7rem] text-[var(--admin-text-faint)]">
          Nudge range ±{OFFSET_MAX_IN}″ · 0.01″ ≈ {Math.max(1, Math.round(printer.dpi / 100))} printer dot{printer.dpi >= 150 ? "s" : ""}
        </span>
      </div>

      <details className="rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-text-muted)]" open>
        <summary className="cursor-pointer font-semibold text-[var(--admin-text)]">In the print dialog on {OS_NAME[os]}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {isRollo ? (
          <p className="mt-2 text-[var(--admin-text-faint)]">
            One-time, on the Rollo&apos;s own web page (type the printer&apos;s IP address into the browser): <strong>Media</strong> → choose{" "}
            {stock.acrossIn}″ × {stock.feedIn}″, Label Separator <strong>Gap</strong> → Save. Then <strong>Printing Defaults</strong> →
            Orientation: the upright <strong>“A”</strong> (not “?”) → Save. The Wireless Rollo re-learns the gap by itself when you load a roll.
          </p>
        ) : null}
        {isRollo && os === "windows" ? (
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold text-[var(--admin-text)]">Still across two labels on Windows? Use Rollo&apos;s own driver</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              {windowsRolloDriverSteps(stock).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </details>
        ) : null}
        {printer.note ? <p className="mt-1.5 text-[var(--admin-text-faint)]">{printer.note}</p> : null}
      </details>

      <details className="rounded-[var(--admin-radius-md)] bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-text-muted)]">
        <summary className="cursor-pointer font-semibold text-[var(--admin-text)]">Something looks wrong? Symptom → fix</summary>
        <dl className="mt-2 space-y-2">
          {SYMPTOM_FIXES.map((f) => (
            <div key={f.symptom}>
              <dt className="font-semibold text-[var(--admin-text)]">{f.symptom}</dt>
              <dd className="text-[var(--admin-text-muted)]">{f.fix}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
