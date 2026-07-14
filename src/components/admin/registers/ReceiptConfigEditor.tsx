"use client";

/**
 * ReceiptConfigEditor (POS Slice B13) — receipt customization with a TRUE
 * live preview: the preview iframe renders the IDENTICAL pure builder
 * (pos/receipt-core buildPosReceiptHtml) the register hands to Star PassPRNT,
 * fed a representative sample sale. What the owner sees here is byte-for-byte
 * the HTML the printer receives — preview and paper can never drift.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Field, Input, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { buildPosReceiptHtml, type PosReceiptInput } from "@/lib/pos/receipt-core";
import {
  normalizePosReceiptConfig,
  receiptAddressLines,
  RECEIPT_ADDRESS_MAX_LINES,
  RECEIPT_FOOTER_MAX,
  RECEIPT_HEADER_MAX,
  type PosReceiptConfig,
} from "@/lib/pos/receipt-config-core";
import { saveReceiptConfigAction } from "@/app/admin/registers/receipt/actions";

/** Representative sample sale so every toggle is visible in the preview. */
function sampleReceipt(cfg: PosReceiptConfig): PosReceiptInput {
  return {
    saleClientUuid: "00000000-0000-4000-8000-0000eeff1234",
    soldAtIso: new Date().toISOString(),
    registerLabel: "Register 1",
    lines: [
      { productName: "Blue Dream 3.5g", quantity: 1, unitPriceMinor: 2500, regularPriceMinor: 3000 },
      { productName: "Gummy Bites 100mg", quantity: 2, unitPriceMinor: 1800, regularPriceMinor: 1800 },
    ],
    subtotalMinor: 4172,
    taxMinor: 1928,
    totalMinor: 6100,
    savingsMinor: 500,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: 7000,
    changeMinor: 900,
    headerText: cfg.headerText,
    footerText: cfg.footerText,
    addressLines: receiptAddressLines(cfg),
    servedBy: cfg.showEmployee ? "Casey" : null,
    hideSavings: !cfg.showSavings,
    loyalty: cfg.showLoyalty ? { memberLabel: "Sample Member", pointsEarned: 41 } : null,
  };
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--admin-gold)]"
      />
      <span>
        <span className="block text-sm font-medium text-[var(--admin-text)]">{label}</span>
        <span className="block text-xs text-[var(--admin-text-faint)]">{help}</span>
      </span>
    </label>
  );
}

export function ReceiptConfigEditor({ initial }: { initial: PosReceiptConfig }) {
  const { toast } = useToast();
  const [headerText, setHeaderText] = useState(initial.headerText);
  const [addressText, setAddressText] = useState(initial.addressText);
  const [footerText, setFooterText] = useState(initial.footerText);
  const [showEmployee, setShowEmployee] = useState(initial.showEmployee);
  const [showSavings, setShowSavings] = useState(initial.showSavings);
  const [showLoyalty, setShowLoyalty] = useState(initial.showLoyalty);
  const [pending, startTransition] = useTransition();

  const draft = useMemo(
    () =>
      normalizePosReceiptConfig({
        headerText,
        addressText,
        footerText,
        showEmployee,
        showSavings,
        showLoyalty,
      }),
    [headerText, addressText, footerText, showEmployee, showSavings, showLoyalty],
  );

  const previewHtml = useMemo(() => buildPosReceiptHtml(sampleReceipt(draft)), [draft]);

  function save() {
    startTransition(async () => {
      const res = await saveReceiptConfigAction({
        headerText,
        addressText,
        footerText,
        showEmployee,
        showSavings,
        showLoyalty,
      });
      if (res.ok) {
        toast({ tone: "success", message: "Receipt saved. Registers pick it up on their next menu refresh." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Field
          label="Header (store name)"
          help={`Big centered line at the top. Max ${RECEIPT_HEADER_MAX} characters; blank resets to the default.`}
          htmlFor="rc-header"
        >
          <Input
            id="rc-header"
            value={headerText}
            maxLength={RECEIPT_HEADER_MAX}
            onChange={(e) => setHeaderText(e.target.value)}
          />
        </Field>
        <Field
          label="Address & contact block"
          help={`One line per row (street, city, phone, license #) — up to ${RECEIPT_ADDRESS_MAX_LINES} lines. Leave empty to print none.`}
          htmlFor="rc-address"
        >
          <Textarea
            id="rc-address"
            rows={4}
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            placeholder={"9107 SW State Hwy 3\nPort Orchard, WA 98367\nLicense 413541"}
          />
        </Field>
        <Field
          label="Footer message"
          help={`Centered at the bottom. Max ${RECEIPT_FOOTER_MAX} characters; blank resets to the default warning text.`}
          htmlFor="rc-footer"
        >
          <Textarea
            id="rc-footer"
            rows={3}
            value={footerText}
            maxLength={RECEIPT_FOOTER_MAX}
            onChange={(e) => setFooterText(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle
            label="Served by"
            help="Print the budtender's name on each receipt."
            checked={showEmployee}
            onChange={setShowEmployee}
          />
          <Toggle
            label="You saved"
            help="Show promo savings when a discount applied."
            checked={showSavings}
            onChange={setShowSavings}
          />
          <Toggle
            label="Loyalty points"
            help="Show member + points earned when attached."
            checked={showLoyalty}
            onChange={setShowLoyalty}
          />
        </div>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save receipt"}
        </Button>
        <p className="text-xs text-[var(--admin-text-faint)]">
          Registers download the new design with their next menu refresh (automatic whenever a
          register is online). Offline registers keep printing the last design they downloaded.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
          Live preview — exactly what the printer receives
        </p>
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-white">
          <iframe
            title="Receipt preview"
            sandbox=""
            srcDoc={previewHtml}
            className="h-[560px] w-full"
            style={{ border: 0 }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
          Sample sale shown at 72&nbsp;mm print width. The preview runs the identical receipt
          builder the register hands to Star PassPRNT — what you see is what prints.
        </p>
      </div>
    </div>
  );
}
