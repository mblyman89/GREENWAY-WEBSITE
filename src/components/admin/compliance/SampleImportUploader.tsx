"use client";

/**
 * SampleImportUploader — WAC 314-55-096 samples-as-products intake.
 *
 * "Samples come to us like regular products do. With its own json to upload."
 * The owner uploads (or pastes) a JSON batch of incoming sample lots. We parse
 * the permissive shape server-side, persist the batch, and show a summary. The
 * lots are then recorded + assigned from the ledger form (drafts-only — nothing
 * is auto-recorded to the CCRS ledger).
 *
 * Before committing, we run a LIVE distribution-capacity check on the parsed
 * batch: "this batch is N units, only M can be placed this quarter" — a soft,
 * advisory warning so you don't accept samples you can't give out. Receiving
 * isn't unlawful; over-GIVING to an employee is — so this never hard-blocks.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { Button, Field, Input, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { uploadSampleJsonAction, type SampleImportResult } from "@/app/admin/compliance/samples/actions";
import { parseSampleJson } from "@/lib/compliance/trade-samples-core";
import { evaluateIncomingBatch, type SampleCapacity } from "@/lib/compliance/sample-capacity-core";

const SAMPLE_JSON = `[
  { "product_type": "useable", "unit_count": 10, "unit_size_grams": 3.5, "processor": "Acme Farms", "strain": "OG Kush", "lot": "L-1042" },
  { "product_type": "concentrate", "unit_count": 5, "unit_size_grams": 1, "processor": "Dab Co", "lot": "D-88" }
]`;

export function SampleImportUploader({ capacity }: { capacity: SampleCapacity }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live preview: parse the pasted/loaded JSON and score it against remaining
  // distribution capacity, without committing anything.
  const preview = useMemo(() => {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const parsed = parseSampleJson(trimmed);
    if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
    const verdict = evaluateIncomingBatch({ batchUnits: parsed.totalUnits, capacity });
    return {
      ok: true as const,
      lotCount: parsed.lots.length,
      totalUnits: parsed.totalUnits,
      warnings: parsed.warnings,
      verdict,
    };
  }, [content, capacity]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    setContent(text);
  }

  function submit() {
    setErrors([]);
    if (!content.trim()) {
      setErrors(["Paste JSON or choose a file first."]);
      return;
    }
    start(async () => {
      const res: SampleImportResult = await uploadSampleJsonAction({ fileName, content, notes });
      if (res.ok) {
        toast({ tone: "success", message: res.message });
        setContent("");
        setFileName(null);
        setNotes("");
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setErrors(res.errors);
      }
    });
  }

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">Import samples (JSON)</h3>
      <p className="mb-4 text-xs text-white/40">
        Upload a JSON batch of incoming sample lots (like a product upload). Fields are permissive:
        <code className="mx-1 rounded bg-white/10 px-1">product_type</code>,
        <code className="mx-1 rounded bg-white/10 px-1">unit_count</code>,
        <code className="mx-1 rounded bg-white/10 px-1">unit_size_grams</code>/<code className="rounded bg-white/10 px-1">thc_mg</code>,
        <code className="mx-1 rounded bg-white/10 px-1">processor</code>. The batch is saved for your records; assign the lots below.
      </p>

      <div className="grid gap-3">
        <Field label="Choose a .json file">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="block w-full text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-[#7ed957] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
          />
        </Field>
        <Field label="…or paste JSON" help={fileName ? `Loaded: ${fileName}` : undefined}>
          <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder={SAMPLE_JSON} className="font-mono text-xs" />
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Q2 processor drop" />
        </Field>
      </div>

      {/* Live capacity check on the parsed batch */}
      {preview?.ok && (
        <div
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            preview.verdict.tone === "red"
              ? "border border-red-500/50 bg-red-500/10 font-semibold text-red-300"
              : preview.verdict.tone === "amber"
                ? "border border-[#f59e0b]/40 bg-[#f59e0b]/10 font-semibold text-[#f59e0b]"
                : "border border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]"
          }`}
        >
          <div>
            {preview.verdict.tone === "red" ? "🚫 " : preview.verdict.tone === "amber" ? "⚠️ " : "✅ "}
            {preview.verdict.message}
          </div>
          <div className="mt-1 text-xs font-normal text-white/50">
            Parsed {preview.lotCount} lot(s) / {preview.totalUnits} unit(s)
            {preview.warnings.length ? ` · ${preview.warnings.length} row(s) will be skipped` : ""}.
            This is advisory — you may still accept the batch (e.g. a new hire is coming).
          </div>
        </div>
      )}
      {preview && !preview.ok && (
        <ul className="mt-3 list-disc space-y-0.5 rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-6 py-3 text-xs text-[#f59e0b]">
          {preview.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 rounded-lg border border-red-500/40 bg-red-500/10 px-6 py-3 text-xs text-red-300">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Importing…" : "Import JSON batch"}
        </Button>
      </div>
    </div>
  );
}
