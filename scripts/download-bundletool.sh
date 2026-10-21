#!/usr/bin/env bash
set -euo pipefail

jar=$1
version=1.18.3
sha256=a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
if echo "$sha256  $jar" | sha256sum -c - >/dev/null 2>&1; then
  exit 0
fi
curl --fail --location --output "$jar" \
  "https://github.com/google/bundletool/releases/download/$version/bundletool-all-$version.jar"
echo "$sha256  $jar" | sha256sum -c -
