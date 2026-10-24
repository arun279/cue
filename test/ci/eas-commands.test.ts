import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

const WORKFLOWS = [".github/workflows/mobile-release.yml", ".github/workflows/publish-update.yml"];
// Values a script's own variables take, where the CLI checks them against a list.
const SCRIPTS = { "scripts/require-next-build.sh": { platform: "android" } };
const eas = repositoryPath("node_modules/.bin/eas");
const execFileAsync = promisify(execFile);

// Each `run:` block as the shell sees it: folded blocks become one line, and
// backslash continuations are joined.
const runBlocks = (workflow: string): string[] =>
  [...workflow.matchAll(/^( +)run: ([>|])-?\n((?:\1 .*\n|\n)*)/gm)].map(
    ([, , style, body = ""]) => {
      const lines = body.split("\n").map((line) => line.trim());
      return style === ">" ? lines.join(" ") : lines.join("\n").replaceAll("\\\n", " ");
    },
  );

const words = (command: string): string[] =>
  [...command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(
    ([, double, single, bare]) => double ?? single ?? bare ?? "",
  );

const easCommands = (shell: string, values: Record<string, string> = {}): string[][] =>
  [...shell.matchAll(/(?:^|[\s(])eas ((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^|)\n])+)/gm)]
    .map(([, rest = ""]) =>
      words(rest)
        .map((word) =>
          word.replace(/\$\{?(\w+)\}?/g, (variable, name: string) => values[name] ?? variable),
        )
        .map((word) => (word.includes("$") ? "placeholder" : word)),
    )
    .filter((args) => args.includes("--non-interactive"));

const commands = [
  ...WORKFLOWS.flatMap((file) =>
    runBlocks(readFileSync(repositoryPath(file), "utf8")).flatMap((shell) => easCommands(shell)),
  ),
  ...Object.entries(SCRIPTS).flatMap(([file, values]) =>
    easCommands(readFileSync(repositoryPath(file), "utf8"), values),
  ),
];

const signedOutRun = async (args: string[]): Promise<string> => {
  try {
    await execFileAsync(eas, args, {
      cwd: repositoryPath("packages/native"),
      env: {
        PATH: process.env["PATH"],
        HOME: tempDirectory("cue-eas-home-"),
        CI: "1",
        EXPO_NO_TELEMETRY: "1",
      },
    });
    return "";
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    return stdout + stderr;
  }
};

describe("EAS CLI commands in the release automation", () => {
  it("are run with the CLI version the repository tests against", () => {
    const manifest = JSON.parse(readFileSync(repositoryPath("package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const pins = WORKFLOWS.flatMap((file) => [
      ...readFileSync(repositoryPath(file), "utf8").matchAll(/eas-version: (\S+)/g),
    ]).map(([, version]) => version);

    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins)).toEqual(new Set([manifest.devDependencies["eas-cli"]]));
  });

  it("never send TestFlight notes through EAS Submit, which accepts them only on the Enterprise plan", () => {
    const submits = commands.filter(([command]) => command === "submit");

    expect(submits.length).toBeGreaterThan(0);
    for (const args of submits) {
      expect(args.join(" ")).not.toMatch(/--what-to-test|changelog/);
    }
  });

  it("pass every flag check the CLI makes before it asks for an account", {
    timeout: 120_000,
  }, async () => {
    expect(commands.map(([command]) => command)).toEqual(
      expect.arrayContaining(["build", "submit", "update", "update:republish", "env:exec"]),
    );
    const outputs = await Promise.all(commands.map(signedOutRun));

    for (const [index, output] of outputs.entries()) {
      expect(output, `eas ${commands[index]?.join(" ")}`).toMatch(
        /An Expo user account is required|Log in to EAS/,
      );
    }
  });
});
