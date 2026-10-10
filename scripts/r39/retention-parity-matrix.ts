// scripts/r39/retention-parity-matrix.ts (R39 S2). Runs 840 retention cases
// (leap days, legal hold, still-in-effect, both anchors, -2..+2 days) through
// BOTH retentionVerdict() and SQL ach_retention_may_dispose() and requires
// zero mismatches. Needs a local Postgres with 0258 applied (DB r39).
//   npx tsx scripts/r39/retention-parity-matrix.ts
import { retentionVerdict, addCalendarDays } from "../../src/lib/payments/ach-authorization-core";
import { execFileSync } from "node:child_process";
const rows: string[] = []; const exp: boolean[] = [];
const bases = ["2024-02-29","2028-02-29","2026-01-01","2026-12-31","2027-03-01","2025-06-15"];
for (const s of bases) for (const e of bases) { if (e < s) continue;
  for (const off of [-2,-1,0,1,2]) for (const hold of [false,true]) {
    for (const endedNull of [false,true]) {
      const ended = endedNull ? null : e;
      const anchor = (ended ?? e).replace(/^(\d{4})/, (y)=>String(+y+6));
      // probe around both the ended+6 and signed+6 dates
      for (const a of [anchor, s.replace(/^(\d{4})/, (y)=>String(+y+6))]) {
        let today: string; try { today = addCalendarDays(a.endsWith("02-29") ? a.replace("02-29","02-28") : a, off); } catch { continue; }
        const v = retentionVerdict({ signedOn: s, endedOn: ended, legalHold: hold, today });
        exp.push(v.kind === "may_dispose");
        rows.push(`('${s}'::date, ${ended ? `'${ended}'::date` : "null::date"}, ${hold}, '${today}'::date)`);
      }
    }
  }
}
const sql = `select string_agg(case when public.ach_retention_may_dispose(a,b,c,d) then 't' else 'f' end, '' order by n) from (values ${rows.map((r,i)=>r.replace(/^\(/, `(${i},`)).join(",")}) v(n,a,b,c,d);`;
const out = execFileSync("psql", ["-h","localhost","-U","postgres","-d","r39","-Atc",sql], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
let bad = 0; exp.forEach((x,i)=>{ if ((out[i]==="t") !== x) { bad++; if (bad<5) console.log("MISMATCH", rows[i], "core", x, "sql", out[i]); } });
console.log(`cases=${exp.length} disposable=${exp.filter(Boolean).length} mismatches=${bad}`);
if (bad > 0 || exp.length < 500 || !exp.some(Boolean) || exp.every(Boolean)) process.exit(1);
