/**
 * scripts/r41/probe-s5-utc-equivalence.ts - R41 S5 evidence for two EQUIVALENT
 * mutants left out of mutate-s5-deadline.py: using the UTC day instead of the
 * Pacific day in earliestEffectiveDate and in planAfternoonDeadlineReminders.
 * Every 15 minutes, Sep 2026 - Sep 2028: expect diffE 0 and diffA 0.
 *   npx tsx scripts/r41/probe-s5-utc-equivalence.ts
 */
import { earliestEffectiveDate, planAfternoonDeadlineReminders, latestUploadAndApproval } from "@/lib/payments/timberland-deadline-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import { addUsableDays } from "@/lib/payments/timberland-deadline-core";
// Exhaustive probe: every 15 minutes for 2 years, compare Pacific-day vs UTC-day variants.
const CREDIT=2;
function earliestUtc(now: Date){ const today=now.toISOString().slice(0,10); for(let i=0;i<40;i++){const e=addUsableDays(today,CREDIT+i); if(now.getTime()<latestUploadAndApproval(e).cutoffUtc.getTime()) return e;} throw 0; }
let diffE=0, diffA=0, n=0;
const files=(eff:string)=>[{id:"x",kind:"vendor",status:"released",filename:"f",effectiveDate:eff}];
for(let t=Date.parse("2026-09-01T00:00:00Z"); t<Date.parse("2028-09-01T00:00:00Z"); t+=15*60_000){
  const now=new Date(t); n++;
  const p=earliestEffectiveDate(now), u=earliestUtc(now);
  if(p!==u){diffE++; if(diffE<3) console.log("E",now.toISOString(),p,u);}
  // afternoon: the Pacific window must lie inside one UTC day
  const pd=pacificDayKey(now), ud=now.toISOString().slice(0,10);
  if(pd!==ud){ const eff=addUsableDays(pd,2); if(planAfternoonDeadlineReminders(now,files(eff)).length>0){diffA++;} }
}
console.log({n,diffE,diffA});
