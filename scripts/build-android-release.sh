#!/usr/bin/env bash
set -euo pipefail

out=$1
(
  cd packages/native/android
  ./gradlew --build-cache --configuration-cache --configuration-cache-problems=warn bundleRelease \
    -PreactNativeArchitectures=arm64-v8a,x86_64
  ./gradlew --build-cache --configuration-cache --configuration-cache-problems=warn assembleRelease \
    -PreactNativeArchitectures=arm64-v8a
)
mkdir -p "$out"
cp packages/native/android/app/build/outputs/bundle/release/app-release.aab "$out/"
cp packages/native/android/app/build/outputs/apk/release/app-release.apk "$out/tester-arm64-v8a.apk"
cp packages/native/android/app/debug.keystore "$out/"
