import { libraryQuery } from "@cue/core/queries/library";
import type { QueryClient } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Profiler, type ReactElement } from "react";
import { Platform } from "react-native";
import { largeLibrary } from "./support/large-library";
import { seedCalendars } from "./support/perf-up-next";
import { fakeRuntime, Harness, spyHaptics } from "./support/up-next";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../src/platform/stores", () => require("./support/native-ui").preferenceStorageModule());
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);

const TABS = [
  ["(up-next)", "index"],
  ["(library)", "library"],
  ["(calendar)", "calendar"],
  ["(search)", "search"],
] as const;

const entries = largeLibrary(100);
const haptics = spyHaptics();
const commits: string[] = [];
const idle: (() => void)[] = [];

function route<T>(path: string): T {
  return (require(`../app/(tabs)/${path}`) as { default: T }).default;
}

function profiled(tab: string, screenFile: string): () => ReactElement {
  const Screen = route<() => ReactElement>(`${tab}/${screenFile}`);
  return function ProfiledTabScreen(): ReactElement {
    return (
      <Profiler id={tab} onRender={(id, phase) => commits.push(`${id} ${phase}`)}>
        <Screen />
      </Profiler>
    );
  };
}

/** The four tabs over a seeded library; `calendarLoads` false leaves the calendar read in flight. */
async function paintTabs(calendarLoads = true) {
  // expo-router's testing mocks replace Reanimated with a stand-in that lacks this hook.
  const reanimated = require("react-native-reanimated");
  reanimated.useReducedMotion ??= () => false;
  const runtime = {
    ...fakeRuntime({ entries }),
    ...(calendarLoads ? null : { loadCalendar: () => new Promise<never>(() => {}) }),
  };
  const seed = (client: QueryClient): void => {
    client.setQueryData(libraryQuery(runtime).queryKey, { entries });
    if (calendarLoads) seedCalendars(client, runtime);
  };
  const TabsLayout = route<() => ReactElement>("_layout");
  await renderRouter({
    "(tabs)/_layout": () => (
      <Harness runtime={runtime} haptics={haptics} seed={seed}>
        <TabsLayout />
      </Harness>
    ),
    ...Object.fromEntries(
      TABS.flatMap(([tab, screenFile]) => [
        [`(tabs)/${tab}/_layout`, route(`${tab}/_layout`)],
        [`(tabs)/${tab}/${screenFile}`, profiled(tab, screenFile)],
      ]),
    ),
    ...Object.fromEntries(
      ["show/[showId]", "movie/[movieId]", "show/[showId]/episode/[season]/[episode]"].map(
        (path) => [`(tabs)/(up-next,library,calendar,search)/${path}`, () => null],
      ),
    ),
  });
  await act(async () => {});
}

const mounted = () =>
  TABS.filter(([tab]) => commits.some((commit) => commit.startsWith(`${tab} `))).map(
    ([tab]) => tab,
  );
const settle = () =>
  act(async () => {
    for (const callback of idle.splice(0)) callback();
  });

beforeEach(() => {
  commits.length = 0;
  idle.length = 0;
  jest.spyOn(globalThis, "requestIdleCallback").mockImplementation((callback) => {
    idle.push(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
    return idle.length;
  });
  jest.spyOn(globalThis, "cancelIdleCallback").mockImplementation((handle) => {
    idle[handle - 1] = () => {};
  });
});

afterEach(() => jest.restoreAllMocks());

// Android's header toolbar renders through Jetpack Compose, which this runner has no host for;
// the tab screens under test are the same code on both platforms.
const onIos = Platform.OS === "ios" ? it : it.skip;

onIos(
  "mounts only the opening tab, then every tab once launch settles, and re-renders none on a switch",
  async () => {
    await paintTabs();
    expect(mounted()).toEqual(["(up-next)"]);

    await settle();
    expect(mounted()).toEqual(TABS.map(([tab]) => tab));

    const host = () =>
      screen.container.queryAll((node) => node.props["onTabSelected"] !== undefined)[0];
    const keys = screen.container
      .queryAll((node) => typeof node.props["screenKey"] === "string")
      .map((node) => String(node.props["screenKey"]));
    commits.length = 0;
    let provenance = 0;
    for (const key of [...keys.slice(1), keys[0], ...keys.slice(1), keys[0]]) {
      provenance += 1;
      await act(async () =>
        host()?.props["onTabSelected"]({
          nativeEvent: { selectedScreenKey: key, provenance, actionOrigin: "user" },
        }),
      );
    }

    expect(host()?.props["navStateRequest"]?.selectedScreenKey).toBe(keys[0]);
    expect(commits).toEqual([]);
  },
  20_000,
);

onIos("waits for the opening tab's reads before it mounts any other tab", async () => {
  await paintTabs(false);
  await settle();

  expect(mounted()).toEqual(["(up-next)"]);
});
