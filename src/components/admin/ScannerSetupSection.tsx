/**
 * R50 S11b: the "Scanner setup" section of the Oct 30 count page. One panel per model the store
 * owns (Tera D5100, Socket DuraScan D760, Alacrity MJ-2020R). It shows the setup steps, with the setup
 * barcodes re-drawn by our own encoders (Code 128; QR for the Alacrity, whose manual prints QR codes)
 * from payloads decoded from the makers' manuals, then the test box.
 * Facts and sources: src/lib/pos/scanner-setup-core.ts and docs/research/scanner-setup-sources.md.
 */
import { code128Svg } from "@/lib/printing/code128-core";
import { qrSvg } from "@/lib/printing/qr-core";
import {
  SCANNER_BARCODE_DRAW,
  SCANNER_GUIDES,
  SCANNER_QR_DRAW,
  TEST_BARCODE,
  commandById,
  symbologyOf,
  type CommandSymbology,
} from "@/lib/pos/scanner-setup-core";
import { ScannerTestBox } from "./ScannerTestBox";

function Barcode({ payload, label, source, symbology = "code128" }: { payload: string; label: string; source?: string; symbology?: CommandSymbology }) {
  const bc = symbology === "qr" ? qrSvg(payload, SCANNER_QR_DRAW) : code128Svg(payload, SCANNER_BARCODE_DRAW);
  if (!bc.ok) return <p className="text-xs text-red-300">Could not draw {label}: {bc.error}</p>;
  return (
    <figure className="inline-block rounded bg-white p-2 text-center" data-payload={payload} data-symbology={symbology}>
      <div aria-label={`${label} barcode`} role="img" dangerouslySetInnerHTML={{ __html: bc.svg }} />
      <figcaption className="mt-1 text-[11px] font-semibold text-black">{label}</figcaption>
      {source && <figcaption className="text-[10px] text-black/50">{source}</figcaption>}
    </figure>
  );
}

function Command({ id }: { id: string }) {
  const c = commandById(id);
  if (!c) return null;
  return <Barcode payload={c.payload} label={c.label} source={c.source} symbology={symbologyOf(c)} />;
}

export function ScannerSetupSection() {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="scanner-setup">
      <h2 className="text-sm font-semibold text-white">0. Set up and test each scanner (once, before the count)</h2>
      <p className="mt-1 text-xs text-white/60">
        The count needs every scanner to type like a keyboard, send each scan straight away, and press Enter once after each one,
        so Excel drops to the next row. Scan the barcodes below off this screen. If a scanner will not read the screen, turn up the brightness or print this page.
        Then the test box must say OK. Do it on the computer that will be used for counting.
      </p>

      <div className="mt-4 rounded-lg border border-white/10 p-4">
        <h3 className="text-xs font-semibold text-white">Test box</h3>
        <div className="mt-2 flex flex-wrap items-start gap-6">
          <ScannerTestBox />
          <Barcode payload={TEST_BARCODE} label="TEST barcode" />
        </div>
      </div>

      {SCANNER_GUIDES.map((g) => (
        <details key={g.model} className="mt-4 rounded-lg border border-white/10 p-4" data-testid={`scanner-guide-${g.model}`}>
          <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-gold)]">{g.name}</summary>
          <p className="mt-2 text-xs text-white/60">{g.connection}</p>
          <p className="mt-3 text-xs font-semibold text-white/80">First</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-white/60">
            {g.before.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <ol className="mt-3 space-y-4 text-xs text-white/70">
            {g.steps.map((s, i) => (
              <li key={s.title}>
                <p className="font-semibold text-white/90">Step {i + 1}. {s.title}</p>
                <p className="text-white/60">{s.detail}</p>
                {s.scan.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">{s.scan.map((id) => <Command key={id} id={id} />)}</div>
                )}
                <p className="mt-1 text-white/40">Expect: {s.expect}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs font-semibold text-white/80">If something goes wrong</p>
          <ul className="mt-1 space-y-3 text-xs text-white/60">
            {g.trouble.map((t) => (
              <li key={t.symptom}>
                <p><span className="text-white/90">{t.symptom}.</span> {t.fix}</p>
                {t.scan && t.scan.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">{t.scan.map((id) => <Command key={id} id={id} />)}</div>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <p className="mt-3 text-xs text-white/40">
        These setup barcodes were read from Tera&apos;s, Socket&apos;s and Alacrity&apos;s own manuals and re-drawn here (the Alacrity&apos;s as QR codes, like its manual).
        Setup barcodes for other choices in the manuals (Storage Mode / Batch, Tab, no Enter, CR LF) are left off on purpose. They would break the count.
      </p>
    </section>
  );
}
