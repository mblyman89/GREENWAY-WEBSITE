/**
 * D237 N-2 (SOP-22 G-112, F-22-3): newsletter broadcasts are queued per
 * address and sent in batches of 100 with an Idempotency-Key, by a worker
 * that resumes after a cut-off and never resends a "sent" address.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterBatchCoreTests,
  BATCH_SIZE,
  batchNoFor,
  idempotencyKey,
  interpretBatchResponse,
  sendStatusFrom,
} from "@/lib/cms/newsletter-batch-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D237 N-2 reliable newsletter sending", () => {
  it("pure core self-tests all pass", () => {
    const r = __runNewsletterBatchCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });

  it("batches of 100 and a stable idempotency key per batch and round", () => {
    expect(BATCH_SIZE).toBe(100);
    expect(batchNoFor(0)).toBe(batchNoFor(99));
    expect(batchNoFor(100)).toBe(batchNoFor(0) + 1);
    expect(idempotencyKey("s", 2, 0)).toBe(idempotencyKey("s", 2, 0));
    expect(idempotencyKey("s", 2, 0)).not.toBe(idempotencyKey("s", 2, 1));
    expect(idempotencyKey("x".repeat(400), 1, 0).length).toBeLessThanOrEqual(256);
  });

  it("retries 429 / 5xx / network, fails other 4xx", () => {
    expect(interpretBatchResponse(null, null, 1).kind).toBe("retry");
    expect(interpretBatchResponse(429, {}, 1).kind).toBe("retry");
    expect(interpretBatchResponse(503, {}, 1).kind).toBe("retry");
    expect(interpretBatchResponse(422, { message: "bad" }, 1).kind).toBe("failed");
    expect(sendStatusFrom({ pending: 1, sent: 5, failed: 0 })).toBe("sending");
  });

  it("migration 0362: service-role only, RLS on, no FK, truncate trigger, 'sending' status", () => {
    const sql = read("supabase/migrations/0362_newsletter_send_recipients.sql");
    expect(sql).toMatch(/create table if not exists public\.newsletter_send_recipients/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/grant[^;]*to service_role/i);
    expect(sql).not.toMatch(/\breferences\b/i);
    expect(sql).toMatch(/after truncate on public\.newsletter_sends/i);
    expect(sql).toMatch(/'sending'/);
    expect(sql).toMatch(/claimed_at/);
    expect(existsSync(join(root, "supabase/rollbacks/0362_newsletter_send_recipients.rollback.sql"))).toBe(true);
  });

  it("the send store queues broadcasts and falls back until 0362 is applied", () => {
    const s = read("src/lib/cms/newsletter-send-store.ts");
    expect(s).toContain("newsletter_send_recipients");
    expect(s).toContain("queued: true");
    expect(s).toContain("isMissingRecipientsTable");
  });

  it("the worker posts to the batch API with an Idempotency-Key and claims a lease", () => {
    const s = read("src/lib/cms/newsletter-queue-server.ts");
    expect(s).toContain("https://api.resend.com/emails/batch");
    expect(s).toContain("Idempotency-Key");
    expect(s).toContain("listUnsubscribeHeaders");
    expect(s).toMatch(/claimed_at\.is\.null/);
  });

  it("the 5-minute content-schedule cron also works the queue (no new cron)", () => {
    const r = read("src/app/api/cron/content-schedule/route.ts");
    expect(r).toContain("runNewsletterQueue");
    const v = read("vercel.json");
    expect(v).not.toContain("newsletter");
  });

  it("Send Center: queued redirect, progress bar, Retry failed (owner/admin)", () => {
    const a = read("src/app/admin/newsletter/actions.ts");
    expect(a).toContain("after(");
    expect(a).toContain("retryFailedNewsletterAction");
    expect(a).toContain('"newsletter.retry_failed"');
    expect(a.match(/can\(session\.profile\.role, "newsletter\.broadcast"\)/g)?.length).toBe(2);
    const p = read("src/app/admin/newsletter/page.tsx");
    expect(p).toContain("listOpenSendProgress");
    expect(p).toContain("progressLine");
    expect(p).toContain("Retry failed");
    expect(p).toContain("NewsletterSendAutoRefresh");
  });

  it("factory reset classifies the new table as KEEP", () => {
    const f = read("src/lib/accounting/factory-reset-core.ts");
    expect(f).toMatch(/table: "newsletter_send_recipients", disposition: "KEEP"/);
  });
});
