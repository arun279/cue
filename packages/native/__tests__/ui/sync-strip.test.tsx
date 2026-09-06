import { render, screen, userEvent } from "@testing-library/react-native";
import { SyncStrip } from "../../src/ui/SyncStrip";
import { TEST_IDS } from "../../src/ui/test-ids";
import { TARGET_MIN } from "../../src/ui/tokens";

it("says offline in a sentence rather than leaving it to the dot", async () => {
  await render(<SyncStrip state="offline" />);

  expect(screen.getByTestId(TEST_IDS.syncStripOffline)).toHaveTextContent(
    "Offline. Your marks are saved.",
  );
});

it("names the rate limit as the more specific thing, and offers no Retry for it", async () => {
  await render(<SyncStrip state="rate-limited" />);

  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveTextContent(
    "Trakt is busy. Cue will retry shortly.",
  );
  // Retrying is what caused it.
  expect(screen.queryByRole("button")).toBeNull();
});

it("counts the backlog", async () => {
  await render(<SyncStrip state="pending" count={3} />);

  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveTextContent("3 marks pending · will sync");
});

it("offers Retry on the read error, at the target floor and inside a 32 pt band", async () => {
  const user = userEvent.setup();
  const onRetry = jest.fn();
  await render(<SyncStrip state="error" onRetry={onRetry} />);

  expect(screen.getByTestId(TEST_IDS.syncStripError)).toHaveTextContent(
    "Trakt unreachable. Showing your cached data.",
  );
  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveStyle({ height: 32 });
  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry).toHaveStyle({ minHeight: TARGET_MIN });

  await user.press(retry);

  expect(onRetry).toHaveBeenCalledTimes(1);
});
