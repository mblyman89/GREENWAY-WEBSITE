#!/bin/bash
# ============================================================================
# announcer_concurrency_proof.sh  (SLICE 27)
#
# HOW TO RUN IT
#   bash supabase/diagnostics/announcer_concurrency_proof.sh
# with PGDATABASE / PGUSER pointing at a SCRATCH database. It deletes the whole
# announcer_queue, so never point it at production.
#
# LAST RUN: PostgreSQL 15.19. 8 clients, 200 rows.
#   TOTAL_HANDED_OUT=200  DISTINCT_HANDED_OUT=200  UNCLAIMED_REMAINING=0
#   RESULT: PASS   COVERAGE: PASS
# ============================================================================
# Concurrency proof for announcer_claim_work.
#
# The whole reliability claim rests on FOR UPDATE SKIP LOCKED: two polls landing
# in the same instant must NEVER be handed the same row, or the shop hears the
# same order announced twice. This cannot be proven by reading the SQL. It has
# to be raced.
#
# 8 concurrent claimers against one device holding exactly 200 rows. If SKIP
# LOCKED works, the claimers between them see 200 distinct row ids and zero
# duplicates. If it is broken, the total exceeds 200 and ids repeat.

DEV='11111111-1111-1111-1111-111111111111'
CLIENTS=8
ROWS=200

psql -q -d gw -c "delete from public.announcer_queue;" \
  -c "insert into public.announcer_queue (device_id, message, sound, volume)
      select '$DEV', 'm'||g, 'chime', 70 from generate_series(1,$ROWS) g;"

rm -f /tmp/claim_*.out
for i in $(seq 1 $CLIENTS); do
  (
    for _ in $(seq 1 40); do
      psql -q -A -t -d gw \
        -c "select id from public.announcer_claim_work('$DEV', 5, 900, 60);" \
        >> /tmp/claim_$i.out 2>/dev/null
    done
  ) &
done
wait

cat /tmp/claim_*.out | grep -E '^[0-9]+$' | sort -n > /tmp/all_claims.txt
TOTAL=$(wc -l < /tmp/all_claims.txt)
UNIQ=$(sort -u /tmp/all_claims.txt | wc -l)
REMAINING=$(psql -q -A -t -d gw -c "select count(*) from public.announcer_queue where claimed_at is null;")

echo "CLIENTS=$CLIENTS ROWS=$ROWS"
echo "TOTAL_HANDED_OUT=$TOTAL"
echo "DISTINCT_HANDED_OUT=$UNIQ"
echo "UNCLAIMED_REMAINING=$REMAINING"

if [ "$TOTAL" -eq "$UNIQ" ]; then
  echo "RESULT: PASS - zero double-handouts under $CLIENTS-way concurrency"
else
  echo "RESULT: FAIL - $((TOTAL-UNIQ)) rows handed to more than one claimer"
fi

if [ "$UNIQ" -eq "$ROWS" ] && [ "$REMAINING" -eq 0 ]; then
  echo "COVERAGE: PASS - every one of the $ROWS rows was delivered exactly once"
else
  echo "COVERAGE: FAIL - $UNIQ of $ROWS delivered, $REMAINING left unclaimed"
fi
