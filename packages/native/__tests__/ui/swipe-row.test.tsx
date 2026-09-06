import { HapticsProvider } from "@cue/core/ports/haptics";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { SwipeRow } from "../../src/ui/SwipeRow";
import { SWIPE_COMMIT } from "../../src/ui/tokens";
import { drag } from "../support/native-ui";
import { spyHaptics } from "../support/up-next";

jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("../support/native-ui").swipeableModule(),
);

const haptics = spyHaptics();

function renderRow(onMark: (() => void) | undefined, onStop: () => void) {
  return render(
    <HapticsProvider value={haptics}>
      <SwipeRow testID="row" onMark={onMark} onStop={onStop}>
        <Text>Harbor Lights</Text>
      </SwipeRow>
    </HapticsProvider>,
  );
}

/**
 * Move the finger, which is what the reveal reads rather than any progress the
 * library reports: progress is relative to the panel's width and the commit
 * distance is stated in points. The frame advance is what runs the mapper the
 * reveal watches through; on a device that is the display link.
 */
async function dragTo(points: number): Promise<void> {
  await act(async () => {
    const translation = drag.translation;
    if (translation === null) throw new Error("no swipeable rendered");
    translation.value = points;
    jest.advanceTimersByTime(FRAME_MS);
  });
}

const FRAME_MS = 16;

/** The reveal is hidden from assistive technology on purpose: its meaning is
 * already in the row's own label and its check. So a test looks for it the way
 * an eye does rather than the way the rotor does. */
const reveal = (label: string) => screen.queryByText(label, { includeHiddenElements: true });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The gesture's own contract. The library's LEFT and RIGHT name opposite things
 * (a drag to the right opens the LEFT panel and reports RIGHT), so an inversion
 * here stops a show the reader meant to mark, and nothing else in the app would
 * catch it.
 */
describe("the queue row's swipe", () => {
  it("marks on a release past the threshold to the right", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMark = jest.fn();
    const onStop = jest.fn();
    await renderRow(onMark, onStop);

    await user.press(screen.getByTestId("row-drag-right"));

    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("stops on a release past the threshold to the left", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMark = jest.fn();
    const onStop = jest.fn();
    await renderRow(onMark, onStop);

    await user.press(screen.getByTestId("row-drag-left"));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onMark).not.toHaveBeenCalled();
  });

  it("locks both directions to the commit distance rather than the library's half-panel default", async () => {
    await renderRow(jest.fn(), jest.fn());

    expect(screen.getByTestId("row-drag-right")).toHaveAccessibleName(
      `drag row right past ${SWIPE_COMMIT}`,
    );
    expect(screen.getByTestId("row-drag-left")).toHaveAccessibleName(
      `drag row left past ${SWIPE_COMMIT}`,
    );
  });

  it("offers no mark reveal on a row with nothing left to mark", async () => {
    await renderRow(undefined, jest.fn());
    await dragTo(SWIPE_COMMIT);

    expect(reveal("Watched")).toBeNull();
    expect(haptics.thresholdActivate).not.toHaveBeenCalled();
  });

  it("warms the engine when the drag starts, so the threshold tick is not late", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderRow(jest.fn(), jest.fn());

    await user.press(screen.getByTestId("row-drag-right"));

    expect(haptics.prepare).toHaveBeenCalled();
  });
});

describe("the reveal's threshold", () => {
  it("arms visibly, and only once the drag is past the commit distance", async () => {
    await renderRow(jest.fn(), jest.fn());

    await dragTo(SWIPE_COMMIT - 1);
    expect(reveal("Watched")).toBeNull();
    expect(haptics.thresholdActivate).not.toHaveBeenCalled();

    await dragTo(SWIPE_COMMIT);
    expect(reveal("Watched")).not.toBeNull();
    expect(haptics.thresholdActivate).toHaveBeenCalledTimes(1);
  });

  it("disarms on the way back under, and ticks once each way rather than per frame", async () => {
    await renderRow(jest.fn(), jest.fn());

    await dragTo(SWIPE_COMMIT + 20);
    await dragTo(SWIPE_COMMIT + 30);
    expect(haptics.thresholdActivate).toHaveBeenCalledTimes(1);

    await dragTo(SWIPE_COMMIT - 10);
    expect(reveal("Watched")).toBeNull();
    expect(haptics.thresholdDeactivate).toHaveBeenCalledTimes(1);
  });

  it("arms the stop reveal on its own direction, so one drag never ticks twice", async () => {
    await renderRow(jest.fn(), jest.fn());

    await dragTo(-SWIPE_COMMIT);

    expect(reveal("Stop")).not.toBeNull();
    expect(reveal("Watched")).toBeNull();
    expect(haptics.thresholdActivate).toHaveBeenCalledTimes(1);
  });
});
