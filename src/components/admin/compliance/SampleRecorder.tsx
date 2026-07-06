"use client";

/**
 * SampleRecorder — WAC 314-55-096
 *
 * Record a sample transfer. Two categories:
 *   • TRADE — incoming from a processor, or outgoing to a paid employee.
 *     Caps: 120 units/processor/qtr (incoming), 30 units/employee/qtr (outgoing).
 *     Unit sizes: 3.5 g useable / 1 g concentrate / 100 mg infused (≤10 mg THC).
 *   • IQC (internal quality control) — always assigned OUT to a paid employee.
 *     Cap: 50 units/employee/qtr with a 25-unit CONCENTRATE sub-cap.
 *     Unit sizes: 1 g flower / 1 g useable / 1 g concentrate / 10 mg THC infused.
 *
 * The pure core validates per-unit size caps; the server HARD-ENFORCES the
 * quarterly caps. Customer samples are impossible by design.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { recordSampleAction, type SampleActionResult } from "@/app/admin/compliance/samples/actions";
import { PRODUCT_TYPE_LABELS, type SampleCategory, type SampleProductType } from "@/lib/compliance/trade-samples-core";

export type EmployeeOption = { id: string; name: string };

const TRADE_TYPES: SampleProductType[] = ["useable", "concentrate", "infused"];
const IQC_TYPES: SampleProductType[] = ["flower", "useable", "concentrate", "infused"];

export function SampleRecorder({
  employees,
  today,
}: {
  employees: EmployeeOption[];
  today: string; // Pacific YMD
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<SampleCategory>("trade");
  const [direction, setDirection] = useState<"incoming" | "outgoing">("incoming");
  const [productType, setProductType] = useState<SampleProductType>("useable");
  const [unitCount, setUnitCount] = useState("1");
  const [unitSizeGrams, setUnitSizeGrams] = useState("3.5");
  const [unitSizeMg, setUnitSizeMg] = useState("100");
  const [thc, setThc] = useState("10");
  const [ymd, setYmd] = useState(today);
  const [processorName, setProcessorName] = useState("");
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [fromJar, setFromJar] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);

  const isIqc = category === "iqc";
  // IQC is always an outgoing assignment to an employee.
  const effectiveDirection: "incoming" | "outgoing" = isIqc ? "outgoing" : direction;
  const types = isIqc ? IQC_TYPES : TRADE_TYPES;

  // Keep product type valid for the current category.
  const safeProductType = types.includes(productType) ? productType : types[0]!;

  const gramsHelp = useMemo(() => {
    if (isIqc) return "≤ 1 g (IQC)";
    return safeProductType === "useable" || safeProductType === "flower" ? "≤ 3.5 g" : "≤ 1 g";
  }, [isIqc, safeProductType]);

  function changeCategory(next: SampleCategory) {
    setCategory(next);
    // Reset product type + defaults sensibly for the new bucket.
    if (next === "iqc") {
      setProductType("flower");
      setUnitSizeGrams("1");
      setThc("10");
    } else {
      setProductType("useable");
      setUnitSizeGrams("3.5");
      setUnitSizeMg("100");
      setThc("10");
    }
    setErrors([]);
    setBlocked(null);
  }

  function submit() {
    setErrors([]);
    setBlocked(null);
    start(async () => {
      const res: SampleActionResult = await recordSampleAction({
        category,
        direction: effectiveDirection,
        productType: safeProductType,
        unitCount,
        unitSizeGrams: safeProductType === "infused" ? undefined : unitSizeGrams,
        // IQC infused is captured by THC mg only (no total-weight cap).
        unitSizeMg: safeProductType === "infused" && !isIqc ? unitSizeMg : undefined,
        thcMgPerServing: safeProductType === "infused" ? thc : undefined,
        ymd,
        processorName: effectiveDirection === "incoming" ? processorName : undefined,
        employeeId: effectiveDirection === "outgoing" ? employeeId : undefined,
        fromSampleJar: !isIqc && fromJar,
        note,
      });
      if (res.ok) {
        toast({ tone: "success", message: isIqc ? "IQC sample assigned." : "Sample recorded." });
        setUnitCount("1");
        setNote("");
        setFromJar(false);
      } else if (res.blocked) {
        setBlocked(res.error ?? "Blocked: quarterly cap exceeded.");
      } else if (res.errors) {
        setErrors(res.errors);
      } else {
        toast({ tone: "error", message: res.error ?? "Could not record sample." });
      }
    });
  }

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">Record / assign a sample</h3>
      <p className="mb-4 text-xs text-white/40">
        Samples may go only to current paid employees — never to customers (WAC 314-55-096(2)).
      </p>

      {/* Category toggle */}
      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-[var(--admin-border)]">
        {(["trade", "iqc"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => changeCategory(c)}
            className={`px-4 py-2 text-xs font-semibold transition ${
              category === c ? "bg-[#7ed957] text-black" : "bg-transparent text-white/60 hover:text-white"
            }`}
          >
            {c === "trade" ? "Trade sample" : "Internal QC (IQC)"}
          </button>
        ))}
      </div>

      {isIqc && (
        <div className="mb-4 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-xs text-white/60">
          <strong className="text-white/80">Internal quality control:</strong> a SECOND per-employee bucket of ≤ 50 units/quarter
          (with a ≤ 25 concentrate sub-cap) for product evaluation — this is where the purchasing manager&apos;s samples go. It is{" "}
          <strong className="text-white/80">not unlimited</strong>. IQC units are 1 g flower / 1 g useable / 1 g concentrate / 10 mg THC infused,
          must be recorded to the employee in CCRS, and may not be consumed on the licensed premises (§096(3)).
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!isIqc && (
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as "incoming" | "outgoing")}>
              <option value="incoming">Incoming (from processor)</option>
              <option value="outgoing">Outgoing (to employee)</option>
            </Select>
          </Field>
        )}
        <Field label="Product type">
          <Select value={safeProductType} onChange={(e) => setProductType(e.target.value as SampleProductType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Units">
          <Input type="number" min={1} step={1} value={unitCount} onChange={(e) => setUnitCount(e.target.value)} />
        </Field>

        {safeProductType === "infused" ? (
          <>
            {!isIqc && (
              <Field label="Per-unit weight (mg)" help="≤ 100 mg">
                <Input type="number" min={0} step="any" value={unitSizeMg} onChange={(e) => setUnitSizeMg(e.target.value)} />
              </Field>
            )}
            <Field label="THC per serving (mg)" help={isIqc ? "≤ 10 mg (IQC)" : "≤ 10 mg active Δ9"}>
              <Input type="number" min={0} step="any" value={thc} onChange={(e) => setThc(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Per-unit weight (g)" help={gramsHelp}>
            <Input type="number" min={0} step="any" value={unitSizeGrams} onChange={(e) => setUnitSizeGrams(e.target.value)} />
          </Field>
        )}

        <Field label="Date">
          <Input type="date" value={ymd} onChange={(e) => setYmd(e.target.value)} />
        </Field>

        {effectiveDirection === "incoming" ? (
          <Field label="Processor name" className="sm:col-span-2">
            <Input value={processorName} onChange={(e) => setProcessorName(e.target.value)} placeholder="Supplying processor" />
          </Field>
        ) : (
          <Field label="Employee (paid, current)" className="sm:col-span-2">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.length === 0 && <option value="">No active employees</option>}
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {!isIqc && effectiveDirection === "outgoing" && (
        <label className="mt-3 flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={fromJar} onChange={(e) => setFromJar(e.target.checked)} />
          These units came from sample-jar leftovers (still count toward the employee&apos;s 30/quarter cap).
        </label>
      )}

      <div className="mt-3">
        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      {blocked && (
        <div className="mt-3 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
          🚫 {blocked}
        </div>
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
          {pending ? "Recording…" : isIqc ? "Assign IQC sample" : "Record sample"}
        </Button>
      </div>
    </div>
  );
}
