import { expect, it } from "vitest";
import { findArtifactRun } from "../../.github/actions/find-ci-artifact/find.mjs";

type Run = { readonly conclusion: string | null; readonly jobs?: Record<string, string> };

const artifact = (runId: number, { fork = false, expired = false } = {}) => ({
  expired,
  workflow_run: { id: runId, repository_id: 1, head_repository_id: fork ? 2 : 1 },
});

function github(pages: ReturnType<typeof artifact>[][], runs: Record<number, Run>) {
  const listArtifactsForRepo = Symbol("listArtifactsForRepo");
  const listJobsForWorkflowRun = Symbol("listJobsForWorkflowRun");
  const asked: unknown[] = [];
  return {
    asked,
    client: {
      rest: {
        actions: {
          listArtifactsForRepo,
          listJobsForWorkflowRun,
          getWorkflowRun: async ({ run_id }: { run_id: number }) => ({
            data: { conclusion: runs[run_id]?.conclusion ?? null },
          }),
        },
      },
      paginate: Object.assign(
        async (method: symbol, { run_id }: { run_id: number }) => {
          expect(method).toBe(listJobsForWorkflowRun);
          return Object.entries(runs[run_id]?.jobs ?? {}).map(([name, conclusion]) => ({
            name,
            conclusion,
          }));
        },
        {
          iterator: (method: symbol, parameters: unknown) => {
            expect(method).toBe(listArtifactsForRepo);
            asked.push(parameters);
            return (async function* () {
              for (const data of pages) yield { data };
            })();
          },
        },
      ),
    },
  };
}

const find = (pages: ReturnType<typeof artifact>[][], runs: Record<number, Run>) => {
  const { client, asked } = github(pages, runs);
  return {
    asked,
    run: findArtifactRun(client, { owner: "o", repo: "cue" }, "cue-native-ios-abc", "native-ios"),
  };
};

it("asks for the artifact by name and takes the newest run that passed", async () => {
  const { run, asked } = find([[artifact(30), artifact(20)]], {
    30: { conclusion: "success" },
    20: { conclusion: "success" },
  });

  expect(await run).toBe(30);
  expect(asked).toEqual([{ owner: "o", repo: "cue", name: "cue-native-ios-abc", per_page: 100 }]);
});

it("skips forks' and expired artifacts, across pages", async () => {
  const { run } = find(
    [[artifact(40, { fork: true }), artifact(35, { expired: true })], [artifact(30)]],
    {
      40: { conclusion: "success" },
      35: { conclusion: "success" },
      30: { conclusion: "success" },
    },
  );

  expect(await run).toBe(30);
});

it("takes a run that has not passed when the job that uploads the artifact did", async () => {
  const { run } = find([[artifact(50), artifact(40)]], {
    50: { conclusion: "failure", jobs: { "native-ios": "failure", check: "success" } },
    40: { conclusion: null, jobs: { "native-ios": "success", "native-e2e": "failure" } },
  });

  expect(await run).toBe(40);
});

it("finds nothing when no candidate qualifies", async () => {
  const { run } = find([[artifact(40, { fork: true }), artifact(30)]], {
    40: { conclusion: "success" },
    30: { conclusion: "cancelled", jobs: { "native-ios": "cancelled" } },
  });

  expect(await run).toBeNull();
});
