import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Profiler } from "react";
import { queryKeys } from "@/core/data/query-keys";
import type { UpNextData } from "@/core/runtime/runtime";
import { useSnackbar } from "@/core/stores/snackbar-store";
import { TEST_IDS } from "../src/ui/test-ids";
import {
  entry,
  fakeRuntime,
  Harness,
  resetSharedStores,
  seedCalendars,
  spyHaptics,
} from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());

const UpNext = (require("../app/(tabs)/(up-next)") as typeof import("../app/(tabs)/(up-next)"))
  .default;

afterEach(() => jest.useRealTimers());

it("commits Mark and Undo feedback without yielding to async work", async () => {
  jest.useFakeTimers({
    now: new Date("2026-10-14T12:00:00Z"),
    doNotFake: ["queueMicrotask", "nextTick", "setImmediate"],
  });
  resetSharedStores();
  const cached = entry();
  const submit = jest.fn(() => new Promise<never>(() => {}));
  const runtime = {
    ...fakeRuntime({ submit }),
    loadEpisodePlays: jest.fn(() => new Promise<never>(() => {})),
  };
  const commits = jest.fn();
  let client: QueryClient | undefined;
  const view = await render(
    <Profiler id="feedback" onRender={commits}>
      <Harness
        runtime={runtime}
        haptics={spyHaptics()}
        seed={(cache) => {
          client = cache;
          cache.setQueryData(queryKeys.library(), { entries: [cached], isPartial: false });
          seedCalendars(cache, runtime);
        }}
      >
        <UpNext />
      </Harness>
    </Profiler>,
  );
  const swipe = () => screen.getByTestId(`${TEST_IDS.queueRow(cached.showId)}-drag-right`);
  commits.mockClear();
  commits.mockImplementation(() => ({
    undo: screen.queryByTestId(TEST_IDS.snackbarUndo) !== null,
    original:
      screen.queryByLabelText("Harbor Lights, Aired last night, S3 E5, Salt Air, 3 left") !== null,
  }));
  const mark = fireEvent.press(swipe());
  expect(client?.getQueryData<UpNextData>(queryKeys.library())?.entries[0]?.completed).toBe(
    cached.completed + 1,
  );
  expect(useSnackbar.getState().snack?.actions?.[0]?.label).toBe("Undo");
  await mark;
  expect(screen.getByTestId(TEST_IDS.snackbarUndo)).toBeOnTheScreen();
  expect(commits.mock.results.map(({ value }) => value)).toEqual([{ undo: true, original: false }]);
  expect(submit).toHaveBeenCalledTimes(1);

  commits.mockClear();
  const undo = fireEvent.press(screen.getByTestId(TEST_IDS.snackbarUndo));
  expect(client?.getQueryData<UpNextData>(queryKeys.library())?.entries[0]).toEqual(cached);
  expect(useSnackbar.getState().snack).toBeNull();
  await undo;
  expect(screen.queryByTestId(TEST_IDS.snackbarUndo)).toBeNull();
  expect(commits.mock.results.map(({ value }) => value)).toEqual([
    { undo: false, original: false },
    { undo: false, original: true },
  ]);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(runtime.loadEpisodePlays).not.toHaveBeenCalled();
  await view.unmount();
});
