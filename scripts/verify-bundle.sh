#!/usr/bin/env bash
# Usage: verify-bundle.sh [vite build arguments]
#
# What the built bundle actually carries. The build below runs with a stray
# VITE_TRAKT_API_BASE exported, which is the hazard this gate exists for: an
# `.env` line or a shell export left over from a mock session, present while a
# build for a real account is made. Neither that variable's name nor the fake
# Trakt's origin may survive into dist.
#
# The name is the load-bearing half. Vite replaces a named
# `import.meta.env.NAME` with that variable's own literal, and a read of the
# whole object with every VITE_ variable present at build time, so the name
# landing in dist is the signature of a whole-object read however that read is
# spelled, in any mode. src/app/config.ts is checked for the mode gate by
# test/privacy-claims.test.ts: that assertion is about intent, this one is about
# the artifact. VITE_TRAKT_CLIENT_ID is not usable as the same signal because
# Cue's own startup error names it, so it is in every build by design.
set -euo pipefail

stray_origin="http://127.0.0.1:8787"

VITE_TRAKT_API_BASE="$stray_origin" pnpm exec vite build "$@"

if grep -rq "VITE_TRAKT_API_BASE" dist/assets; then
  echo "verify-bundle: dist/assets names a build variable, so the build inlined the whole import.meta.env object. Name each variable it reads in src/app/config.ts." >&2
  grep -rl "VITE_TRAKT_API_BASE" dist/assets >&2
  exit 1
fi

if grep -rq "$stray_origin" dist/assets; then
  echo "verify-bundle: dist/assets carries $stray_origin, so this build took the local fake Trakt's origin outside the mock mode." >&2
  grep -rl "$stray_origin" dist/assets >&2
  exit 1
fi

echo "verify-bundle: dist/assets names no build variable and carries no fake Trakt origin."
