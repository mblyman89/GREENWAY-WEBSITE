#!/usr/bin/env bash
cd "$(dirname "$0")/../../.."
# Low-memory (~4GB) full vitest run in 8 shards, one at a time. Run in background:
#   nohup bash scripts/ccrs-bible/lowmem/vitest-8-shards.sh >/dev/null 2>&1 &
# then poll /tmp/shards.out until it says DONE.
: > /tmp/shards.out
for i in 1 2 3 4 5 6 7 8; do
  NODE_OPTIONS=--max-old-space-size=2500 timeout 2400 npx vitest run --shard=$i/8 --reporter=dot > /tmp/shard$i.log 2>&1
  echo "SHARD $i EXIT $?" >> /tmp/shards.out
  grep -E "Test Files|Tests " /tmp/shard$i.log | sed 's/\x1b\[[0-9;]*m//g' >> /tmp/shards.out
done
echo DONE >> /tmp/shards.out
