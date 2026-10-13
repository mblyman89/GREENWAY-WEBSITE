import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rollbackRehome } from "@/lib/inventory/cultivera-rehome-store";
(async () => { console.log("ROLLBACK", JSON.stringify(await rollbackRehome(createSupabaseAdminClient(), "5c2c0000-0000-4000-8000-00000000000a"))); })().catch((e) => console.log("THREW", e.message));
