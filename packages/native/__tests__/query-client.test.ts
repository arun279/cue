it("delivers the app's query updates before the next task", async () => {
  let delivered = false;
  jest.isolateModules(() => {
    require("../src/platform/query-persister");
    const { notifyManager } = require("@tanstack/react-query");
    notifyManager.schedule(() => {
      delivered = true;
    });
  });
  await Promise.resolve();
  expect(delivered).toBe(true);
});

it("stores a queue whose refresh failed as the last good queue", async () => {
  jest.useFakeTimers();
  const { queryClient, queryPersister, shouldDehydrateQuery } =
    require("../src/platform/query-persister") as typeof import("../src/platform/query-persister");
  const { dehydrate } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
  const { queryKeys } =
    require("@cue/core/data/query-keys") as typeof import("@cue/core/data/query-keys");
  const { bulkBacking } =
    require("./support/native-stores") as typeof import("./support/native-stores");
  const queue = { entries: [], isPartial: false };
  queryClient.setQueryData(queryKeys.library(), queue);
  await queryClient
    .fetchQuery({
      queryKey: queryKeys.library(),
      queryFn: () => Promise.reject(new Error("503")),
      retry: false,
      staleTime: 0,
    })
    .catch(() => undefined);
  expect(queryClient.getQueryState(queryKeys.library())?.status).toBe("error");

  await queryPersister.persistClient({
    timestamp: Date.now(),
    buster: "test",
    clientState: dehydrate(queryClient, { shouldDehydrateQuery }),
  });
  await jest.advanceTimersByTimeAsync(1_000);

  const stored = JSON.parse(String(bulkBacking.values.get("cue.query-cache")));
  expect(stored.clientState.queries).toEqual([
    expect.objectContaining({ state: expect.objectContaining({ status: "success", data: queue }) }),
  ]);
  jest.useRealTimers();
});
