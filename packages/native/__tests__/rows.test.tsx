import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { HistoryEntry } from "@cue/core/domain/history";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { MenuView } from "@expo/ui/community/menu";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { Platform } from "react-native";
import { HistoryRow } from "../src/screens/history/HistoryRow";
import type { UpNextCard } from "../src/screens/up-next/model";
import { QueueRow } from "../src/screens/up-next/QueueRow";
import { TEST_IDS } from "../src/ui/test-ids";
import { DetailHarness, detail } from "./support/detail";
import { historyEntry } from "./support/history";
import { movieHeader, movieRuntime } from "./support/movie-detail";
import { router } from "./support/native-ui";
import { entry, fakeRuntime, Harness, resetSharedStores, spyHaptics } from "./support/up-next";

const mockParams: { current: Record<string, string> } = { current: {} };

jest.mock("expo-router", () => ({
  ...require("./support/native-ui").expoRouterModule(),
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ addListener: () => () => {} }),
  Redirect: () => null,
}));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: jest.fn(require("./support/native-ui").menuModule().MenuView),
}));
jest.mock("@expo/ui/jetpack-compose", () => require("./support/native-ui").composeModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const SHOW: LibraryEntry = entry({
  showId: detail.showId,
  title: "Midnight Cartography",
  aired: 10,
  completed: 8,
  nextEpisode: {
    season: detail.season,
    number: detail.number,
    title: detail.title,
    firstAired: detail.firstAired,
    still: null,
    ids: detail.ids,
  },
});
const CARD: UpNextCard = {
  item: {
    showId: SHOW.showId,
    title: SHOW.title,
    episode: SHOW.nextEpisode,
    lastWatchedAt: null,
    backlog: SHOW.aired - SHOW.completed,
  },
  entry: SHOW,
};
const EPISODE_PLAY: HistoryEntry = {
  ...historyEntry({ mediaId: detail.showId, title: "Midnight Cartography" }),
  type: "episode",
  season: detail.season,
  number: detail.number,
};
const MOVIE_PLAY = historyEntry({ mediaId: movieHeader.movieId, title: movieHeader.title });

function markSpy(): MarkWatched {
  return {
    mark: jest.fn(async () => {}),
    reverse: jest.fn(async () => {}),
    reArm: jest.fn(),
    justMarkedAt: () => null,
  };
}

const ROWS = {
  "queue row": () => <QueueRow card={CARD} mark={markSpy()} onStop={jest.fn()} />,
  "lapsed row": () => <QueueRow card={CARD} mark={markSpy()} onStop={jest.fn()} variant="lapsed" />,
  "history row": () => (
    <HistoryRow entry={EPISODE_PLAY} plays={1} index={0} width={370} onRemove={jest.fn()} />
  ),
} satisfies Record<string, () => ReactElement>;

async function paint(row: ReactElement): Promise<void> {
  await render(
    <Harness runtime={fakeRuntime({ entries: [SHOW] })} haptics={spyHaptics()}>
      {row}
    </Harness>,
  );
}

const body = (title = "Midnight Cartography") =>
  screen.getByRole("button", { name: new RegExp(`^${title}, `) });

beforeEach(() => {
  jest.clearAllMocks();
  resetSharedStores();
});

describe.each(Object.entries(ROWS))("a %s", (_name, row) => {
  it("carries the platform's row chrome and no check", async () => {
    await paint(row());

    const controls = screen.getAllByRole("button").filter((control) => control !== body());
    expect(controls.map((control) => control.props["accessibilityLabel"])).toEqual(
      Platform.OS === "ios" ? [] : ["More actions for Midnight Cartography"],
    );
    expect(screen.queryAllByRole("switch")).toEqual([]);
  });

  it("offers every menu item as a screen reader action, in the menu's order", async () => {
    await paint(row());

    const offered = jest
      .mocked(MenuView)
      .mock.calls.at(-1)?.[0]
      .actions.filter(
        ({ attributes }) => attributes?.hidden !== true && attributes?.disabled !== true,
      )
      .map(({ id }) => id);
    const actions = (body().props["accessibilityActions"] as { name: string }[]).map(
      ({ name }) => name,
    );
    expect(actions).toEqual(offered);
  });
});

describe.each(["queue", "lapsed"] as const)("a %s row's swipes", (variant) => {
  it("are its first menu items and screen reader actions, in swipe order", async () => {
    const mark = markSpy();
    const onStop = jest.fn();
    await paint(<QueueRow card={CARD} mark={mark} onStop={onStop} variant={variant} />);
    const id = `${variant}-row-${SHOW.showId}`;
    const effects = (): unknown[] => [
      jest.mocked(mark.mark).mock.calls.length,
      onStop.mock.calls.length,
    ];
    const swipes = [`${id}-drag-right`, `${id}-drag-left`];
    const actions = body().props["accessibilityActions"] as { name: string }[];
    const menu = within(screen.getByTestId(TEST_IDS.quickActions));

    for (const [index, swipe] of swipes.entries()) {
      jest.clearAllMocks();
      await fireEvent.press(screen.getByTestId(swipe));
      const bySwipe = effects();
      jest.clearAllMocks();
      await fireEvent.press(menu.getByTestId(actions[index]?.name ?? ""));
      expect(effects()).toEqual(bySwipe);
      jest.clearAllMocks();
      await fireEvent(body(), "accessibilityAction", {
        nativeEvent: { actionName: actions[index]?.name },
      });
      expect(effects()).toEqual(bySwipe);
      expect(bySwipe).toContain(1);
    }
  });
});

const appDir = join(__dirname, "../app");
const ROUTES = readdirSync(appDir, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".tsx") && !/(^|\/)(_layout|\+not-found)\.tsx$/.test(file))
  .map((file) => {
    const names: string[] = [];
    const segments = file
      .replace(/\.tsx$/, "")
      .split("/")
      .filter((segment) => !/^\(.*\)$/.test(segment) && segment !== "index")
      .map((segment) => {
        const param = /^\[(.+)\]$/.exec(segment)?.[1];
        if (param === undefined) return segment;
        names.push(param);
        return "([^/]+)";
      });
    return { file, names, pattern: new RegExp(`^/${segments.join("/")}$`) };
  });

