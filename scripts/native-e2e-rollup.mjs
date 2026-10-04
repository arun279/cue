const { EVENT, BUILD, HIT, OWED, USER_FACING, SHARDS } = process.env;
const cachedPullRequest =
  EVENT === "pull_request" &&
  BUILD === "success" &&
  HIT === "true" &&
  OWED === "false" &&
  USER_FACING !== "true";
if (SHARDS !== "success" && !(cachedPullRequest && SHARDS === "skipped")) {
  process.stderr.write(
    `iOS light shards ${SHARDS} on ${EVENT} (build ${BUILD}, cache hit ${HIT}, lane owed ${OWED}, user-facing ${USER_FACING || "false"})\n`,
  );
  process.exit(1);
}
