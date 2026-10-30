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
  RECEIPT_RETURN_POLICY_MAX,
  RECEIPT_BOTTOM_LOGO_MAX,
  RECEIPT_BOTTOM_LOGO_MIN,
  RECEIPT_BOTTOM_LOGO_MAX_CHARS,
  type PosReceiptConfig,
} from "@/lib/pos/receipt-config-core";
import { prepareLogoForPrint } from "@/lib/printing/logo-print-core";
import { RECEIPT_LOGO_MIN_WIDTH, RECEIPT_LOGO_WIDTH } from "@/lib/pos/receipt-logo-core";
import { defaultReturnPolicyText } from "@/lib/pos/returns-core";
import { saveReceiptConfigAction } from "@/app/admin/registers/receipt/actions";
import {
  DISCOUNT_EXPLANATION_MAX,
  DISCOUNT_SUMMARY_TITLE_MAX,
  type DiscountDisplayConfig,
} from "@/lib/pos/receipt-discount-core";
import { computeOrderTotals } from "@/lib/orders/order-pricing-core";
import { buildTestPrintBody } from "@/lib/printing/receipt-escpos-core";

/**
 * Sample lines that exercise every discount explanation: a percent deal the
 * cost floor capped, a 3-for-2 bundle spread across the units with a loyalty
 * reward on top, and an undiscounted item.
 */
const SAMPLE_LINES: PosReceiptInput["lines"] = [
  {
    productName: "Blue Dream 3.5g",
    quantity: 1,
    unitPriceMinor: 2500,
    regularPriceMinor: 3000,
    category: "flower",
    brand: "Sky High Farms",
    unitGrams: 3.5,
    appliedLabel: "Happy Hour \u00b7 25% off",
    appliedPercent: 16.67,
    atCostFloor: true,
    promoUnitPriceMinor: 2500,
  },
  {
    productName: "Gummy Bites 100mg",
    quantity: 3,
    unitPriceMinor: 1100,
    regularPriceMinor: 1800,
    category: "edible",
    brand: "Craft Elixirs",
    unitThcMg: 10,
    appliedLabel: "Sunday Funday \u00b7 3 for 2",
    appliedPercent: 33.33,
    promoUnitPriceMinor: 1200,
    loyaltyDiscountMinor: 100,
    loyaltyLabel: "Loyalty reward GW-AB12-CD34",
  },
  {
    productName: "Pre-roll 1g",
    quantity: 1,
    unitPriceMinor: 900,
    regularPriceMinor: 900,
    category: "preroll",
    brand: "Greenway",
    unitGrams: 1,
  },
];

const SAMPLE_TOTALS = computeOrderTotals(
  SAMPLE_LINES.map((l) => ({
    category: l.category ?? "flower",
    quantity: l.quantity,
    unitPriceMinorUnits: l.unitPriceMinor,
    regularPriceMinorUnits: l.regularPriceMinor,
  })),
);

