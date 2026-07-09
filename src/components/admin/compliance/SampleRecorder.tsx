"use client";

/**
 * SampleRecorder — WAC 314-55-096 (retailer TRADE samples only)
 *
 * Record a TRADE sample transfer:
 *   • Incoming from a processor — cap 120 units/processor/qtr [096(1)(f)(ii)].
 *   • Outgoing to a paid employee — cap 30 units/employee/qtr [096(1)(j)(vi)].
 *   Unit sizes: 3.5 g useable / 1 g concentrate / 100 mg infused (≤10 mg THC)
 *   [096(1)(e)]. A unit is the PACKAGE, not the weight.
 *
 * IQC (internal quality control) is producer/processor-only [096(3)] and is
 * NOT available to a retailer, so it has been fully retired from this UI.
 *
 * The pure core validates per-unit size caps; the server HARD-ENFORCES the
 * quarterly caps. Customer samples are impossible by design.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { recordSampleAction, type SampleActionResult } from "@/app/admin/compliance/samples/actions";
import { PRODUCT_TYPE_LABELS, type SampleProductType } from "@/lib/compliance/trade-samples-core";

export type EmployeeOption = { id: string; name: string };

const TRADE_TYPES: SampleProductType[] = ["useable", "concentrate", "infused"];

export function SampleRecorder({
  employees,
  today,
}: {
  employees: EmployeeOption[];
  today: string; // Pacific YMD
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
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

  const types = TRADE_TYPES;

  // Keep product type valid.
  const safeProductType = types.includes(productType) ? productType : types[0]!;

  const gramsHelp = useMemo(() => {
    return safeProductType === "useable" ? "≤ 3.5 g" : "≤ 1 g";
  }, [safeProductType]);

  function submit() {
    setErrors([]);
    setBlocked(null);
    start(async () => {
      const res: SampleActionResult = await recordSampleAction({
        direction,
        productType: safeProductType,
        unitCount,
        unitSizeGrams: safeProductType === "infused" ? undefined : unitSizeGrams,
        unitSizeMg: safeProductType === "infused" ? unitSizeMg : undefined,
        thcMgPerServing: safeProductType === "infused" ? thc : undefined,
        ymd,
        processorName: direction === "incoming" ? processorName : undefined,
        employeeId: direction === "outgoing" ? employeeId : undefined,
        fromSampleJar: fromJar,
        note,
      });
      if (res.ok) {
        toast({ tone: "success", message: "Sample recorded." });
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
      <h3 className="mb-1 text-sm font-semibold text-white">Record a trade sample</h3>
      <p className="mb-4 text-xs text-white/40">
        Trade samples may go only to current paid employees — never to customers (WAC 314-55-096(2)).
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Direction">
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "incoming" | "outgoing")}>
            <option value="incoming">Incoming (from processor)</option>
            <option value="outgoing">Outgoing (to employee)</option>
          </Select>
        </Field>
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
            <Field label="Per-unit weight (mg)" help="≤ 100 mg">
              <Input type="number" min={0} step="any" value={unitSizeMg} onChange={(e) => setUnitSizeMg(e.target.value)} />
            </Field>
            <Field label="THC per serving (mg)" help="≤ 10 mg active Δ9">
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

        {direction === "incoming" ? (
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

      {direction === "outgoing" && (
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
          {pending ? "Recording…" : "Record sample"}
        </Button>
      </div>
    </div>
  );
}
