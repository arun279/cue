import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const artifact = (id: number, head_repository_id: number) => ({
  id,
  expired: false,
  workflow_run: { id: id * 10, repository_id: 1, head_repository_id },
});

function download(artifacts: ReturnType<typeof artifact>[]) {
  const directory = tempDirectory("cue-download-artifact-");
  const downloads = path.join(directory, "downloads");
  writeFileSync(path.join(directory, "artifacts.json"), JSON.stringify({ artifacts }));
  writeFileSync(
    path.join(directory, "gh"),
    `#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in --jq) filter=$2; shift ;; repos/*) url=$1 ;; esac
  shift
done
case "$url" in
  *"/artifacts?"*) jq -r "$filter" "$FIXTURE_DIR/artifacts.json" ;;
  */zip) echo "$url" >> "$FIXTURE_DIR/downloads" ;;
  */runs/*) echo success ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(directory, "unzip"), "#!/bin/sh\n", { mode: 0o755 });
  const result = spawnSync(
    "bash",
    [repositoryPath("scripts/download-ci-artifact.sh"), "native-ios", path.join(directory, "out")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        FIXTURE_DIR: directory,
        GITHUB_REPOSITORY: "owner/cue",
        RUNNER_TEMP: directory,
      },
    },
  );
  return {
    status: result.status,
    downloads: existsSync(downloads) ? readFileSync(downloads, "utf8").trim().split("\n") : [],
  };
}

it("skips an artifact from a fork's run and takes the next one from this repository", () => {
  expect(download([artifact(7, 2), artifact(8, 1)])).toEqual({
    status: 0,
    downloads: ["repos/owner/cue/actions/artifacts/8/zip"],
  });
});

it("downloads nothing when every candidate came from a fork", () => {
  expect(download([artifact(7, 2)])).toEqual({ status: 1, downloads: [] });
});