/** Representative sample sale so every toggle is visible in the preview. */
function sampleReceipt(cfg: PosReceiptConfig): PosReceiptInput {
  const tendered = Math.ceil(SAMPLE_TOTALS.totalMinorUnits / 1000) * 1000;
  return {
    saleClientUuid: "00000000-0000-4000-8000-0000eeff1234",
    soldAtIso: new Date().toISOString(),
    registerLabel: "Register 1",
    // Slice 22b — the sample carries the SAME rich fields a real sale does,
    // so every toggle below actually changes something visible, and the
    // excise/sales split renders with real category-correct arithmetic.
    lines: SAMPLE_LINES,
    subtotalMinor: SAMPLE_TOTALS.subtotalMinorUnits,
    taxMinor: SAMPLE_TOTALS.estimatedTaxMinorUnits,
    totalMinor: SAMPLE_TOTALS.totalMinorUnits,
    savingsMinor: SAMPLE_TOTALS.savingsMinorUnits,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: tendered,
    changeMinor: tendered - SAMPLE_TOTALS.totalMinorUnits,
    headerText: cfg.headerText,
    footerText: cfg.footerText,
    addressLines: receiptAddressLines(cfg),
    servedBy: cfg.showEmployee ? "Casey" : null,
    hideSavings: !cfg.showSavings,
    loyalty: cfg.showLoyalty ? { memberLabel: "Sample Member", pointsEarned: 41 } : null,
    showTaxBreakdown: cfg.showTaxBreakdown,
    showLogo: cfg.showLogo,
    logoWidth: cfg.logoWidth,
    showReturnPolicy: cfg.showReturnPolicy,
    returnPolicyText: cfg.returnPolicyText,
    showItemDetail: cfg.showItemDetail,
    showBarcode: cfg.showBarcode,
    showSaleSummary: cfg.showSaleSummary,
    // SLICE 23 — the preview shows a fun name under the code, exactly as a
    // real sale will, so the owner sees the actual result and not a mock-up.
    useQrCode: cfg.useQrCode,
    displayName: "Purple Rain",
    logoDataUri: cfg.bottomLogoDataUri || null,
    logoWidthPx: cfg.bottomLogoWidth,
    discountDisplay: cfg.registerDiscount,
  };
}

/**
 * The owner's discount-transparency switches for ONE surface (register or
 * online). Every switch maps 1:1 to a DiscountDisplayConfig field so the
 * preview beside it changes the moment a box is ticked.
 */
