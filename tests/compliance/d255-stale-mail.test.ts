/**
 * D255: the uploader refused to start on 21 open CCRS emails the hub never
 * showed (10/20 to 10/25, behind 76+ newer handled ones). This pins:
 *  - the hub list now carries EVERY open email (listRecentCcrsMail),
 *  - "Set aside old emails" sets aside only emails whose every file is no
 *    longer waiting (abandoned/closed/...), with a D255 note, and leaves the rest,
 *  - after it, the start blocker is clear for that env,
 *  - the button, action, audit and permission are wired.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function builder(table: string) {
  let op: "select" | "update" = "select";
  let payload: Row | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit = Infinity;
  const b = {
    select: () => b,
    update(p: Row) {
      op = "update";
      payload = p;
      return b;
    },
    eq(c: string, v: unknown) {
      filters.push((r) => r[c] === v);
      return b;
    },
    in(c: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[c]));
      return b;
    },
    order(c: string, o: { ascending: boolean }) {
      order = { col: c, asc: o.ascending };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then(res: (v: unknown) => unknown) {
      const rows = (db[table] ??= []);
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res);
      }
      const out = hit.map((r) => ({ ...r }));
      if (order) {
        const { col, asc } = order;
        out.sort((a, z) => (String(a[col] ?? "") < String(z[col] ?? "") ? -1 : 1) * (asc ? 1 : -1));
      }
      return Promise.resolve({ data: out.slice(0, limit), error: null }).then(res);
    },
  };
  return b;
}
const fakeAdmin = { from: (t: string) => builder(t) };
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

const mail = (id: string, at: string, kind: string, subject: string, extra: Row = {}): Row => ({
  id,
  received_at: at,
  kind,
  subject,
  env: "preprod",
  env_verified: true,
  body_text: "",
  analysis: { successes: [] },
  state: "new",
  csvs: [],
  ...extra,
});

beforeEach(() => {
  db.ccrs_mail_messages = [
    mail("m1", "2026-10-20T23:44:19Z", "success", "PRE: CCRS Processing Successful", { analysis: { successes: [{ fileName: "Strain_413541_20261020163350.csv" }] } }),
    mail("m2", "2026-10-20T23:45:03Z", "error", "PRE: CCRS errors for file: Area_413541_20261020163351_20261020T16440.csv", { env_verified: false }),
    mail("m3", "2026-10-25T21:15:14Z", "unknown", "PRE: CCRS Processing Error: Product_413541_20261025122117_20261025T1415944.csv", {
      env: null,
      env_verified: false,
      body_text: "PRE The file Product_413541_20261025122117_20261025T1415944.csv you submitted has not been processed.",
    }),
    // A live one: its file still waits. Must stay.
    mail("m4", "2026-11-19T06:50:00Z", "success", "PRE: CCRS Processing Successful", { analysis: { successes: [{ fileName: "Strain_413541_20261118224609.csv" }] } }),
    // A production email: outside PREprod's scope. Must stay.
    mail("m5", "2026-11-19T06:51:00Z", "success", "CCRS Processing Successful", { env: "prod", analysis: { successes: [{ fileName: "Area_413541_20261020163351.csv" }] } }),
  ];
  db.ccrs_mail_messages.push(
    // Unverified env (stored "prod" from a hint): the start blocker reads it as unknown, so it blocks PREprod too.
    mail("m6", "2026-10-21T00:12:38Z", "error", "PRE: CCRS errors for file: Inventory_413541_20261020165831_20261020T1712373.csv", { env: "prod", env_verified: false }),
  );
  // 30 newer handled emails push the old open ones out of a 25-row list.
  for (let i = 0; i < 30; i++) db.ccrs_mail_messages.push(mail(`h${i}`, `2026-11-${String(10 + (i % 9)).padStart(2, "0")}T0${i % 10}:00:00Z`, "success", "done", { state: "applied" }));
  db.ccrs_files = [
    { file_name: "Strain_413541_20261020163350.csv", env: "prod", state: "abandoned" },
    { file_name: "Area_413541_20261020163351.csv", env: "prod", state: "abandoned" },
    { file_name: "Product_413541_20261025122117.csv", env: "preprod", state: "abandoned" },
    { file_name: "Inventory_413541_20261020165831.csv", env: "preprod", state: "abandoned" },
    { file_name: "Strain_413541_20261118224609.csv", env: "preprod", state: "emitted" },
  ];
  db.site_settings = [];
});

describe("D255 hub list", () => {
  it("lists every open email even behind 25 newer handled ones", async () => {
    const { listRecentCcrsMail } = await import("@/lib/compliance/ccrs-mail-store");
    const r = await listRecentCcrsMail(25);
    const open = r.rows.filter((x) => x.state === "new").map((x) => x.id).sort();
    expect(open).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(r.rows.length);
  });
});

describe("D255 set aside old emails", () => {
  it("sets aside only stale emails in the env's start scope, with a D255 note, and the blocker clears", async () => {
    const { setAsideStaleCcrsMail } = await import("@/lib/compliance/ccrs-stale-mail-store");
    const r = await setAsideStaleCcrsMail(fakeAdmin as never, "preprod", "staff-1");
    expect(r.setAside).toBe(4);
    expect(r.kept.map((k) => k.id)).toEqual(["m4"]);
    const byId = Object.fromEntries(db.ccrs_mail_messages.map((m) => [m.id, m]));
    for (const id of ["m1", "m2", "m3", "m6"]) {
      expect(byId[id].state).toBe("dismissed");
      expect(String(byId[id].handled_note)).toMatch(/^D255 old email set aside: .*abandoned/);
      expect(byId[id].handled_by).toBe("staff-1");
    }
    expect(byId.m4.state).toBe("new");
    expect(byId.m5.state).toBe("new");
    const { mailBlocksStart } = await import("@/lib/compliance/ccrs-auto-upload-core");
    const left = db.ccrs_mail_messages.filter((m) => m.state === "new").map((m) => ({ id: String(m.id), env: m.env_verified ? (m.env as "preprod" | "prod") : null, kind: String(m.kind), subject: String(m.subject), receivedAt: String(m.received_at) }));
    // m4 is a real answer to a waiting file: it still blocks (Apply it), as it should.
    expect(mailBlocksStart(left, "preprod")).toContain("1 CCRS email(s)");
    db.ccrs_mail_messages = db.ccrs_mail_messages.filter((m) => m.id !== "m4");
    const left2 = left.filter((m) => m.id !== "m4");
    expect(mailBlocksStart(left2, "preprod")).toBeNull();
  });

  it("a second press does nothing more", async () => {
    const { setAsideStaleCcrsMail } = await import("@/lib/compliance/ccrs-stale-mail-store");
    await setAsideStaleCcrsMail(fakeAdmin as never, "preprod", "staff-1");
    const r = await setAsideStaleCcrsMail(fakeAdmin as never, "preprod", "staff-1");
    expect(r.setAside).toBe(0);
  });
});

describe("D255 wiring", () => {
  const SRC = (p: string) => readFileSync(p, "utf8");
  it("the action is permission-gated, audited and redirects with the result", () => {
    const a = SRC("src/app/admin/compliance/ccrs/mail-actions.ts");
    const body = a.slice(a.indexOf("export async function setAsideStaleCcrsMailAction"), a.indexOf("/** Not about a file this system made"));
    expect(body).toContain('requirePermission("settings.manage")');
    expect(body).toContain('action: "ccrs.mail.stale_set_aside"');
    expect(body).toContain("setAsideStaleCcrsMail(admin, page, session.profile.id)");
  });
  it("the hub passes the action and the panel shows the button", () => {
    expect(SRC("src/app/admin/compliance/ccrs/page.tsx")).toContain("setAsideStale: setAsideStaleCcrsMailAction,");
    const p = SRC("src/components/admin/compliance/CcrsMailPanel.tsx");
    expect(p).toContain('data-testid="ccrs-mail-stale"');
    expect(p).toContain("Set aside old emails");
  });
  it("the set-aside only touches a row still new (markCcrsMailHandled)", () => {
    expect(SRC("src/lib/compliance/ccrs-stale-mail-store.ts")).toContain('markCcrsMailHandled(admin, x.id, "dismissed", byProfileId, x.note)');
  });
});
