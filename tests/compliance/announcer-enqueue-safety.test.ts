/**
 * SLICE 29 — proving the doorbell cannot break the sale.
 *
 * announcer-enqueue.ts runs on the customer's checkout path. Its entire
 * contract is: never throw, never reject, never take the order down with it.
 *
 * A comment promising that is worth nothing. These tests make the database
 * fail in every way it realistically can — table missing, connection dead,
 * malformed rows, insert rejected, settings unreadable, a raw string thrown
 * from deep inside the client — and assert the promise still resolves and the
 * caller still gets a plain result object back.
 *
 * The Supabase admin client and the settings reader are mocked because the
 * point here is failure behaviour, not query correctness; query correctness is
 * proved live in supabase/diagnostics/announcer_fanout_live_proof.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockCreateAdmin = vi.fn();
const mockGetSettings = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockCreateAdmin(),
}));

vi.mock("@/lib/supabase/env", () => ({
  isSupabaseServiceConfigured: true,
}));

vi.mock("@/lib/announcer/announcer-store", () => ({
  getAnnouncerSettings: () => mockGetSettings(),
}));

const { enqueueAnnouncement, enqueueAnnouncementInBackground } = await import(
  "@/lib/announcer/announcer-enqueue"
);

const GOOD_SETTINGS = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
  default_sound_id: "chime",
  default_volume: 70,
};

const DEVICES = [
  { id: "d1", enabled: true, volume: null, sound_id: "chime", custom_sound_path: null },
  { id: "d2", enabled: true, volume: 50, sound_id: "bell", custom_sound_path: null },
];

/** Build a fake admin client whose behaviour per-table we control. */
function fakeAdmin(opts: {
  devices?: { data: unknown; error: unknown } | (() => never);
  insert?: { error: unknown } | (() => never);
  sounds?: { data: unknown; error: unknown };
}) {
  return {
    from(table: string) {
      if (table === "announcer_devices") {
        return {
          select: () => {
            if (typeof opts.devices === "function") return opts.devices();
            return Promise.resolve(opts.devices ?? { data: DEVICES, error: null });
          },
        };
      }
      if (table === "announcer_sounds") {
        return {
          select: () => ({
            in: () => Promise.resolve(opts.sounds ?? { data: [], error: null }),
          }),
        };
      }
      if (table === "announcer_queue") {
        return {
          insert: () => {
            if (typeof opts.insert === "function") return opts.insert();
            return Promise.resolve(opts.insert ?? { error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue(GOOD_SETTINGS);
});

describe("enqueue — the happy path still works", () => {
  it("queues one row per enabled speaker", async () => {
    mockCreateAdmin.mockReturnValue(fakeAdmin({}));
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1042" });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(2);
  });

  it("reports honestly when no speakers are paired", async () => {
    mockCreateAdmin.mockReturnValue(fakeAdmin({ devices: { data: [], error: null } }));
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(0);
    expect(result.summary).toContain("no speakers");
  });

  it("short-circuits when the shop switch is off", async () => {
    mockGetSettings.mockResolvedValue({ ...GOOD_SETTINGS, enabled: false });
    mockCreateAdmin.mockReturnValue(fakeAdmin({}));
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(0);
  });
});

describe("enqueue — every database failure is survived, not propagated", () => {
  it("survives the devices table being missing", async () => {
    mockCreateAdmin.mockReturnValue(
      fakeAdmin({
        devices: { data: null, error: { message: 'relation "announcer_devices" does not exist' } },
      }),
    );
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
    expect(result.queued).toBe(0);
    expect(result.summary).toContain("announcer");
  });

  it("survives the insert being rejected by a constraint", async () => {
    mockCreateAdmin.mockReturnValue(
      fakeAdmin({ insert: { error: { message: "violates check constraint" } } }),
    );
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
    expect(result.queued).toBe(0);
  });

  it("survives the select throwing outright (dead connection)", async () => {
    mockCreateAdmin.mockReturnValue(
      fakeAdmin({
        devices: () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    );
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
  });

  it("survives the insert throwing outright", async () => {
    mockCreateAdmin.mockReturnValue(
      fakeAdmin({
        insert: () => {
          throw new Error("socket hang up");
        },
      }),
    );
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
  });

  it("survives the client constructor itself throwing", async () => {
    mockCreateAdmin.mockImplementation(() => {
      throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");
    });
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
  });

  it("survives a non-Error being thrown", async () => {
    mockCreateAdmin.mockImplementation(() => {
      throw "just a string";
    });
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
    expect(typeof result.summary).toBe("string");
  });

  it("survives the settings reader rejecting", async () => {
    mockGetSettings.mockRejectedValue(new Error("settings unreachable"));
    mockCreateAdmin.mockReturnValue(fakeAdmin({}));
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(result.ok).toBe(false);
  });

  it("survives garbage where the device list should be", async () => {
    for (const junk of [null, undefined, "nope", 42, {}]) {
      mockCreateAdmin.mockReturnValue(fakeAdmin({ devices: { data: junk, error: null } }));
      const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
      expect(result.ok).toBe(true);
      expect(result.queued).toBe(0);
    }
  });

  it("survives malformed device rows without throwing", async () => {
    const hostile = [
      { id: "ok", enabled: true, volume: null, sound_id: null, custom_sound_path: null },
      { id: null, enabled: "yes", volume: "loud", sound_id: 7, custom_sound_path: [] },
      {},
    ];
    mockCreateAdmin.mockReturnValue(fakeAdmin({ devices: { data: hostile, error: null } }));
    const result = await enqueueAnnouncement({ orderId: "o1", orderNumber: "1" });
    expect(typeof result.ok).toBe("boolean");
  });

  it("NEVER rejects, across every failure mode at once", async () => {
    const modes = [
      () => fakeAdmin({ devices: { data: null, error: { message: "x" } } }),
      () => fakeAdmin({ insert: { error: { message: "y" } } }),
      () =>
        fakeAdmin({
          devices: () => {
            throw new Error("boom");
          },
        }),
      () => {
        throw new Error("constructor boom");
      },
    ];
    for (const mode of modes) {
      mockCreateAdmin.mockImplementation(mode);
      await expect(
        enqueueAnnouncement({ orderId: "o", orderNumber: "1" }),
      ).resolves.toBeDefined();
    }
  });
});

describe("enqueue — the fire-and-forget wrapper used by checkout", () => {
  it("returns undefined immediately and never throws", () => {
    mockCreateAdmin.mockImplementation(() => {
      throw new Error("everything is broken");
    });
    expect(() =>
      enqueueAnnouncementInBackground({ orderId: "o1", orderNumber: "1" }),
    ).not.toThrow();
  });

  it("produces no unhandled rejection when the world is on fire", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);

    mockCreateAdmin.mockImplementation(() => {
      throw new Error("total failure");
    });
    enqueueAnnouncementInBackground({ orderId: "o1", orderNumber: "1" });
    // Give the microtask queue a chance to surface a rejection.
    await new Promise((r) => setTimeout(r, 20));

    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toHaveLength(0);
  });

  it("is synchronous — checkout is never made to wait on it", () => {
    mockCreateAdmin.mockReturnValue(fakeAdmin({}));
    const started = Date.now();
    enqueueAnnouncementInBackground({ orderId: "o1", orderNumber: "1" });
    expect(Date.now() - started).toBeLessThan(50);
  });
});