function routeOf(href: string): ComponentType {
  const path = href
    .split("/")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/");
  const route = ROUTES.find(({ pattern }) => pattern.test(path));
  if (route === undefined) throw new Error(`No route answers ${href}`);
  const values = route.pattern.exec(path)?.slice(1) ?? [];
  mockParams.current = Object.fromEntries(
    route.names.map((name, index) => [name, values[index] ?? ""]),
  );
  return require(join(appDir, route.file)).default;
}

async function opened(row: ReactElement, title?: string): Promise<ComponentType> {
  await paint(row);
  await fireEvent.press(body(title));
  const href = router.push.mock.calls.at(-1)?.[0];
  await screen.unmount();
  return routeOf(String(href));
}

describe("every row leads to its control", () => {
  it("opens a queued show on the screen that marks its next episode", async () => {
    const Route = await opened(ROWS["queue row"]());
    await render(
      <DetailHarness>
        <Route />
      </DetailHarness>,
    );
    await act(async () => {});

    expect(
      await screen.findByRole("switch", {
        name: `Mark S${detail.season} E${detail.number} watched`,
      }),
    ).toBeOnTheScreen();
  });

  it("opens an episode play on the sheet that removes it", async () => {
    const Route = await opened(ROWS["history row"]());
    await render(
      <DetailHarness>
        <Route />
      </DetailHarness>,
    );

    expect(await screen.findByTestId(TEST_IDS.episodeCode)).toHaveTextContent(
      new RegExp(`^S${detail.season} E${detail.number} `),
    );
    expect(screen.getByTestId(TEST_IDS.episodeMarkControl)).toBeOnTheScreen();
  });

  it("opens a movie play on the screen that removes it", async () => {
    const Route = await opened(
      <HistoryRow entry={MOVIE_PLAY} plays={1} index={0} width={370} onRemove={jest.fn()} />,
      movieHeader.title,
    );
    await render(
      <Harness runtime={movieRuntime()} haptics={spyHaptics()}>
        <Route />
      </Harness>,
    );

    expect(await screen.findByTestId(TEST_IDS.movieMark)).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ checked: true }),
    );
  });
});
