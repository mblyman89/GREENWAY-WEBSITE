/**
 * tests/compliance/inbound-attachments-fetch.test.ts  (H14-attachments-fetch)
 *
 * Locks in the fix for "forwarded vendor emails land with 0 attachments / no
 * manifest". Resend's inbound webhook is metadata-only (docs/webhooks/emails/
 * received), so the real content (email body + attachment bytes) must be fetched
 * out-of-band via the receiving API. The PURE half of that fix lives in
 * resend-receiving-core: pull the received-email id from the webhook, extract the
 * WCIA Transfer Data Link (.json) + invoice/manifest download links from the
 * email body, and map the Attachments-API response to a pre-download shape.
 *
 * These are grounded in the OWNER'S REAL vendor email (Cultivera/$UBX, Order
 * #17635): the body carries a `https://files.cultivera.com/.../....json` transfer
 * link plus "Click here to download the invoice/manifest." anchors. Gmail
 * forwarding keeps those body links but drops the MIME attachments — which is
 * exactly why the .json link is the primary, most reliable manifest source.
 */
import { describe, it, expect } from "vitest";
import {
  extractEmailIdFromWebhook,
  extractTransferLinksFromBody,
  mapReceivingAttachments,
  decodeDataUriHtml,
  __runResendReceivingTests,
} from "@/lib/inbound-email/resend-receiving-core";
import { extractLinksFromNote } from "@/lib/inbound-email/inbound-store";
import {
  classifyAttachmentRole,
  __runInboundNormalizeTests,
  type NormalizedAttachment,
} from "@/lib/inbound-email/inbound-normalize-core";

