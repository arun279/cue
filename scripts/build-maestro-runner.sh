#!/usr/bin/env bash
set -euo pipefail

tag=cli-2.10.0
sha256=d20a6ec332c441c8d76101d4bb7e8e4c45d4ffb4487a8a64ac2c07ed24c9684d
cd "$(dirname "$0")/.."
patches=(patches/maestro-runner/*.patch)

patched_source() {
  mkdir -p "$1"
  curl -fsSL "https://github.com/mobile-dev-inc/Maestro/archive/refs/tags/$tag.tar.gz" -o "$1.tar.gz"
  echo "$sha256  $1.tar.gz" | shasum -a 256 -c -
  tar -xzf "$1.tar.gz" -C "$1" --strip-components 1
  rm "$1.tar.gz"
  for patch in "${patches[@]}"; do
    git -C "$1" apply "$PWD/$patch"
  done
}

case ${1-} in
  key)
    xcode=$(xcodebuild -version | tr -s '\n ' '-')
    inputs=$(shasum -a 256 scripts/build-maestro-runner.sh "${patches[@]}" | shasum -a 256)
    echo "maestro-runner-${xcode}${tag}-${inputs%% *}"
    ;;
  source)
    patched_source "$2"
    ;;
  build)
    work=$(mktemp -d)
    patched_source "$work/source"
    xcodebuild build-for-testing \
      -project "$work/source/maestro-ios-xctest-runner/maestro-driver-ios.xcodeproj" \
      -scheme maestro-driver-ios \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$work/derived" \
      ARCHS=arm64
    products="$work/derived/Build/Products"
    mv "$products"/*.xctestrun "$products/maestro-driver-ios.xctestrun"
    mkdir -p "$2"
    tar -czf "$2/maestro-runner.tgz" -C "$products" .
    rm -rf "$work"
    ;;
  *)
    echo "Usage: $0 key | source <directory> | build <directory>" >&2
    exit 64
    ;;
esac
