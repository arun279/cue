import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const WORKTREE = /git worktree add --detach "\$RUNNER_TEMP\/([\w-]+)"/;
const switchesTo = (step: string, tree: string) =>
  step.includes("uses: ./.github/actions/use-tree-node") && step.includes(`tree: ${tree}\n`);

/**
 * The problems with each job that checks out a second tree: a step that touches
 * that tree before the job has switched to the tree's own Node, or a step that
 * runs the head's pnpm while the second tree's Node is still on PATH.
 */
function secondTreeProblems(body: string): string[] {
  const steps = body.split(/^ {6}- /m);
  /** The first step after `from` that matches, or Infinity when none does. */
  const next = (from: number, matches: (step: string) => boolean) => {
    const index = steps.findIndex((step, at) => at > from && matches(step));
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return steps.flatMap((step, added) => {
    const name = WORKTREE.exec(step)?.[1];
    if (name === undefined) return [];
    const touches = (later: string) => later.includes(`$RUNNER_TEMP/${name}`);
    const first = next(added, touches);
    const last = steps.findLastIndex(touches);
    const problems: string[] = [];
    if (next(added, (later) => switchesTo(later, `$` + `{{ runner.temp }}/${name}`)) > first) {
      problems.push(`${name} is used before the job takes its .nvmrc`);
    }
    const from = Math.max(added, last);
    const head = next(from, (later) => /^ {8}run: .*\bpnpm\b|^ {10}.*\bpnpm\b/m.test(later));
    if (head !== Number.POSITIVE_INFINITY && next(from, (later) => switchesTo(later, ".")) > head) {
      problems.push(`the head's pnpm runs on ${name}'s Node`);
    }
    return problems;
  });
}

it("installs and runs each second tree, such as the merge base, with that tree's own Node", () => {
  const jobs = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml"));
  const second = jobs.filter(({ body }) => WORKTREE.test(body));

  expect(second.map(({ name }) => name).sort()).toEqual(["footprint-base", "render-performance"]);
  expect(
    second.flatMap(({ name, body }) => secondTreeProblems(body).map((p) => `${name}: ${p}`)),
  ).toEqual([]);
});

it("checks out second trees only in workflow steps, where that rule can see them", () => {
  const scripts = readdirSync(repositoryPath("scripts"), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(?:sh|mjs)$/.test(file))
    .filter((file) =>
      readFileSync(path.join(repositoryPath("scripts"), file), "utf8").includes("git worktree add"),
    );

  expect(scripts).toEqual([]);
});

const job = (...steps: string[]) =>
  `    steps:\n${steps.map((step) => `      - ${step}`).join("")}`;
const add =
  'name: Check out the base\n        run: git worktree add --detach "$RUNNER_TEMP/base" "$SHA"\n';
const use = (tree: string) =>
  `uses: ./.github/actions/use-tree-node\n        with:\n          tree: ${tree}\n`;
const install =
  'name: Measure the base\n        run: pnpm --dir "$RUNNER_TEMP/base" install --frozen-lockfile\n';
const head = "name: Measure the head\n        run: pnpm --dir packages/native perf:render\n";
const base = "$" + "{{ runner.temp }}/base";

it.each([
  ["switches to the second tree's Node and back", [add, use(base), install, use("."), head], []],
  [
    "installs the second tree on the head's Node",
    [add, install, head],
    ["base is used before the job takes its .nvmrc", "the head's pnpm runs on base's Node"],
  ],
  [
    "switches only after installing",
    [add, install, use(base), use("."), head],
    ["base is used before the job takes its .nvmrc"],
  ],
  [
    "never switches back for the head",
    [add, use(base), install, head],
    ["the head's pnpm runs on base's Node"],
  ],
])("finds a job that %s", (_, steps, problems) => {
  expect(secondTreeProblems(job(...steps))).toEqual(problems);
});