describe("resend-receiving-core (H14-attachments-fetch)", () => {
  it("passes the embedded self-test suite", () => {
    const r = __runResendReceivingTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  it("pulls the received-email id from the documented webhook shape", () => {
    // Exact payload from docs/webhooks/emails/received.
    const webhook = {
      type: "email.received",
      created_at: "2026-02-22T23:41:12.126Z",
      data: {
        email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
        from: "onboarding@resend.dev",
        to: ["vendor_intake@intake.greenwaymarijuana.com"],
        subject: "Sending this example",
        attachments: [
          { id: "2a0c9ce0", filename: "avatar.png", content_type: "image/png" },
        ],
      },
    };
    expect(extractEmailIdFromWebhook(webhook)).toBe(
      "56761188-7520-42d8-8898-ff6fc54ce618",
    );
  });

  it("extracts the WCIA Transfer Data Link + invoice/manifest links from the real vendor email body", () => {
    // Mirrors the owner's screenshot: SUBX / Order #17635.
    const html = [
      "<p>Dear Greenway Marijuana,</p>",
      "<p>Attached is the final invoice for Order# - 17635 from SUBX.</p>",
      '<p>Copy and paste the following <a href="https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json">WCIA Transfer Data Link</a> into your system to import your order:</p>',
      "<p>https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json</p>",
      '<p>Click <a href="https://files.cultivera.com/dl/invoice/2796.pdf">here</a> to download the invoice.</p>',
      '<p>Click <a href="https://files.cultivera.com/dl/manifest/2796.pdf">here</a> to download the manifest.</p>',
    ].join("\n");

    const links = extractTransferLinksFromBody(html, null);
    expect(links.transferJsonUrl).toBe(
      "https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json",
    );
    expect(links.invoiceUrl).toBe("https://files.cultivera.com/dl/invoice/2796.pdf");
    expect(links.manifestUrl).toBe("https://files.cultivera.com/dl/manifest/2796.pdf");
  });

  it("extracts GrowFlow's tokenized WCIA transfer endpoint (no .json extension)", () => {
    // Verified from a real Greenway GrowFlow order email ("New order INV-29127").
    // Opening the link shows raw WCIA JSON 2.1.0. This format PARSE FAILED before
    // H15-PRE-a because the old matcher required a `.json` extension.
    const html = [
      "<div>growflow</div>",
      "<p>Please find the transfer documentation from Green Labs for INV-29127 attached.</p>",
      "<p><strong>WCIA Transfer Data Link (JSON):</strong></p>",
      "<p>https://go.growflow.com/wa/wcia/transfer?token=EAAAAAITSbL7TP6d2qbsaRvzc2l0Oh8vN2Fa0k</p>",
    ].join("\n");
    const links = extractTransferLinksFromBody(html, null);
    expect(links.transferJsonUrl).toBe(
      "https://go.growflow.com/wa/wcia/transfer?token=EAAAAAITSbL7TP6d2qbsaRvzc2l0Oh8vN2Fa0k",
    );
  });

  it("extracts the OpenTHC / High End Farms '.json' transfer link on a non-Cultivera host", () => {
    // Verified from a real "High End Farms Delivery 4/29" email; host is openfhc,
    // not Cultivera. Was previously only partially handled.
    const text = [
      "Your order is scheduled to be delivered Wednesday, 4/29. The invoice and lab COAs are attached.",
      "JSON link: https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json",
      "Order total: $1,146.00",
    ].join("\n");
    const links = extractTransferLinksFromBody(null, text);
    expect(links.transferJsonUrl).toBe(
      "https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json",
    );
  });

  it("NEVER mislabels the WCIA transfer JSON as the invoice link (H15-PRE-b)", () => {
    // Real High End Farms body: "...The invoice and lab COAs are attached." sits
    // right before the JSON link, which previously made the invoice link resolve
    // to the wcia.json — that's why clicking Invoice opened raw JSON. The transfer
    // JSON must never surface as an invoice/manifest download link.
    const html = [
      "<div>Your order is scheduled to be delivered Wednesday, 4/29. The invoice and lab COAs are attached.</div>",
      '<div>JSON link: <a href="https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json">wcia.json</a></div>',
    ].join("\n");
    const links = extractTransferLinksFromBody(html, null);
    expect(links.transferJsonUrl).toBe(
      "https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json",
    );
    expect(links.invoiceUrl).toBeNull();
    expect(links.manifestUrl).toBeNull();
  });

  it("still finds real invoice/manifest PDF download links alongside the transfer JSON", () => {
    // Cultivera: the .json is the transfer link; the PDFs are the real downloads.
    const html = [
      '<a href="https://files.cultivera.com/abc/Cultivera_ORD-1_413541.json">WCIA Transfer Data Link</a>',
      '<p>Click <a href="https://files.cultivera.com/dl/invoice/2796.pdf">here</a> to download the invoice.</p>',
      '<p>Click <a href="https://files.cultivera.com/dl/manifest/2796.pdf">here</a> to download the manifest.</p>',
    ].join("\n");
    const links = extractTransferLinksFromBody(html, null);
    expect(links.invoiceUrl).toBe("https://files.cultivera.com/dl/invoice/2796.pdf");
    expect(links.manifestUrl).toBe("https://files.cultivera.com/dl/manifest/2796.pdf");
  });

  it("classifies attachment roles from the real vendor filenames", () => {
    const att = (filename: string): NormalizedAttachment => ({
      filename,
      contentType: "application/pdf",
      text: null,
      base64: "x",
    });
    // GrowFlow: TransferLog (manifest) + Invoice + QA (coa).
    expect(classifyAttachmentRole(att("TransferLog_303xxxx.pdf"))).toBe("manifest");
    expect(classifyAttachmentRole(att("Invoice_2026-07-07T18_37_52.pdf"))).toBe("invoice");
    expect(classifyAttachmentRole(att("QA_2026-07-07T18_37_52.pdf"))).toBe("coa");
    // High End Farms: Invoice (which is also the manifest) + Lab_Results (coa).
    expect(
      classifyAttachmentRole(att("Greenway_Marijuana_-_260429_-_Invoice_01KQ7GS6EXA3DV5M.pdf")),
    ).toBe("invoice");
    expect(
      classifyAttachmentRole(att("Greenway_Marijuana_-_260429_-_01KQ7GS6EXA3DV5M-Lab_Results.pdf")),
    ).toBe("coa");
  });

  it("passes the inbound-normalize-core embedded self-tests", () => {
    const { failed } = __runInboundNormalizeTests();
    expect(failed).toBe(0);
  });

  it("decodes the data_uri html body Resend serves by default", () => {
    const b64 = Buffer.from("<p>WCIA</p>", "utf8").toString("base64");
    expect(decodeDataUriHtml(`data:text/html;base64,${b64}`)).toBe("<p>WCIA</p>");
  });

  it("maps the receiving Attachments-API response to a pre-download shape and skips id-less rows", () => {
    // Shape from docs/api-reference/emails/list-received-email-attachments.
    const data = [
      {
        id: "2a0c9ce0-3112-4728-976e-47ddcd16a318",
        filename: "document.pdf",
        content_type: "application/pdf",
        download_url:
          "https://inbound-cdn.resend.com/e/attachments/2a0c9ce0?signature=sig-123",
      },
      { filename: "orphan.pdf" }, // no id -> skipped
    ];
    const mapped = mapReceivingAttachments(data);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].filename).toBe("document.pdf");
    expect(mapped[0].downloadUrl).toContain("inbound-cdn.resend.com");
  });
});

describe("extractLinksFromNote (H14 — surface invoice/manifest links in the panel)", () => {
  it("pulls invoice + manifest URLs out of the webhook fetch-trail note", () => {
    const note =
      "no manifest attachment found — fetched WCIA Transfer Data Link JSON; " +
      "invoice link: https://files.cultivera.com/dl/invoice/2796.pdf; " +
      "manifest link: https://files.cultivera.com/dl/manifest/2796.pdf";
    const links = extractLinksFromNote(note);
    expect(links.invoiceUrl).toBe("https://files.cultivera.com/dl/invoice/2796.pdf");
    expect(links.manifestUrl).toBe("https://files.cultivera.com/dl/manifest/2796.pdf");
  });

  it("returns nulls when the note has no links", () => {
    expect(extractLinksFromNote("staged 1 draft manifest(s)")).toEqual({
      invoiceUrl: null,
      manifestUrl: null,
    });
    expect(extractLinksFromNote(null)).toEqual({ invoiceUrl: null, manifestUrl: null });
  });
});
