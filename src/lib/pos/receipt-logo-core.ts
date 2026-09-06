/**
 * src/lib/pos/receipt-logo-core.ts  (Slice 22b)
 *
 * PURE receipt artwork. No I/O, no React, no server-only import.
 *
 * WHY THE LOGO IS EMBEDDED AS A data: URI RATHER THAN LINKED
 * ----------------------------------------------------------
 * This was determined by reading the print path, not by preference:
 *
 *  1. ios/App/App/StarPrinterPlugin.swift calls
 *         webView.loadHTMLString(html, baseURL: nil)
 *     A nil baseURL means a relative src like "/brand/logo.png" has NOTHING
 *     to resolve against and simply cannot load.
 *
 *  2. An absolute https:// src would need the network. Register sales are
 *     required to complete and print OFFLINE, so a receipt whose header only
 *     appears when the wifi is up is not acceptable.
 *
 *  3. src/lib/pos/receipt-core.ts buildPassPrntUrl percent-encodes the ENTIRE
 *     receipt HTML into a starpassprnt:// URL. Whatever is embedded rides
 *     along inside that URL, so size is a hard practical constraint.
 *
 * A self-contained data: URI is the only option that satisfies all three.
 *
 * WHY IT IS 1-BIT BLACK-ON-WHITE
 * ------------------------------
 * The plugin renders the HTML to a bitmap and sends it with actionPrintImage
 * (StarPrinterPlugin.swift). A thermal printer burns dots: there is no colour,
 * no white ink, and no grey. The shipped brand wordmark
 * (public/brand/greenway-marijuana-wordmark-transparent.png) is 5891x1170 RGBA
 * with WHITE glyphs on transparency — printed as-is it would be invisible on
 * white paper. So the alpha channel (which carries the glyph shape) is
 * inverted to black-on-white and thresholded to 1 bit.
 *
 * MEASURED, NOT ESTIMATED
 * -----------------------
 *   original colour PNG, base64 .................. 197,252 bytes
 *   this asset (576 dots wide, 1-bit, optimised) ..   2,632 bytes
 * i.e. ~1.3% of the original. That is what makes the PassPRNT URL path safe.
 *
 * 576 dots is the full printable width of the Star TSP100IIIBi at PassPRNT
 * size=3, the same width receipt-core already lays the body out to.
 *
 * LAYOUT NOTE THAT MATTERS
 * ------------------------
 * StarPrinterPlugin.swift reads document.body.scrollHeight on didFinish and
 * snapshots to that height. An <img> with no explicit dimensions can finish
 * laying out AFTER that measurement and push content past the captured area,
 * clipping the receipt. The width/height below are therefore emitted as
 * explicit attributes AND as CSS — the image reserves its box immediately.
 */

/** Intrinsic pixel width of the embedded wordmark (= full print width). */
export const RECEIPT_LOGO_WIDTH = 576;
/** Intrinsic pixel height, preserving the source aspect ratio. */
export const RECEIPT_LOGO_HEIGHT = 114;

/**
 * The Greenway wordmark: 576x114, 1-bit, black on white, PNG, base64.
 *
 * Generated from public/brand/greenway-marijuana-wordmark-transparent.png by
 * taking the alpha channel, inverting it (glyphs -> black, background ->
 * white) and thresholding at 128. Committed as a constant rather than read
 * from disk so the pure core stays pure and the register keeps working with
 * no filesystem and no network.
 */
export const RECEIPT_LOGO_PNG_BASE64 =
  "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" +
  "zuc/sd0Ik3TggRkAAAAASUVORK5CYII=";

/** The full data: URI, ready to drop into an <img src>. */
export function receiptLogoDataUri(): string {
  return `data:image/png;base64,${RECEIPT_LOGO_PNG_BASE64}`;
}

/**
 * The <img> tag for the receipt header.
 *
 * `widthPx` lets the owner print a smaller mark without shipping a second
 * asset; the height is scaled to match so the wordmark can never distort.
 * Both dimensions are written as attributes AND inline CSS for the layout
 * reason documented in the file header.
 */
