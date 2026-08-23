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
# spelled, in any mode. config.ts is checked for the mode gate by the web
# package's privacy-claims test: that assertion is about intent, this one is
# about the artifact. VITE_TRAKT_CLIENT_ID is not usable as the same signal because
# Cue's own startup error names it, so it is in every build by design.
set -euo pipefail

stray_origin="http://127.0.0.1:8787"

VITE_TRAKT_API_BASE="$stray_origin" pnpm --filter @cue/web exec vite build "$@"

# The whole of dist, not just dist/assets: the service worker and its precache
# manifest are written at the root, and they are shipped files like any other.
refuse() {
  local carriers
  carriers=$(grep -rl "$1" packages/web/dist || true)
  [ -n "$carriers" ] || return 0
  echo "verify-bundle: $2" >&2
  echo "$carriers" >&2
  exit 1
}

refuse "VITE_TRAKT_API_BASE" \
  "packages/web/dist names a build variable, so the build inlined the whole import.meta.env object. Name each variable it reads in packages/web/src/app/config.ts."
refuse "$stray_origin" \
  "packages/web/dist carries $stray_origin, so this build took the local fake Trakt's origin outside the mock mode."

echo "verify-bundle: packages/web/dist names no build variable and carries no fake Trakt origin."
