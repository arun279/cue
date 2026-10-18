import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "../support/git-env";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const executable = (directory: string, name: string, source: string) =>
  writeFileSync(path.join(directory, name), source, { mode: 0o755 });

describe("build-maestro-runner.sh", () => {
  const layout = (patches: Record<string, string>) => {
    const root = tempDirectory("cue-runner-build-");
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "patches/maestro-runner"), { recursive: true });
    mkdirSync(path.join(root, "bin"));
    cpSync(
      repositoryPath("scripts/build-maestro-runner.sh"),
      path.join(root, "scripts/build-maestro-runner.sh"),
    );
    for (const [name, patch] of Object.entries(patches)) {
      writeFileSync(path.join(root, "patches/maestro-runner", name), patch);
    }
    executable(root, "bin/xcodebuild", '#!/bin/sh\nprintf "%s\\n" "$XCODE_VERSION"\n');
    return root;
  };
  const run = (root: string, ...args: string[]) =>
    spawnSync("bash", [path.join(root, "scripts/build-maestro-runner.sh"), ...args], {
      encoding: "utf8",
      env: {
        ...gitEnv(),
        PATH: `${root}/bin:${process.env["PATH"]}`,
        XCODE_VERSION: "Xcode 26.6\nBuild version 17F42",
      },
    });
  const realPatches = () =>
    Object.fromEntries(
      ["0001-keep-serving-after-xctest-issues.patch", "0002-lead-in-touch-paths.patch"].map(
        (name) => [name, readFileSync(repositoryPath("patches/maestro-runner", name), "utf8")],
      ),
    );
  const key = (root: string) => {
    const result = run(root, "key");
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it("keys the build on Xcode, the tag, every patch and the script itself", () => {
    const root = layout(realPatches());
    const original = key(root);
    const script = path.join(root, "scripts/build-maestro-runner.sh");
    const patch = path.join(root, "patches/maestro-runner/0002-lead-in-touch-paths.patch");

    expect(original).toMatch(
      /^maestro-runner-Xcode-26\.6-Build-version-17F42-cli-2\.10\.0-[a-f0-9]{64}$/,
    );
    expect(key(root)).toBe(original);
    writeFileSync(patch, `${readFileSync(patch, "utf8")} `);
    const patched = key(root);
    expect(patched).not.toBe(original);
    writeFileSync(path.join(root, "patches/maestro-runner/0003-more.patch"), "");
    const added = key(root);
    expect(added).not.toBe(patched);
    writeFileSync(script, `${readFileSync(script, "utf8")}\n`);
    expect(key(root)).not.toBe(added);
    const xcode = spawnSync("bash", [script, "key"], {
      encoding: "utf8",
      env: { ...gitEnv(), PATH: `${root}/bin:${process.env["PATH"]}`, XCODE_VERSION: "Xcode 26.7" },
    });
    expect(xcode.stdout).toMatch(/^maestro-runner-Xcode-26\.7-cli-2\.10\.0-/);
  });

  const upstream = (root: string, content: string) => {
    const tree = path.join(root, "upstream/Maestro-cli-2.10.0");
    mkdirSync(tree, { recursive: true });
    writeFileSync(path.join(tree, "runner.swift"), content);
    const tarball = path.join(root, "upstream.tar.gz");
    spawnSync("tar", ["-czf", tarball, "-C", path.join(root, "upstream"), "Maestro-cli-2.10.0"]);
    executable(
      root,
      "bin/curl",
      `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp "${tarball}" "$2"; shift; done\n`,
    );
    return createHash("sha256").update(readFileSync(tarball)).digest("hex");
  };
  const pin = (root: string, sha256: string) => {
    const script = path.join(root, "scripts/build-maestro-runner.sh");
    writeFileSync(
      script,
      readFileSync(script, "utf8").replace(/^sha256=[a-f0-9]{64}$/m, `sha256=${sha256}`),
    );
  };
  const edit = (from: string, to: string) =>
    `--- a/runner.swift\n+++ b/runner.swift\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

  it("applies every patch in order to the pinned source", () => {
    const root = layout({
      "0001-first.patch": edit("one", "two"),
      "0002-second.patch": edit("two", "three"),
    });
    pin(root, upstream(root, "one\n"));

    const result = run(root, "source", path.join(root, "source"));

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(root, "source/runner.swift"), "utf8")).toBe("three\n");
    expect(existsSync(path.join(root, "source.tar.gz"))).toBe(false);
  });

  it("refuses a source tarball that does not match the pinned checksum", () => {
    const root = layout({ "0001-first.patch": edit("one", "two") });
    upstream(root, "one\n");

    const result = run(root, "source", path.join(root, "source"));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("did NOT match");
    expect(existsSync(path.join(root, "source/runner.swift"))).toBe(false);
  });

  it("fails when a patch no longer applies to the source", () => {
    const root = layout({
      "0001-first.patch": edit("one", "two"),
      "0002-second.patch": edit("one", "three"),
    });
    pin(root, upstream(root, "one\n"));

    const result = run(root, "source", path.join(root, "source"));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("patch failed");
  });

  it("refuses an unknown command", () => {
    expect(run(layout({}), "deploy").status).toBe(64);
  });
});
