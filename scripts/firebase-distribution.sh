#!/usr/bin/env bash
# Usage: firebase-distribution.sh <build-number>
#
# Gives the release with that build number to the Firebase group `friends`.
# https://firebase.google.com/docs/reference/app-distribution/rest
set -euo pipefail

: "${FIREBASE_PROJECT:?FIREBASE_PROJECT is required}"
: "${FIREBASE_APP:?FIREBASE_APP is required}"
: "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS is required}"
build=${1:?usage: firebase-distribution.sh <build-number>}

gcloud auth activate-service-account --key-file "$GOOGLE_APPLICATION_CREDENTIALS" --quiet
token=$(gcloud auth print-access-token)
api() {
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" "$@"
}

release=$(api "https://firebaseappdistribution.googleapis.com/v1/projects/$FIREBASE_PROJECT/apps/$FIREBASE_APP/releases?pageSize=100" |
  jq -r --arg build "$build" '[.releases[]? | select(.buildVersion == $build)][0].name // empty')
if [ -z "$release" ]; then
  echo "firebase-distribution: no release among the latest 100 has build $build." >&2
  exit 1
fi
api -X POST -d '{"groupAliases": ["friends"]}' \
  "https://firebaseappdistribution.googleapis.com/v1/$release:distribute" > /dev/null
echo "firebase-distribution: build $build is in the friends group."
