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
