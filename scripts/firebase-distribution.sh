#!/usr/bin/env bash
# Usage: firebase-distribution.sh owner-group <tester-email>
#        firebase-distribution.sh promote <build-number>
#
# owner-group creates the Firebase group `owner` if it is missing and keeps the
# tester in it. promote gives the release with that build number to `friends`.
# https://firebase.google.com/docs/reference/app-distribution/rest
set -euo pipefail

: "${FIREBASE_PROJECT:?FIREBASE_PROJECT is required}"
: "${FIREBASE_APP:?FIREBASE_APP is required}"
: "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS is required}"

usage="usage: firebase-distribution.sh owner-group <tester-email> | promote <build-number>"
command=${1:?$usage}
argument=${2:?$usage}

gcloud auth activate-service-account --key-file "$GOOGLE_APPLICATION_CREDENTIALS" --quiet
token=$(gcloud auth print-access-token)
base="https://firebaseappdistribution.googleapis.com/v1/projects/$FIREBASE_PROJECT"
api() {
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" "$@"
}

case "$command" in
  owner-group)
    status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
      -H "Authorization: Bearer $token" "$base/groups/owner")
    if [ "$status" = 404 ]; then
      api -X POST -d '{"displayName": "Owner"}' "$base/groups?groupId=owner" > /dev/null
    fi
    jq -n --arg email "$argument" '{emails: [$email], createMissingTesters: true}' |
      api -X POST -d @- "$base/groups/owner:batchJoin" > /dev/null
    ;;
  promote)
    release=$(api "$base/apps/$FIREBASE_APP/releases?pageSize=100" |
      jq -r --arg build "$argument" '[.releases[]? | select(.buildVersion == $build)][0].name // empty')
    if [ -z "$release" ]; then
      echo "firebase-distribution: no release among the latest 100 has build $argument." >&2
      exit 1
    fi
    api -X POST -d '{"groupAliases": ["friends"]}' \
      "https://firebaseappdistribution.googleapis.com/v1/$release:distribute" > /dev/null
    echo "firebase-distribution: build $argument is in the friends group."
    ;;
  *)
    echo "$usage" >&2
    exit 1
    ;;
esac