export function receiptLogoImgTag(widthPx: number = RECEIPT_LOGO_WIDTH): string {
  const w = clampLogoWidth(widthPx);
  const h = Math.max(1, Math.round((RECEIPT_LOGO_HEIGHT * w) / RECEIPT_LOGO_WIDTH));
  return (
    `<img class="logo" width="${w}" height="${h}" ` +
    `style="width:${w}px;height:${h}px;display:block;margin:0 auto;" ` +
    `alt="" src="${receiptLogoDataUri()}">`
  );
}

/** Smallest width at which the script wordmark is still legible on paper. */
export const RECEIPT_LOGO_MIN_WIDTH = 192;

/** Clamp a requested logo width into the printable range. */
export function clampLogoWidth(widthPx: unknown): number {
  if (typeof widthPx !== "number" || !Number.isFinite(widthPx)) return RECEIPT_LOGO_WIDTH;
  const w = Math.round(widthPx);
  if (w < RECEIPT_LOGO_MIN_WIDTH) return RECEIPT_LOGO_MIN_WIDTH;
  if (w > RECEIPT_LOGO_WIDTH) return RECEIPT_LOGO_WIDTH;
  return w;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptLogoCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL: ${msg}`);
    }
  };

  // The asset must be a real PNG: base64 of the 8-byte PNG signature starts
  // "iVBORw0KGgo". If someone pastes a corrupt blob this catches it.
  ok(RECEIPT_LOGO_PNG_BASE64.startsWith("iVBORw0KGgo"), "asset carries the PNG magic header");
  ok(/^[A-Za-z0-9+/]+={0,2}$/.test(RECEIPT_LOGO_PNG_BASE64), "asset is valid base64 alphabet");
  ok(RECEIPT_LOGO_PNG_BASE64.length % 4 === 0, "base64 length is a multiple of 4");

  // Size guard: the PassPRNT URL carries this payload. If a future edit swaps
  // in the full-colour PNG (197,252 bytes base64) this test fails LOUDLY
  // rather than silently breaking the app-switch print path in the shop.
  ok(
    RECEIPT_LOGO_PNG_BASE64.length < 8000,
    `asset stays small enough for the PassPRNT URL (is ${RECEIPT_LOGO_PNG_BASE64.length})`,
  );

  ok(receiptLogoDataUri().startsWith("data:image/png;base64,"), "data URI is well formed");
  ok(
    receiptLogoDataUri().length === RECEIPT_LOGO_PNG_BASE64.length + "data:image/png;base64,".length,
    "data URI is exactly the prefix plus the payload",
  );

  const tag = receiptLogoImgTag();
  ok(tag.includes(`width="576"`), "default tag is the full 576-dot print width");
  ok(tag.includes(`height="114"`), "default tag carries the matching height");
  ok(tag.includes("width:576px") && tag.includes("height:114px"), "dimensions also inline in CSS");
  ok(tag.includes("data:image/png;base64,"), "tag embeds the image inline, not by URL");
  ok(!tag.includes("http"), "tag never references the network (offline sales must print)");

  // Aspect ratio is preserved at every allowed width.
  for (const w of [192, 256, 384, 512, 576]) {
    const t = receiptLogoImgTag(w);
    const h = Math.round((RECEIPT_LOGO_HEIGHT * w) / RECEIPT_LOGO_WIDTH);
    ok(t.includes(`width="${w}"`) && t.includes(`height="${h}"`), `width ${w} keeps the aspect ratio`);
  }

  // Clamping: garbage in, printable width out. Never NaN in a style attribute.
  ok(clampLogoWidth(10) === RECEIPT_LOGO_MIN_WIDTH, "absurdly small width clamps up");
  ok(clampLogoWidth(9999) === RECEIPT_LOGO_WIDTH, "oversized width clamps to the paper");
  ok(clampLogoWidth(Number.NaN) === RECEIPT_LOGO_WIDTH, "NaN falls back to full width");
  ok(clampLogoWidth("576" as unknown) === RECEIPT_LOGO_WIDTH, "a string falls back, never NaN");
  ok(!receiptLogoImgTag(Number.NaN).includes("NaN"), "no NaN can reach the printed HTML");

  console.log(`pos/receipt-logo-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`receipt-logo-core self-tests failed: ${fail}`);
}
