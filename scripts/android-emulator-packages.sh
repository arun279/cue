#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/android-emulator-packages.sh revisions | install <emulator-revision> <system-image-revision>'
image="system-images;android-35;default;x86_64"
sdkmanager=$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager

revision() {
  awk -F '|' -v section="$1" -v package="$2" '
    /^[A-Za-z].*:$/ { current = tolower($0) }
    current == section && /^ / {
      gsub(/^ +| +$/, "", $1)
      gsub(/^ +| +$/, "", $2)
      if ($1 == package) print $2
    }
  ' <<< "$3"
}

case ${1:-} in
  revisions)
    listing=$("$sdkmanager" --list --channel=0)
    emulator=$(revision "available packages:" emulator "$listing")
    system_image=$(revision "available packages:" "$image" "$listing")
    if [ -z "$emulator" ] || [ -z "$system_image" ]; then
      echo "::error::Google's SDK repository, read through sdkmanager --list, offers no emulator or $image." >&2
      exit 1
    fi
    echo "emulator=$emulator"
    echo "system-image=$system_image"
    ;;
  install)
    want_emulator=${2:?$usage}
    want_image=${3:?$usage}
    if ! "$sdkmanager" --install emulator "$image" --channel=0; then
      echo "::error::sdkmanager could not download and unpack the emulator and $image from Google's SDK repository." >&2
      exit 1
    fi
    listing=$("$sdkmanager" --list_installed)
    emulator=$(revision "installed packages:" emulator "$listing")
    system_image=$(revision "installed packages:" "$image" "$listing")
    if [ "$emulator" != "$want_emulator" ] || [ "$system_image" != "$want_image" ]; then
      echo "::error::sdkmanager installed emulator ${emulator:-nothing} and $image ${system_image:-nothing}, not the $want_emulator and $want_image this job resolved." >&2
      exit 1
    fi
    ;;
  *)
    echo "$usage" >&2
    exit 1
    ;;
esac
