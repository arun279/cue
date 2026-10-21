import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";
import { readWorkflowJobs } from "../support/workflow-jobs";

const JAR = "bundletool bytes\n";
const SCRIPT = readFileSync(repositoryPath("scripts/download-bundletool.sh"), "utf8");
const PINNED = SCRIPT.match(/^sha256=([0-9a-f]{64})$/m)?.[1] ?? "";

const bin = mkdtempSync(path.join(tmpdir(), "cue-bundletool-bin-"));
afterAll(() => rmSync(bin, { recursive: true }));
writeFileSync(
  path.join(bin, "curl"),
  '#!/bin/sh\necho "$*" >> "$CALLS"\nwhile [ "$1" != --output ]; do shift; done\nprintf "%s" "$BODY" > "$2"\nexit "$CURL_STATUS"\n',
  { mode: 0o755 },
);

/** The script with its pinned checksum swapped for the fixture jar's. */
function download({
  existing,
  body = JAR,
  status = 0,
}: {
  existing?: string;
  body?: string;
  status?: number;
}) {
  const directory = tempDirectory("cue-bundletool-");
  const script = path.join(directory, "download-bundletool.sh");
  const sha256 = createHash("sha256").update(JAR).digest("hex");
  writeFileSync(script, SCRIPT.replace(PINNED, sha256));
  const jar = path.join(directory, "bundletool.jar");
  if (existing !== undefined) writeFileSync(jar, existing);
  const calls = path.join(directory, "calls");
  const result = spawnSync("bash", [script, jar], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      CALLS: calls,
      BODY: body,
      CURL_STATUS: String(status),
    },
  });
  return {
    ...result,
    downloads: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [],
  };
}

it("uses a restored jar that matches the pinned checksum without downloading", () => {
  const result = download({ existing: JAR });

  expect(result.status, result.stderr).toBe(0);
  expect(result.downloads).toEqual([]);
});

it.each([
  ["no jar was restored", undefined],
  ["the restored jar is not the pinned one", "tampered\n"],
])("downloads the pinned release when %s", (_, existing) => {
  const result = download({ existing });

  expect(result.status, result.stderr).toBe(0);
  expect(result.downloads).toEqual([
    expect.stringMatching(
      /https:\/\/github\.com\/google\/bundletool\/releases\/download\/1\.18\.3\/bundletool-all-1\.18\.3\.jar$/,
    ),
  ]);
});

it("fails when the download fails or does not match the pinned checksum", () => {
  expect(download({ status: 22 }).status).not.toBe(0);
  expect(download({ body: "other\n" }).status).not.toBe(0);
});

it("restores bundletool from a cache keyed by the pinned script before each download", () => {
  const jobs = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml")).filter(({ body }) =>
    body.includes("scripts/download-bundletool.sh"),
  );

  expect(jobs.map(({ name }) => name).sort()).toEqual(["footprint-base", "native-android"]);
  for (const { body } of jobs) {
    expect(body).toContain(
      "        with:\n" +
        "          path: $" +
        "{{ runner.temp }}/bundletool.jar\n" +
        "          key: bundletool-$" +
        "{{ hashFiles('scripts/download-bundletool.sh') }}\n" +
        "      - name: Download bundletool\n",
    );
    expect(body).not.toContain("restore-keys");
  }
});
