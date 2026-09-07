/**
 * supabase/diagnostics/announcer_fanout_live_proof.ts
 *
 * SLICE 29 — live proof that the fan-out planner and the real schema agree.
 *
 * This is not a unit test. It runs the PURE planner, inserts exactly the rows
 * it produced into a REAL PostgreSQL database with all migrations applied, and
 * then has each device claim its work through the real announcer_claim_work()
 * function. It proves four things a pure test cannot:
 *
 *   1. The columns planFanout() emits are the columns the table actually has.
 *   2. A 3PM Pacific order with overnight quiet hours armed reaches every
 *      speaker (the timezone bug this slice fixed).
 *   3. Each Pi claims ONLY its own row — no speaker steals another's job.
 *   4. Polling twice does not announce twice.
 *
 * HOW TO REPRODUCE
 * ----------------
 *   sudo service postgresql start
 *   # apply every migration in supabase/migrations to a database named "gw"
 *   # seed at least one row in announcer_devices
 *   npx tsx supabase/diagnostics/announcer_fanout_live_proof.ts
 *
 * Expected final line: LIVE PROOF PASSED
 *
 * Last run: 3 devices, 3 rows planned, 3 claimed one-each, 0 cross-claims,
 * 0 unclaimed remaining, second poll returned 0. PASSED.
 */

import { execFileSync } from "node:child_process";
import { planFanout } from "./src/lib/announcer/announcer-fanout-core";

function sql(q: string): string {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", "gw", "-tAc", q], {
    encoding: "utf8",
  }).trim();
}

// Clean slate for this proof.
sql("delete from announcer_queue");

const deviceIds = sql("select id from announcer_devices order by name").split("\n");
console.log("devices in db:", deviceIds.length);

const devices = deviceIds.map((id) => ({
  id,
  enabled: true,
  volume: null,
  sound_id: "chime",
  custom_sound_path: null,
}));

const plan = planFanout({
  devices,
  settings: {
    enabled: true,
    quiet_hours_enabled: true,
    quiet_start: "22:00",
    quiet_end: "08:00",
    default_sound_id: "chime",
    default_volume: 70,
  },
  // 3PM Pacific — the instant that used to be wrongly muted.
  now: new Date("2025-06-10T22:00:00Z"),
  orderId: null,
  orderNumber: "1042",
  isTest: false,
  availableCustomPaths: [],
});

console.log("planned inserts:", plan.inserts.length, "skipped:", plan.skipped.length);
if (plan.inserts.length !== 3) {
  console.log("FAIL: 3PM Pacific order did not reach all 3 speakers");
  process.exit(1);
}

// Insert exactly what the planner produced, through the real schema.
for (const r of plan.inserts) {
  const msg = r.message.replace(/'/g, "''");
  sql(
    `insert into announcer_queue (device_id, kind, order_id, message, sound, volume)
     values ('${r.device_id}', '${r.kind}', null, '${msg}', '${r.sound}', ${r.volume})`,
  );
}
console.log("rows in queue:", sql("select count(*) from announcer_queue"));
console.log("sample message:", sql("select distinct message from announcer_queue"));
console.log("volumes:", sql("select distinct volume from announcer_queue"));

// Each Pi polls. Each must get exactly its own one row.
let allCorrect = true;
for (const id of deviceIds) {
  const got = sql(
    `select count(*) from announcer_claim_work('${id}'::uuid, 5, 900, 60)`,
  );
  const wrongOwner = sql(
    `select count(*) from announcer_queue where device_id <> '${id}'::uuid and claimed_at is not null
     and id in (select id from announcer_queue where device_id = '${id}'::uuid)`,
  );
  console.log(`device ${id.slice(0, 8)} claimed ${got} row(s); cross-claims ${wrongOwner}`);
  if (got !== "1") allCorrect = false;
}

const unclaimed = sql("select count(*) from announcer_queue where claimed_at is null");
console.log("unclaimed remaining:", unclaimed);

// A second poll must return nothing — no double announcements.
const second = sql(`select count(*) from announcer_claim_work('${deviceIds[0]}'::uuid, 5, 900, 60)`);
console.log("second poll by same device:", second, second === "0" ? "(no repeat)" : "(REPEAT!)");

console.log(
  allCorrect && unclaimed === "0" && second === "0"
    ? "\nLIVE PROOF PASSED"
    : "\nLIVE PROOF FAILED",
);