function DiscountSettings({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: DiscountDisplayConfig;
  onChange: (next: DiscountDisplayConfig) => void;
}) {
  const set = <K extends keyof DiscountDisplayConfig>(key: K, v: DiscountDisplayConfig[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        Under each discounted item
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          label="Regular (before) price"
          help={'"Regular 3 x $18.00 = $54.00" so the customer sees the starting point.'}
          checked={value.showRegularPrice}
          onChange={(v) => set("showRegularPrice", v)}
        />
        <Toggle
          label="Money saved per item"
          help={'"You saved ... -$18.00" on every discounted line, plus the price each.'}
          checked={value.showLineSavings}
          onChange={(v) => set("showLineSavings", v)}
        />
        <Toggle
          label="Percent off per item"
          help="The real percent this line got, worked out from the exact cents."
          checked={value.showLinePercent}
          onChange={(v) => set("showLinePercent", v)}
        />
        <Toggle
          label="Deal name"
          help={'"Deal: Sunday Funday (Buy 3, pay for 2)" \u2014 which deal applied and its type.'}
          checked={value.showDealName}
          onChange={(v) => set("showDealName", v)}
        />
        <Toggle
          label="How the deal works"
          help="One plain sentence, e.g. how a bundle's saving is shared across the items to the cent."
          checked={value.showDealMechanic}
          onChange={(v) => set("showDealMechanic", v)}
        />
        <Toggle
          label="Cost-floor note"
          help="When a deal was capped so the item isn't sold below cost, say so and show the percent it actually got."
          checked={value.showCostFloorNote}
          onChange={(v) => set("showCostFloorNote", v)}
        />
        <Toggle
          label="Other discounts on the item"
          help="Loyalty rewards, employee/veteran/industry discounts, manager price adjustments and medical tax savings, each on its own row."
          checked={value.showOtherDiscounts}
          onChange={(v) => set("showOtherDiscounts", v)}
        />
      </div>
      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        Order savings summary
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          label="Savings summary box"
          help="Regular total, total discounts, your price and items discounted \u2014 below the totals."
          checked={value.showOrderSummary}
          onChange={(v) => set("showOrderSummary", v)}
        />
        <Toggle
          label="Total percent off the order"
          help={'"Total off your order 22.4%" inside the summary.'}
          checked={value.showOrderPercent}
          onChange={(v) => set("showOrderPercent", v)}
        />
        <Toggle
          label="Savings by deal"
          help="One row per deal or program with what it saved across the whole order."
          checked={value.showDealBreakdown}
          onChange={(v) => set("showDealBreakdown", v)}
        />
        <Toggle
          label={'"How your discounts work" notes'}
          help="No-stacking rule, bundle spreading, cost-floor caps, tax-inclusive pricing \u2014 only the notes that apply to the order print."
          checked={value.showExplanation}
          onChange={(v) => set("showExplanation", v)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Percent decimals"
          help="How percentages print: 22%, 22.4% or 22.41%. Always rounded down so we never overstate a saving."
          htmlFor={`${idPrefix}-dec`}
        >
          <select
            id={`${idPrefix}-dec`}
            value={value.percentDecimals}
            onChange={(e) => set("percentDecimals", Number(e.target.value))}
            className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
          >
            <option value={0}>Whole number (22%)</option>
            <option value={1}>One decimal (22.4%)</option>
            <option value={2}>Two decimals (22.41%)</option>
          </select>
        </Field>
        <Field
          label="Summary heading"
          help={`Max ${DISCOUNT_SUMMARY_TITLE_MAX} characters; blank resets to "YOUR SAVINGS".`}
          htmlFor={`${idPrefix}-title`}
        >
          <Input
            id={`${idPrefix}-title`}
            value={value.summaryTitle}
            maxLength={DISCOUNT_SUMMARY_TITLE_MAX}
            onChange={(e) => set("summaryTitle", e.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Your own note (optional)"
        help={`Printed as the last note in the summary when the order has a discount (needs the notes switch on). Max ${DISCOUNT_EXPLANATION_MAX} characters.`}
        htmlFor={`${idPrefix}-note`}
      >
        <Textarea
          id={`${idPrefix}-note`}
          rows={2}
          value={value.explanationText}
          maxLength={DISCOUNT_EXPLANATION_MAX}
          onChange={(e) => set("explanationText", e.target.value)}
          placeholder="e.g. Questions about a discount? Ask any budtender."
        />
      </Field>
    </div>
  );
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

export function ReceiptConfigEditor({
  initial,
  defaultPolicyText,
}: {
  initial: PosReceiptConfig;
  /** Fix 6F — what prints when the policy box is blank (from Return policy settings). */
  defaultPolicyText?: string;
}) {
  const { toast } = useToast();
  const [headerText, setHeaderText] = useState(initial.headerText);
  const [addressText, setAddressText] = useState(initial.addressText);
  const [footerText, setFooterText] = useState(initial.footerText);
  const [showEmployee, setShowEmployee] = useState(initial.showEmployee);
  const [showSavings, setShowSavings] = useState(initial.showSavings);
  const [showLoyalty, setShowLoyalty] = useState(initial.showLoyalty);
  // -- Slice 22b --------------------------------------------------------
  const [showTaxBreakdown, setShowTaxBreakdown] = useState(initial.showTaxBreakdown);
  const [showLogo, setShowLogo] = useState(initial.showLogo);
  const [logoWidth, setLogoWidth] = useState(initial.logoWidth);
  const [showReturnPolicy, setShowReturnPolicy] = useState(initial.showReturnPolicy);
  const [returnPolicyText, setReturnPolicyText] = useState(initial.returnPolicyText);
  const [showItemDetail, setShowItemDetail] = useState(initial.showItemDetail);
  const [showBarcode, setShowBarcode] = useState(initial.showBarcode);
  const [showSaleSummary, setShowSaleSummary] = useState(initial.showSaleSummary);
  // -- Slice 23 ----------------------------------------------------------
  const [useQrCode, setUseQrCode] = useState(initial.useQrCode);
  const [bottomLogoDataUri, setBottomLogoDataUri] = useState(initial.bottomLogoDataUri);
  const [bottomLogoWidth, setBottomLogoWidth] = useState(initial.bottomLogoWidth);
  // -- Discount transparency ----------------------------------------------
  const [registerDiscount, setRegisterDiscount] = useState<DiscountDisplayConfig>(initial.registerDiscount);
  const [onlineDiscount, setOnlineDiscount] = useState<DiscountDisplayConfig>(initial.onlineDiscount);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
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
        showTaxBreakdown,
        showLogo,
        logoWidth,
        showReturnPolicy,
        returnPolicyText,
        showItemDetail,
        showBarcode,
        showSaleSummary,
        useQrCode,
        bottomLogoDataUri,
        bottomLogoWidth,
        registerDiscount,
        onlineDiscount,
      }),
    [
      headerText,
      addressText,
      footerText,
      showEmployee,
      showSavings,
      showLoyalty,
      showTaxBreakdown,
      showLogo,
      logoWidth,
      showReturnPolicy,
      returnPolicyText,
      showItemDetail,
      showBarcode,
      showSaleSummary,
      useQrCode,
      bottomLogoDataUri,
      bottomLogoWidth,
      registerDiscount,
      onlineDiscount,
    ],
  );

  const previewHtml = useMemo(() => buildPosReceiptHtml(sampleReceipt(draft)), [draft]);
  // The online pickup ticket, rendered by the SAME function a real online
  // order goes through (48 columns = 80 mm paper). Fixed timestamp keeps the
  // render deterministic between server and client.
  const onlinePreview = useMemo(
    () =>
      buildTestPrintBody({
        columns: 48,
        headerText: draft.headerText,
        footerText: draft.footerText,
        addressText: draft.addressText,
        placedAt: "2026-01-15T20:30:00.000Z",
        note: "Sample online order \u2014 shows how discounts print on the pickup ticket.",
        discountDisplay: draft.onlineDiscount,
      }),
    [draft],
  );

  function save() {
    startTransition(async () => {
      const res = await saveReceiptConfigAction({
        headerText,
        addressText,
        footerText,
        showEmployee,
        showSavings,
        showLoyalty,
        showTaxBreakdown,
        showLogo,
        logoWidth,
        showReturnPolicy,
        returnPolicyText,
        showItemDetail,
        showBarcode,
        showSaleSummary,
        useQrCode,
        bottomLogoDataUri,
        bottomLogoWidth,
        registerDiscount: draft.registerDiscount,
        onlineDiscount: draft.onlineDiscount,
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
          <Toggle
            label="Item detail"
            help="Brand, size, THC and the deal name under each item."
            checked={showItemDetail}
            onChange={setShowItemDetail}
          />
          <Toggle
            label="Sale summary"
            help="Item count, total grams and savings in one strip."
            checked={showSaleSummary}
            onChange={setShowSaleSummary}
          />
          <Toggle
            label="Scannable code"
            help="Encodes the real receipt number — scan it to start a return."
            checked={showBarcode}
            onChange={setShowBarcode}
          />
          {/* SLICE 23 — QR vs Code 128. Only meaningful when a code prints. */}
          {showBarcode ? (
            <Toggle
              label="Use a QR code"
              help="QR survives folding and fading (it self-corrects) and every phone reads it. Turn off only for an old barcode-only scanner."
              checked={useQrCode}
              onChange={setUseQrCode}
            />
          ) : null}
        </div>

        {/* Slice 22b — the statutory one. Separated from the cosmetic toggles
            above, and it explains itself when switched off. */}
        <div className="space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <Toggle
            label="Itemize cannabis excise separately (required)"
            help="Prints WA Cannabis Excise (37%) and State & Local Sales Tax (9.3%) as separate lines instead of one combined Tax line."
            checked={showTaxBreakdown}
            onChange={setShowTaxBreakdown}
          />
          {showTaxBreakdown ? (
            <p className="text-xs text-[var(--admin-text-faint)]">
              RCW 69.50.535(1)(a): &ldquo;The tax must be separately itemized from the state and
              local retail sales tax on the sales receipt provided to the buyer.&rdquo; Leave this on.
            </p>
          ) : (
            <p className="text-xs font-medium text-[var(--admin-danger,#b91c1c)]">
              Warning: RCW 69.50.535(1)(a) requires the cannabis excise tax to be itemized
              separately from the retail sales tax on the receipt given to the buyer. With this off,
              receipts print a single combined Tax line and no longer meet that requirement.
            </p>
          )}
        </div>

        {/* Logo */}
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <Toggle
            label="Print the Greenway wordmark"
            help="The script logo at the very top, printed as artwork — works offline, no network needed."
            checked={showLogo}
            onChange={setShowLogo}
          />
          {showLogo ? (
            <Field
              label="Logo width"
              help={`${RECEIPT_LOGO_MIN_WIDTH}–${RECEIPT_LOGO_WIDTH} dots. ${RECEIPT_LOGO_WIDTH} is the full 72 mm paper width.`}
              htmlFor="rc-logo-width"
            >
              <input
                id="rc-logo-width"
                type="range"
                min={RECEIPT_LOGO_MIN_WIDTH}
                max={RECEIPT_LOGO_WIDTH}
                step={16}
                value={logoWidth}
                onChange={(e) => setLogoWidth(Number(e.target.value))}
                className="w-full accent-[var(--admin-gold)]"
              />
            </Field>
          ) : null}
        </div>

        {/* SLICE 23 — the custom bottom logo. */}
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div>
            <p className="text-sm font-medium text-[var(--admin-text)]">
              Your own logo at the bottom
            </p>
            <p className="text-xs text-[var(--admin-text-faint)]">
              Printed under the QR code and the order name, above the footer message.
              Upload a PNG and it is converted to clean black-and-white print
              artwork automatically — the background is detected and dropped, so
              you never get a black box.
            </p>
          </div>

          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={logoBusy}
            className="block w-full text-xs text-[var(--admin-text-muted)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--admin-surface-2)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[var(--admin-text)]"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-picking the same file
              if (!file) return;
              setLogoBusy(true);
              setLogoError(null);
              setLogoNote(null);
              try {
                // Decode in the browser, then run the SAME pure core the tests
                // cover. Nothing is uploaded anywhere: the conversion happens
                // here and only the finished 1-bit image is saved.
                const bitmapSrc = await createImageBitmap(file);
                const canvas = document.createElement("canvas");
                canvas.width = bitmapSrc.width;
                canvas.height = bitmapSrc.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Could not read that image.");
                ctx.drawImage(bitmapSrc, 0, 0);
                const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);

                const prepared = prepareLogoForPrint(
                  { width: raw.width, height: raw.height, data: raw.data },
                  bottomLogoWidth,
                );
                if (!prepared.ok) {
                  setLogoError(prepared.error ?? "That image could not be used.");
                } else if (prepared.dataUri.length > RECEIPT_BOTTOM_LOGO_MAX_CHARS) {
                  setLogoError(
                    "That logo is too detailed to fit on a receipt. Try a simpler, flatter version.",
                  );
                } else {
                  setBottomLogoDataUri(prepared.dataUri);
                  const pct = Math.round(prepared.bitmap.coverage * 100);
                  setLogoNote(
                    `Converted to ${prepared.bitmap.width}×${prepared.bitmap.height} print artwork ` +
                      `(${pct}% ink). Check the preview, then Save.`,
                  );
                }
              } catch {
                setLogoError("That file could not be read as an image.");
              } finally {
                setLogoBusy(false);
              }
            }}
          />

          {logoBusy ? (
            <p className="text-xs text-[var(--admin-text-muted)]">Converting…</p>
          ) : null}
          {logoError ? (
            <p className="text-xs font-medium text-[var(--admin-danger,#b91c1c)]">{logoError}</p>
          ) : null}
          {logoNote ? (
            <p className="text-xs font-medium text-[var(--admin-accent,#166534)]">{logoNote}</p>
          ) : null}

          {bottomLogoDataUri ? (
            <>
              {/* Shown on a white card because that is what paper is. */}
              <div className="flex items-center gap-3 rounded-md border border-[var(--admin-border)] bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img loading="lazy" decoding="async"
                  src={bottomLogoDataUri}
                  alt="Receipt logo preview"
                  className="max-h-24 w-auto"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
              <Field
                label="Logo width"
                help={`${RECEIPT_BOTTOM_LOGO_MIN}–${RECEIPT_BOTTOM_LOGO_MAX} dots. Re-upload after changing this for the sharpest result.`}
                htmlFor="rc-bottom-logo-width"
              >
                <input
                  id="rc-bottom-logo-width"
                  type="range"
                  min={RECEIPT_BOTTOM_LOGO_MIN}
                  max={RECEIPT_BOTTOM_LOGO_MAX}
                  step={10}
                  value={bottomLogoWidth}
                  onChange={(ev) => setBottomLogoWidth(Number(ev.target.value))}
                  className="w-full accent-[var(--admin-gold)]"
                />
              </Field>
              <Button
                variant="neutral"
                size="sm"
                onClick={() => {
                  setBottomLogoDataUri("");
                  setLogoNote(null);
                  setLogoError(null);
                }}
              >
                Remove logo
              </Button>
            </>
          ) : null}
        </div>

        {/* Return policy */}
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <Toggle
            label="Print the return policy"
            help="So the customer leaves holding the rules, instead of hearing them at the counter."
            checked={showReturnPolicy}
            onChange={setShowReturnPolicy}
          />
          {showReturnPolicy ? (
            <Field
              label="Return policy wording"
              help={`Max ${RECEIPT_RETURN_POLICY_MAX} characters. Leave blank to use the wording generated from the return window the returns screen actually enforces.`}
              htmlFor="rc-policy"
            >
              <Textarea
                id="rc-policy"
                rows={3}
                value={returnPolicyText}
                maxLength={RECEIPT_RETURN_POLICY_MAX}
                onChange={(e) => setReturnPolicyText(e.target.value)}
                placeholder={defaultPolicyText ?? defaultReturnPolicyText()}
              />
            </Field>
          ) : null}
        </div>
        {/* Discount transparency — register */}
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div>
            <p className="text-sm font-semibold text-[var(--admin-text)]">Discount details — register receipt</p>
            <p className="text-xs text-[var(--admin-text-faint)]">
              What the printed register receipt (and its emailed copy) explains about every
              discount. The register&apos;s checkout screen always shows the full detail to the
              cashier and customer.
            </p>
          </div>
          <DiscountSettings idPrefix="rc-rd" value={registerDiscount} onChange={setRegisterDiscount} />
        </div>

        {/* Discount transparency — online orders */}
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div>
            <p className="text-sm font-semibold text-[var(--admin-text)]">Discount details — online orders</p>
            <p className="text-xs text-[var(--admin-text-faint)]">
              The online receipt: the website checkout summary, the order confirmation page and
              the printed pickup ticket. Preview of the pickup ticket is below the register
              preview.
            </p>
          </div>
          <DiscountSettings idPrefix="rc-od" value={onlineDiscount} onChange={setOnlineDiscount} />
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
            className="h-[760px] w-full"
            style={{ border: 0 }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
          Sample sale shown at 72&nbsp;mm print width. The preview runs the identical receipt
          builder the register hands to Star PassPRNT — what you see is what prints.
        </p>
        <p className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
          Online pickup ticket preview
        </p>
        <pre className="max-h-[760px] overflow-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-white p-3 font-mono text-[10px] leading-tight text-black">
          {onlinePreview}
        </pre>
        <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
          Rendered by the same formatter a real online order uses (80&nbsp;mm paper). The
          website checkout and confirmation page follow the same online settings.
        </p>
      </div>
    </div>
  );
}
