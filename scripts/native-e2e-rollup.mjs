const { EVENT, DEVICES, HIT, OWED, USER_FACING, SHARDS } = process.env;
const cachedPullRequest =
  EVENT === "pull_request" && HIT === "true" && OWED === "false" && USER_FACING !== "true";
const skippedOnPurpose = DEVICES === "false" || cachedPullRequest;
if (SHARDS !== "success" && !(skippedOnPurpose && SHARDS === "skipped")) {
  process.stderr.write(
    `iOS light shards ${SHARDS} on ${EVENT} (device lanes ${DEVICES}, cached app ${HIT || "false"}, lane owed ${OWED}, user-facing ${USER_FACING || "false"})\n`,
  );
  process.exit(1);
}
