const { EVENT, BUILD, HIT, OWED, SHARDS } = process.env;
const cachedPullRequest =
  EVENT === "pull_request" && BUILD === "success" && HIT === "true" && OWED === "false";
if (SHARDS !== "success" && !(cachedPullRequest && SHARDS === "skipped")) {
  process.stderr.write(
    `iOS light shards ${SHARDS} on ${EVENT} (build ${BUILD}, cache hit ${HIT}, lane owed ${OWED})\n`,
  );
  process.exit(1);
}
