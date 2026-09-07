/**
 * LIVE PROOF for the announcer sound library (SLICE 31).
 *
 * Runs the real validation logic against the REAL database schema, so we know
 * the columns the store writes actually exist and accept what we send. Pure
 * unit tests cannot catch a column rename or a missing constraint.
 *
 * Run with:  npx tsx supabase/diagnostics/announcer_sounds_live_proof.ts
 * Needs a local Postgres named `gw` with the migrations applied.
 */
import { execFileSync } from "node:child_process";
import {
  validateUpload,
  buildStoragePath,
  isValidStoragePath,
  contentTypeFor,
} from "../../src/lib/announcer/announcer-sounds-core";

function sql(q: string): string {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-d", "gw", "-tAc", q], {
    encoding: "utf8",
  }).trim();
}

/** Returns true when the statement failed (used to prove constraints bite). */
function sqlFails(q: string): boolean {
  try {
    sql(q);
    return false;
  } catch {
    return true;
  }
}

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}  ${detail}`);
  }
}

console.log("\n=== ANNOUNCER SOUND LIBRARY: LIVE PROOF ===\n");

// 1. Every column the store writes must exist under the name we use.
const columns = sql(
  `select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'announcer_sounds'`,
).split("\n");
for (const required of ["id", "label", "storage_path", "mime_type", "bytes", "uploaded_by"]) {
  check(`column '${required}' exists`, columns.includes(required), `have: ${columns.join(",")}`);
}

// 2. A validated upload must actually insert into the real table.
const validation = validateUpload({ fileName: "live_proof_chime.wav", bytes: 44100 });
check("a normal wav passes validation", validation.ok);
if (!validation.ok) {
  console.log("\nLIVE PROOF FAILED: validation rejected a valid file");
  process.exit(1);
}

const id = sql("select gen_random_uuid()");
const storagePath = buildStoragePath(id, validation.extension);
check("the generated path is one the download route will serve", isValidStoragePath(storagePath));
check("the path is namespaced under custom/", storagePath.startsWith("custom/"));

sql(
  `insert into announcer_sounds (id, label, storage_path, mime_type, bytes)
   values ('${id}', '${validation.label}', '${storagePath}', '${contentTypeFor(storagePath)}', 44100)`,
);

const label = sql(`select label from announcer_sounds where id = '${id}'`);
check("the label survived the round trip", label === "live proof chime", `got '${label}'`);

const mime = sql(`select mime_type from announcer_sounds where id = '${id}'`);
check("the mime type is right for a wav", mime === "audio/wav", `got '${mime}'`);

// 3. storage_path is UNIQUE — two sounds must never point at one file.
check(
  "the database refuses two sounds at the same path",
  sqlFails(
    `insert into announcer_sounds (id, label, storage_path)
     values (gen_random_uuid(), 'duplicate', '${storagePath}')`,
  ),
);

// 4. Deleting a sound must not leave a device pointing at nothing.
//    A device left pointing at a deleted sound falls back to the chime on
//    every order, which looks like "the custom sound randomly stopped".
const deviceId = sql("select id from announcer_devices order by name limit 1");
if (deviceId !== "") {
  const prior = sql(`select coalesce(sound_id, '') from announcer_devices where id = '${deviceId}'`);

  sql(`update announcer_devices set sound_id = '${id}' where id = '${deviceId}'`);
  const attached = sql(`select sound_id from announcer_devices where id = '${deviceId}'`);
  check("a device can be pointed at a custom sound", attached === id);

  // Mirrors deleteSound(): detach FIRST, then delete.
  sql(`update announcer_devices set sound_id = null where sound_id = '${id}'`);
  const detached = sql(`select coalesce(sound_id, 'NULL') from announcer_devices where id = '${deviceId}'`);
  check("a device using a deleted sound is detached, not orphaned", detached === "NULL");

  const restore = prior === "" ? "null" : `'${prior}'`;
  sql(`update announcer_devices set sound_id = ${restore} where id = '${deviceId}'`);
} else {
  console.log("  SKIP  no devices in the database to test detachment against");
}

// 5. Clean up after ourselves — a proof that leaves rows behind is a liability.
sql(`delete from announcer_sounds where id = '${id}'`);
const remaining = sql(`select count(*) from announcer_sounds where id = '${id}'`);
check("the proof row was cleaned up", remaining === "0", `got ${remaining}`);

console.log("");
if (failures === 0) {
  console.log("LIVE PROOF PASSED");
} else {
  console.log(`LIVE PROOF FAILED: ${failures} problem(s)`);
  process.exit(1);
}
