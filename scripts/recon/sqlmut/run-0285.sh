#!/bin/bash
# SQL mutation check for 0285: each line of 0285.txt is old|new; every mutant must make ccrs-transfer-0285-pg-check.sql fail. Needs 0285 applied to $PGURL.
# Not listed (equivalent mutant): dropping `where coalesce(u.id, '') <> ''` - a blank id matches no ledger row and no file row, so the answer cannot change.
cd "$(git rev-parse --show-toplevel)"
F=supabase/migrations/0285_ccrs_inventory_transfer.sql
cp $F /tmp/orig.sql
PGURL=${PGURL:-postgres://postgres:postgres@localhost:5432/greenway}
i=0
while IFS='|' read -r old new; do
  i=$((i+1))
  python3 - "$old" "$new" <<'PY'
import sys
p='supabase/migrations/0285_ccrs_inventory_transfer.sql'
s=open(p).read(); o,n=sys.argv[1],sys.argv[2]
assert s.count(o)>=1, "anchor missing: "+o
open(p,'w').write(s.replace(o,n,1))
PY
  if psql $PGURL -q -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-transfer-0285-pg-check.sql >/tmp/m.log 2>&1 && grep -q "CHECK PASSED" /tmp/m.log; then echo "SURVIVED $i: $old"; else echo "killed $i"; fi
  cp /tmp/orig.sql $F
done < scripts/recon/sqlmut/0285.txt
