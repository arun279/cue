import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { TEST_IDS } from "../src/ui/test-ids";
import { ROW_MIN_HEIGHT } from "../src/ui/tokens";
import "./support/screen-mocks";
import {
  agesAgo,
  entry,
  fakeRuntime,
  Harness,
  resetSharedStores,
  spyHaptics,
} from "./support/up-next";

jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));

/** Renders of a row that was already on screen, by test id: what memoization keeps at zero. */
const mockRerenders = new Map<string, number>();
jest.mock("../src/ui/Row", () => {
  const { useRef } = require("react") as typeof import("react");
  const actual = jest.requireActual<typeof import("../src/ui/Row")>("../src/ui/Row");
  return {
    ...actual,
    Row: (props: Parameters<typeof actual.Row>[0]) => {
      const mounted = useRef(false);
      const key = props.testID ?? "";
      if (mounted.current) mockRerenders.set(key, (mockRerenders.get(key) ?? 0) + 1);
      mounted.current = true;
      return actual.Row(props);
    },
  };
});

const UpNext = (require("../app/(tabs)/(up-next)") as typeof import("../app/(tabs)/(up-next)"))
  .default;

const haptics = spyHaptics();
const VIEWPORT = { width: 390, height: 844 };
const ROW_HEIGHT = ROW_MIN_HEIGHT.queue;
const QUEUED = 5;

beforeEach(() => {
  jest.useFakeTimers();
  mockRerenders.clear();
  resetSharedStores();
});
afterEach(() => jest.useRealTimers());

function account(lapsed: number): LibraryEntry[] {
  const queued = Array.from({ length: QUEUED }, (_, i) =>
    entry({ showId: 10_000 + i, title: `Queued ${i}`, lastWatchedAt: agesAgo(1 + i) }),
  );
  const idle = Array.from({ length: lapsed }, (_, i) =>
    entry({
      showId: 20_000 + i,
      title: `Idle ${i}`,
      aired: 10,
      completed: 2,
      lastWatchedAt: agesAgo(60 + i),
      nextEpisode: {
        season: 1,
        number: 3,
        title: "Cold Frame",
        firstAired: agesAgo(50),
        still: null,
        ids: { trakt: 30_000 + i },
      },
    }),
  );
  return [...queued, ...idle];
}

const rows = (prefix: "queue" | "lapsed") =>
  screen.queryAllByTestId(new RegExp(`^${prefix}-row-\\d+$`));

type Node = ReturnType<typeof rows>[number];

/** The list cell holding a row: the nearest ancestor that reports its own layout. */
function cellOf(row: Node): Node | null {
  let node = row.parent;
  while (node !== null && node.props["onLayout"] === undefined) node = node.parent;
  return node;
}

/** Lays the list out the way a device does, until it stops mounting rows. */
async function layOut(total: number): Promise<void> {
  const list = screen.getByTestId(TEST_IDS.upNextList);
  await fireEvent(list, "layout", { nativeEvent: { layout: { x: 0, y: 0, ...VIEWPORT } } });
  await fireEvent(list, "contentSizeChange", VIEWPORT.width, total * ROW_HEIGHT);
  let mounted = -1;
  while (mounted !== rows("queue").length + rows("lapsed").length) {
    mounted = rows("queue").length + rows("lapsed").length;
    const cells = [...new Set([...rows("queue"), ...rows("lapsed")].map(cellOf))];
    for (const [index, cell] of cells.entries()) {
      if (cell === null) continue;
      await fireEvent(cell, "layout", {
        nativeEvent: {
          layout: { x: 0, y: index * ROW_HEIGHT, width: VIEWPORT.width, height: ROW_HEIGHT },
        },
      });
    }
    await act(async () => jest.advanceTimersByTime(300));
  }
}

interface Opened {
  readonly lapsedRows: number;
  readonly rerenderedOnOpen: readonly string[];
}

// Artwork reads hold, so a row renders only for what the list and the section do to it.
const loadShowInfo = (): Promise<never> => new Promise(() => undefined);

async function openLapsed(lapsed: number): Promise<Opened> {
  await render(
    <Harness
      runtime={{ ...fakeRuntime({ entries: account(lapsed) }), loadShowInfo }}
      haptics={haptics}
    >
      <UpNext />
    </Harness>,
  );
  await screen.findByTestId(TEST_IDS.lapsedDrawerToggle);
  await layOut(QUEUED + 1);
  mockRerenders.clear();

  await fireEvent.press(screen.getByTestId(TEST_IDS.lapsedDrawerToggle));
  await layOut(QUEUED + 1 + lapsed);

  const opened = { lapsedRows: rows("lapsed").length, rerenderedOnOpen: [...mockRerenders.keys()] };
  await cleanup();
  return opened;
}

it("mounts the lapsed rows its render window holds, not every idle show, when the section opens", async () => {
  const large = await openLapsed(120);
  const larger = await openLapsed(240);

  expect(larger.lapsedRows).toBe(large.lapsedRows);
  expect(large.lapsedRows).toBeLessThan(120);
});

it("renders no row that is already on screen again when the section opens", async () => {
  const opened = await openLapsed(120);

  expect(opened.rerenderedOnOpen).toEqual([]);
});
