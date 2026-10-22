import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const EXTENSIONS = ["ts", "tsx", "css", "md", "mjs", "cjs", "js", "sh", "yml", "yaml"];
const braced = (glob: string | undefined) => glob?.match(/\{([^}]+)\}$/)?.[1]?.split(",") ?? [];

it("spell-checks code, scripts, shell and workflow files in check and at commit alike", () => {
  const config = JSON.parse(readFileSync(repositoryPath("cspell.json"), "utf8")) as {
    files: string[];
    enableGlobDot: boolean;
  };
  const hook = readFileSync(repositoryPath("lefthook.yml"), "utf8").match(
    /^ {4}cspell:\n {6}glob: "([^"]+)"$/m,
  )?.[1];
  const script = (
    JSON.parse(readFileSync(repositoryPath("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts["check:spell"];

  expect(config.files).toHaveLength(1);
  // Without it, the globs skip .github and .maestro.
  expect(config.enableGlobDot).toBe(true);
  expect(braced(config.files[0]).sort()).toEqual([...EXTENSIONS].sort());
  expect(braced(hook).sort()).toEqual([...EXTENSIONS].sort());
  expect(script).toBe("cspell --no-progress --no-summary");
});
