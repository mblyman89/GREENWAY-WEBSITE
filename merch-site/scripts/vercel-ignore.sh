#!/bin/bash
# Vercel "Ignored Build Step" for greenwaymerch.com (Root Directory = merch-site).
# Exit 0 = skip this build; any other exit = build.
#
# Why (owner report D235, MERCH_HEALTH_TOKEN "not accepted"): the old rule was
# `git diff --quiet HEAD^ HEAD -- .`, which looks only at the LAST commit of a
# push. Every merch PR is merged with a docs-only "PR number" commit on top, so
# the last commit never touched merch-site/ and every merch change since
# 2026-10-18 was skipped. The shop never got /api/health (M-2), so it answered
# 404 to every token, right or wrong.
#
# Now: compare with the commit of the last SUCCESSFUL deploy
# (VERCEL_GIT_PREVIOUS_SHA). When that is unknown or not in Vercel's shallow
# clone, build (safe default: a wasted build, never a missed one).
set -u
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$prev" ]; then
  echo "No previous deploy SHA: build."
  exit 1
fi
if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  echo "Previous deploy ${prev} is not in the clone: build."
  exit 1
fi
if git diff --quiet "$prev" HEAD -- .; then
  echo "No change in merch-site since ${prev}: skip."
  exit 0
fi
echo "merch-site changed since ${prev}: build."
exit 1
