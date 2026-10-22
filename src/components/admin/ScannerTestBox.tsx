"use client";

/**
 * R50 S11b — the scanner test box on the Oct 30 count page. A keyboard-mode scanner "types" the
 * barcode and then its terminator key. This box records exactly what arrived (characters, then
 * Enter / Tab / nothing, plus any extra Enter that follows straight away, i.e. CR+LF) and hands it
 * to the pure classifier in scanner-setup-core.ts, which says in plain words what to fix.
 */
import { useEffect, useRef, useState } from "react";
import { SCANNER_SHORT_NAME, classifyTestScan, commandById, type TestScanVerdict } from "@/lib/pos/scanner-setup-core";

/** No key for this long after a character = the scan ended without a terminator. */
const IDLE_MS = 700;
/** An Enter this soon after the first one belongs to the same scan (CR then LF). */
const EXTRA_ENTER_MS = 120;

export function ScannerTestBox() {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<TestScanVerdict | null>(null);
  const buf = useRef("");
  const extra = useRef(0);
  const ended = useRef<"enter" | "tab" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const finish = (terminator: "enter" | "tab" | "none") => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setVerdict(classifyTestScan({ text: buf.current, terminator, extraEnters: extra.current }));
    setText(buf.current);
    buf.current = "";
    extra.current = 0;
    ended.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (ended.current === "enter" && e.key === "Enter") {
        extra.current += 1;
        return;
      }
      if (ended.current) return;
      ended.current = e.key === "Enter" ? "enter" : "tab";
      if (timer.current) clearTimeout(timer.current);
      const t = ended.current;
      timer.current = setTimeout(() => finish(t), EXTRA_ENTER_MS);
      return;
    }
    if (e.key.length === 1) {
      if (ended.current) {
        // A new scan started straight after the last one: settle the last one first.
        finish(ended.current);
      }
      if (buf.current === "") setVerdict(null);
      buf.current += e.key;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => finish("none"), IDLE_MS);
    }
  };

  const names = (ids: string[]) => ids.map((id) => commandById(id)?.label ?? id).join(", then ");

  return (
    <div className="space-y-2" data-testid="scanner-test-box">
      <label className="flex flex-col gap-1 text-xs text-white/70">
        <span>Click here, then scan the TEST barcode (or any product):</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          placeholder="waiting for a scan…"
          className="w-full max-w-md rounded border border-white/20 bg-black px-2 py-2 font-mono text-white"
        />
      </label>
      {verdict && (
        <div
          role="status"
          className={
            verdict.ok
              ? "rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-300"
              : "rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          }
        >
          <p>{verdict.message}</p>
          {verdict.fix.map((f) => (
            <p key={f.model} className="mt-1">
              {SCANNER_SHORT_NAME[f.model]}: scan {names(f.scan)} (below), then test again.
            </p>
          ))}
        </div>
      )}
      <button type="button" onClick={() => { setText(""); setVerdict(null); }} className="text-xs text-white/50 underline">
        Clear
      </button>
    </div>
  );
}
