import { renderHook } from "@testing-library/react-native";
import { router } from "expo-router";
import {
  listenForCommands,
  perform,
  useBootMark,
  usePerfCommand,
  usePerfScroll,
} from "../src/ui/perf-channel";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn() },
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }),
}));

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("runs a screen's registered action with the command's words, until the screen unmounts", async () => {
  const toggle = jest.fn();
  const hook = await renderHook(() => usePerfCommand("season:1", toggle));

  expect(perform("season:1 now")).toBe("ran season:1");
  expect(toggle).toHaveBeenCalledWith("now");

  await hook.unmount();
  expect(perform("season:1")).toBe("unknown season:1");
});

it("runs the latest action a screen rendered, not the one it first registered", async () => {
  const first = jest.fn();
  const latest = jest.fn();
  const hook = await renderHook(
    ({ run }: { readonly run: () => void }) => usePerfCommand("lapsed", run),
    { initialProps: { run: first } },
  );
  await hook.rerender({ run: latest });

  perform("lapsed");

  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  await hook.unmount();
});

it("navigates between tabs and pushes screens the way the app's own links do", () => {
  expect(perform("tab library")).toBe("ran tab");
  expect(perform("episode 8803 2 3")).toBe("ran episode");
  expect(perform("tab profile")).toBe("failed tab: Error: no tab profile");

  expect(router.navigate).toHaveBeenCalledWith("/library");
  expect(router.push).toHaveBeenCalledWith("/show/8803/episode/2/3");
});

it("scrolls a list down one window height at a time, three times, apart like flings", async () => {
  jest.useFakeTimers();
  const scrollTo = jest.fn();
  const hook = await renderHook(() => usePerfScroll("history", scrollTo));

  perform("scroll:history");
  jest.advanceTimersByTime(0);
  expect(scrollTo.mock.calls).toEqual([[874]]);
  jest.advanceTimersByTime(1400);

  expect(scrollTo.mock.calls).toEqual([[874], [1748], [2622]]);
  await hook.unmount();
});

it("reports the boot phases it reached, and React Native's own startup marks, when it first asks for a command", async () => {
  const fetches: string[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    fetches.push(String(url));
    return new Promise<Response>(() => {});
  });
  const now = jest.spyOn(performance, "now").mockReturnValue(120.4);
  await renderHook(() => {
    useBootMark("fonts");
    useBootMark("runtime", false);
  });
  now.mockReturnValue(940.2);
  Object.defineProperty(performance, "rnStartupTiming", {
    configurable: true,
    value: {
      startTime: 10.2,
      initializeRuntimeStart: null,
      executeJavaScriptBundleEntryPointStart: 55.7,
    },
  });

  listenForCommands();

  const query = new URL(fetches[0] ?? "").searchParams;
  expect(query.get("reply")).toBe("ready");
  expect(JSON.parse(query.get("boot") ?? "")).toEqual({
    bundleStart: 46,
    fonts: 110,
    ready: 930,
  });
});
