"use client";

/**
 * CycleCountScanner (Slice 68 — item 3)
 *
 * Barcode-driven blind counting for an OPEN cycle-count session. Two input
 * modes, both grounded in the same matching logic:
 *   1. USB "wedge" scanner — an always-refocused text box captures the code the
 *      scanner types and submits on Enter (how retail handhelds behave).
 *   2. Phone camera — uses the native BarcodeDetector API where supported
 *      (Android Chrome), degrading gracefully to keyboard entry elsewhere.
 *
 * Every scan is matched against the session's lot codes / POS keys. Exact and
 * fuzzy matches bump that line's physical count by one via a server action;
 * ambiguous or unknown codes are surfaced (never silently counted) so nothing
 * lands on the wrong lot. A running log + progress bar give the counter
 * immediate feedback.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button, Card, CardHeader, Badge, controlClassName } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  matchLineByCode,
  normalizeScan,
  scanProgressPct,
  tallyScan,
  type ScanLine,
  type ScanTally,
} from "@/lib/inventory/cycle-count-scan-core";
import { scanBumpLineAction } from "@/app/admin/inventory/cycle-counts/actions";

type LogEntry = {
  id: number;
  code: string;
  label: string;
  tone: "success" | "warning" | "error";
};

// Minimal typing for the experimental BarcodeDetector API (not in lib.dom yet).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

export function CycleCountScanner({
  countId,
  lines,
}: {
  countId: string;
  lines: ScanLine[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [tally, setTally] = useState<ScanTally>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [buffer, setBuffer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logSeq = useRef(0);

  const progress = scanProgressPct(lines, tally);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logSeq.current += 1;
    const id = logSeq.current;
    setLog((prev) => [{ id, ...entry }, ...prev].slice(0, 30));
  }, []);

  const handleCode = useCallback(
    (raw: string) => {
      const code = normalizeScan(raw);
      if (code === "") return;
      const match = matchLineByCode(lines, code);

      if (match.status === "none") {
        pushLog({ code, label: "No matching lot in this count", tone: "error" });
        toast({ tone: "error", message: `No lot in this count matches “${code}”.` });
        return;
      }
      if (match.status === "ambiguous") {
        const names = match.candidates.map((c) => c.productName ?? c.lotCode ?? c.lineId).join(", ");
        pushLog({ code, label: `Ambiguous — matches ${match.candidates.length} lots`, tone: "warning" });
        toast({ tone: "error", message: `“${code}” matches more than one lot (${names}). Enter it by hand.` });
        return;
      }

      const line = match.line;
      startTransition(async () => {
        const res = await scanBumpLineAction({ countId, lineId: line.lineId, by: 1 });
        if (res.ok) {
          setTally((prev) => tallyScan(prev, line.lineId));
          const name = line.productName ?? line.lotCode ?? line.lineId;
          pushLog({
            code,
            label: `${match.status === "fuzzy" ? "≈ " : ""}${name} → ${res.countedQty}`,
            tone: match.status === "fuzzy" ? "warning" : "success",
          });
        } else {
          pushLog({ code, label: res.error, tone: "error" });
          toast({ tone: "error", message: res.error });
        }
      });
    },
    [lines, countId, pushLog, toast],
  );

  // Keep the wedge input focused so a physical scanner always lands here.
  useEffect(() => {
    const el = inputRef.current;
    if (el) el.focus();
  }, []);

  function onBufferKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCode(buffer);
      setBuffer("");
    }
  }

  // ---- Camera scanning (progressive enhancement) -------------------------
  const [cameraOn, setCameraOn] = useState(false);
  // One-time client capability check (safe lazy init — no setState-in-effect).
  const [cameraSupported] = useState(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
    return typeof w.BarcodeDetector === "function" && !!navigator.mediaDevices;
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectRef = useRef<BarcodeDetectorLike | null>(null);
  const lastCamCode = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
      if (!w.BarcodeDetector) return;
      detectRef.current = new w.BarcodeDetector({
        formats: ["code_128", "code_39", "ean_13", "upc_a", "qr_code", "data_matrix"],
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      toast({ tone: "error", message: "Couldn't open the camera. Use the scanner box instead." });
    }
  }, [toast]);

  // Detection loop while the camera is on.
  useEffect(() => {
    if (!cameraOn) return;
    let raf = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const detector = detectRef.current;
      if (video && detector && video.readyState >= 2) {
        try {
          const results = await detector.detect(video);
          if (results.length > 0) {
            const code = normalizeScan(results[0].rawValue);
            const now = Date.now();
            // Debounce identical reads within 1.5s.
            if (code && !(lastCamCode.current.code === code && now - lastCamCode.current.at < 1500)) {
              lastCamCode.current = { code, at: now };
              handleCode(code);
            }
          }
        } catch {
          /* transient detect errors are ignored */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [cameraOn, handleCode]);

  // Stop the camera on unmount.
  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <Card>
      <CardHeader
        title="Scan to count"
        subtitle="Scan each unit with a handheld scanner or your phone camera. Every scan adds one to that lot's physical count."
      />
      <div className="space-y-4 p-5 pt-0">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/40">
              Scanner box (keep this focused)
            </label>
            <input
              ref={inputRef}
              className={controlClassName}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              onKeyDown={onBufferKeyDown}
              onBlur={() => {
                // Re-focus shortly after blur so the wedge scanner keeps landing here,
                // unless the camera is active.
                if (!cameraOn) setTimeout(() => inputRef.current?.focus(), 50);
              }}
              placeholder="Scan or type a lot code, then Enter"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="button"
            variant="neutral"
            disabled={!cameraSupported || pending}
            onClick={() => (cameraOn ? stopCamera() : startCamera())}
          >
            {cameraOn ? "Stop camera" : cameraSupported ? "Use camera" : "Camera not supported"}
          </Button>
        </div>

        {cameraOn && (
          <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black">
            <video ref={videoRef} className="mx-auto max-h-64 w-full object-contain" muted playsInline />
          </div>
        )}

        {/* Progress */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-white/50">
            <span>Lots scanned</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--admin-green)] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Scan log */}
        {log.length > 0 && (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/20 p-3">
            {log.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-[11px] text-white/40">{entry.code}</span>
                <span className="flex items-center gap-2 text-right">
                  <Badge tone={entry.tone === "success" ? "green" : entry.tone === "warning" ? "gold" : "danger"}>
                    {entry.tone === "success" ? "counted" : entry.tone === "warning" ? "check" : "no match"}
                  </Badge>
                  <span className={entry.tone === "error" ? "text-[var(--admin-danger)]" : "text-white/80"}>
                    {entry.label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-white/40">
          Counts stay blind — the system quantity is hidden until you apply the session. Scanning the same lot again
          adds another unit; correct a total by hand in the table below.
        </p>
      </div>
    </Card>
  );
}
