import type { ShowInfo } from "@cue/core/data/trakt/show-detail";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { TEST_IDS } from "../src/ui/test-ids";
import "./support/screen-mocks";
import { largeLibrary } from "./support/large-library";
import { LINK_MENU, MENU_HOST } from "./support/native-ui";
import { fakeRuntime, Harness, spyHaptics } from "./support/up-next";

const Library = (
  require("../app/(tabs)/(library)/library") as typeof import("../app/(tabs)/(library)/library")
).default;

const haptics = spyHaptics();

const posterRenders = { count: 0 };
jest.mock("../src/ui/Poster", () => {
  const actual = jest.requireActual<typeof import("../src/ui/Poster")>("../src/ui/Poster");
  return {
    ...actual,
    Poster: (props: Parameters<typeof actual.Poster>[0]) => {
      posterRenders.count += 1;
      return actual.Poster(props);
    },
  };
});
const VIEWPORT = { width: 390, height: 844 };
const ROW_HEIGHT = 220;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const tiles = () => screen.queryAllByTestId(/^show-card-/);

type Node = ReturnType<typeof tiles>[number];

/** The list cell holding a tile: the nearest ancestor that reports its own layout. */
function cellOf(tile: Node): Node | null {
  let node = tile.parent;
  while (node !== null && node.props["onLayout"] === undefined) node = node.parent;
  return node;
}

/**
 * Lays the list out the way a device does: a viewport, a content height, and a
 * fixed height for every row it has mounted, until the list stops mounting rows.
 */
async function scrollViewport(titles: number): Promise<void> {
  const grid = screen.getByTestId(TEST_IDS.libraryGrid);
  await fireEvent(grid, "layout", { nativeEvent: { layout: { x: 0, y: 0, ...VIEWPORT } } });
  await fireEvent(grid, "contentSizeChange", VIEWPORT.width, Math.ceil(titles / 3) * ROW_HEIGHT);
  let mounted = -1;
  while (mounted !== tiles().length) {
    mounted = tiles().length;
    const cells = [...new Set(tiles().map(cellOf))];
    for (const [row, cell] of cells.entries()) {
      if (cell === null) continue;
      await fireEvent(cell, "layout", {
        nativeEvent: {
          layout: { x: 0, y: row * ROW_HEIGHT, width: VIEWPORT.width, height: ROW_HEIGHT },
        },
      });
    }
    await act(async () => jest.advanceTimersByTime(300));
  }
}

interface Mounted {
  readonly tiles: number;
  readonly menus: number;
  readonly hosts: number;
  readonly images: number;
  readonly artReads: number;
}

async function mount(titles: number, chip?: string): Promise<Mounted> {
  const loadShowInfo = jest.fn(
    (_showId: number): Promise<ShowInfo> => new Promise(() => undefined),
  );
  await render(
    <Harness
      runtime={{ ...fakeRuntime({ entries: largeLibrary(titles) }), loadShowInfo }}
      haptics={haptics}
    >
      <Library />
    </Harness>,
  );
  await screen.findAllByTestId(/^show-card-/);
  if (chip !== undefined) await fireEvent.press(screen.getByTestId(chip));
  await scrollViewport(titles / 2);
  const counts = {
    tiles: tiles().length,
    menus: screen.queryAllByTestId(LINK_MENU).length,
    hosts: screen.container.queryAll((node) => node.props["nativeID"] === MENU_HOST).length,
    images: screen.container.queryAll(
      (node) => node.type === "Image" && typeof node.props["source"]?.uri === "string",
    ).length,
    artReads: loadShowInfo.mock.calls.length,
  };
  await cleanup();
  return counts;
}

describe.each([
  ["Watching", undefined],
  ["Not started", TEST_IDS.libraryChipNotStarted],
])("the %s grid over a large library", (_, chip) => {
  it("mounts tiles, menus and artwork for its render window, not for every title", async () => {
    const large = await mount(600, chip);
    const larger = await mount(1200, chip);

    expect(larger).toEqual(large);
    expect(large.tiles).toBeLessThan(300);
    expect(large.menus).toBe(Platform.OS === "ios" ? large.tiles : 0);
    // The sort menu is a bar item, and no tile mounts a native menu host of its own.
    expect(large.hosts).toBe(0);
    expect(large.images + large.artReads).toBeLessThanOrEqual(large.tiles);
  });
});

it("re-renders no tile when the tab root re-renders, as it does on every tab switch", async () => {
  const runtime = fakeRuntime({ entries: largeLibrary(600) });
  const tree = () => (
    <Harness runtime={runtime} haptics={haptics}>
      <Library />
    </Harness>
  );
  const { rerender } = await render(tree());
  await screen.findAllByTestId(/^show-card-/);
  await scrollViewport(300);
  const settled = posterRenders.count;

  await rerender(tree());

  expect(posterRenders.count).toBe(settled);
});
