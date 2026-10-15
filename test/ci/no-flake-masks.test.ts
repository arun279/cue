import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

const allowlist: string[] = [];
const masks = (source: string): string[] => {
  const text = source.replace(/^\s*#.*$/gm, "");
  const found = [
    [/\bretryTapIfNoChange["']?\s*:/, "retryTapIfNoChange"],
    [/\boptional["']?\s*:\s*true\b/, "optional assertion"],
    [/--retry(?:\b|=)/, "download retry"],
    [/(?:^|[;&|]|\bdo\s)\s*(?:\w+=\S+\s+)*sleep\s/m, "shell sleep"],
    [/\brepeat:[\s\S]*\brunFlow:/, "flow rerun"],
  ] as const;
  const violations: string[] = found.flatMap(([pattern, label]) =>
    [...text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))].map(() => label),
  );
  const invocation =
    /(?:^|[;&|]|\b(?:do|then)\s)\s*(?:if\s+!?\s*)?(?:maestro\s+(?:test\b|--device\b|"\$@")|(?:bash\s+)?scripts\/maestro-test\.sh\b)/gm;
  for (const block of text.split(/^ {2}[\w-]+:\s*$/m)) {
    if ([...block.matchAll(invocation)].length > 1) violations.push("Maestro rerun");
    for (const loop of block.matchAll(/\b(?:for|while|until)\s[^\n]*[\s\S]*?\bdone\b/g)) {
      if ([...loop[0].matchAll(invocation)].length > 0) violations.push("Maestro rerun");
    }
  }
  return violations;
};

it("keeps workflows, scripts and flows free of flake masks", () => {
  const violations = [".github", "scripts", ".maestro"].flatMap((directory) =>
    readdirSync(repositoryPath(directory), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(?:ya?ml|sh|[cm]?js)$/.test(file))
      .flatMap((file) => {
        const name = path.posix.join(directory, file);
        return masks(readFileSync(repositoryPath(name), "utf8")).map((mask) => `${name}:${mask}`);
      }),
  );
  expect(allowlist).toEqual([]);
  expect(violations).toEqual([]);
});

it.each([
  "retryTapIfNoChange: true",
  "optional: true",
  '"optional": true',
  "while true; do sleep 1; done",
  "curl --retry 3 URL",
  "while true; do\n  sleep 1\ndone",
  "repeat:\n  commands:\n    - runFlow: app.yaml",
  "maestro test app.yaml || maestro test app.yaml",
  "for i in 1 2; do\n bash scripts/maestro-test.sh test app.yaml\ndone",
])("detects a flake mask: %s", (source) => {
  expect(masks(source).length).toBeGreaterThan(0);
});
