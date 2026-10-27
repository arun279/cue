import { browseQuery } from "@cue/core/queries/discover";
import { libraryQuery } from "@cue/core/queries/library";
import type { BrowseData, CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Profiler, type ReactElement } from "react";
import { Platform } from "react-native";
import { largeLibrary } from "./support/large-library";
import { fakeRuntime, Harness, seedCalendars, spyHaptics } from "./support/up-next";

jest.mock("../src/platform/stores", () => require("./support/native-ui").preferenceStorageModule());
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
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

interface Paint {
  /** False leaves the calendar read in flight. */
  readonly calendarLoads?: boolean;
  /** Without it, Search's rails are already cached. */
  readonly loadBrowse?: CueRuntime["loadBrowse"];
}

const NO_RAILS: BrowseData = { trending: [], popular: [], trendingMovies: [], popularMovies: [] };

/** The four tabs over a seeded library. */
async function paintTabs({ calendarLoads = true, loadBrowse }: Paint = {}) {
  // expo-router's testing mocks replace Reanimated with a stand-in that lacks this hook.
  const reanimated = require("react-native-reanimated");
  reanimated.useReducedMotion ??= () => false;
  const runtime = {
    ...fakeRuntime({ entries }),
    ...(calendarLoads ? null : { loadCalendar: () => new Promise<never>(() => {}) }),
    ...(loadBrowse === undefined ? null : { loadBrowse }),
  };
  const seed = (client: QueryClient): void => {
    client.setQueryData(libraryQuery(runtime).queryKey, { entries });
    if (calendarLoads) seedCalendars(client, runtime);
    if (loadBrowse === undefined) client.setQueryData(browseQuery(runtime).queryKey, NO_RAILS);
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

const tabHost = () =>
  screen.container.queryAll((node) => node.props["onTabSelected"] !== undefined)[0];
const tabKeys = () =>
  screen.container
    .queryAll((node) => typeof node.props["screenKey"] === "string")
    .map((node) => String(node.props["screenKey"]));
let provenance = 0;
const selectTab = (key: string | undefined) =>
  act(async () => {
    provenance += 1;
    tabHost()?.props["onTabSelected"]({
      nativeEvent: { selectedScreenKey: key, provenance, actionOrigin: "user" },
    });
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
  "mounts only the opening tab, then every tab once launch settles, and re-renders none on a switch after Search's first visit",
  async () => {
    await paintTabs();
    expect(mounted()).toEqual(["(up-next)"]);

    await settle();
    expect(mounted()).toEqual(TABS.map(([tab]) => tab));

    const keys = tabKeys();
    const round = [...keys.slice(1), keys[0]];
    commits.length = 0;
    for (const key of round) await selectTab(key);
    // Search alone renders, once, on its first visit, to enable its browse rails.
    expect(commits).toEqual([expect.stringMatching(/^\(search\) /)]);

    commits.length = 0;
    for (const key of [...round, ...round]) await selectTab(key);

    expect(tabHost()?.props["navStateRequest"]?.selectedScreenKey).toBe(keys[0]);
    expect(commits).toEqual([]);
  },
  20_000,
);

onIos("waits for the opening tab's reads before it mounts any other tab", async () => {
  await paintTabs({ calendarLoads: false });
  await settle();

  expect(mounted()).toEqual(["(up-next)"]);
});

onIos(
  "loads Search's browse rails on its first visit, behind their skeleton, and keeps them on the next",
  async () => {
    let land: (data: BrowseData) => void = () => {};
    const loadBrowse = jest.fn(
      () =>
        new Promise<BrowseData>((resolve) => {
          land = resolve;
        }),
    );
    await paintTabs({ loadBrowse });
    await settle();
    expect(mounted()).toContain("(search)");
    expect(loadBrowse).not.toHaveBeenCalled();
    expect(screen.getByTestId("browse-skeleton")).toBeOnTheScreen();

    const [upNext, , , search] = tabKeys();
    await selectTab(search);
    expect(loadBrowse).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("browse-skeleton")).toBeOnTheScreen();

    await act(async () => land(NO_RAILS));
    await waitFor(() => expect(screen.queryByTestId("browse-skeleton")).toBeNull());

    await selectTab(upNext);
    await selectTab(search);
    expect(loadBrowse).toHaveBeenCalledTimes(1);
  },
);
