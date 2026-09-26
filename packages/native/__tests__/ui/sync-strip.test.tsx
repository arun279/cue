import { type SyncBanner, syncBanner } from "@cue/core/sync-contract";
import { render, screen, userEvent } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { SyncStrip } from "../../src/ui/SyncStrip";
import { TEST_IDS } from "../../src/ui/test-ids";
import { TARGET_MIN } from "../../src/ui/tokens";

const NOW = 1_700_000_000_000;

/** Through the contract rather than hand-written, so a test can never assert a
 * line the app does not ship. */
function bannerOf(overrides: Partial<Parameters<typeof syncBanner>[0]>): SyncBanner {
  const banner = syncBanner({
    offline: false,
    failure: null,
    retrying: false,
    hasData: true,
    resumeReadsAt: 0,
    pending: 0,
    pendingLate: false,
    now: NOW,
    ...overrides,
  });
  if (banner === null) throw new Error("that input is the healthy state, which draws no strip");
  return banner;
}

it("says offline in a sentence rather than leaving it to the dot", async () => {
  await render(<SyncStrip banner={bannerOf({ offline: true })} onRetry={jest.fn()} />);

  expect(screen.getByTestId(TEST_IDS.syncStripOffline)).toHaveTextContent(
    "Offline. Your marks are saved.",
  );
});

it("announces its line politely rather than asserting it over what is being read", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  await render(<SyncStrip banner={bannerOf({ offline: true })} onRetry={jest.fn()} />);

  // The strip is ambient, not a control. Android has a live region for that;
  // iOS has only the imperative announcement, and the same hook owes both.
  if (Platform.OS === "android") {
    expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveProp("accessibilityLiveRegion", "polite");
  } else {
    expect(announce).toHaveBeenCalledWith("Offline. Your marks are saved.");
  }
});

it("counts a rate limit down, and offers no Retry for it", async () => {
  await render(
    <SyncStrip banner={bannerOf({ resumeReadsAt: NOW + 42_000 })} onRetry={jest.fn()} />,
  );

  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveTextContent(
    "Trakt is limiting requests. Retrying in 42s.",
  );
  // Retrying is what caused it.
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps a blip the app is still chasing out of the outage line, and out of Retry", async () => {
  await render(
    <SyncStrip
      banner={bannerOf({ failure: { kind: "network" }, retrying: true })}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveTextContent(
    "Couldn't refresh from Trakt. Retrying…",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("counts the backlog", async () => {
  await render(
    <SyncStrip banner={bannerOf({ pending: 3, pendingLate: true })} onRetry={jest.fn()} />,
  );

  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveTextContent("3 marks pending · will sync");
});

it("names the failure kind rather than blaming the connection for Trakt's fault", async () => {
  await render(
    <SyncStrip
      banner={bannerOf({ failure: { kind: "server", status: 503 } })}
      onRetry={jest.fn()}
    />,
  );

  expect(screen.getByTestId(TEST_IDS.syncStripError)).toHaveTextContent(
    "Trakt is having trouble. Showing your cached data.",
  );
});

it("grows for a long line instead of truncating it, and keeps Retry at the target floor", async () => {
  const user = userEvent.setup();
  const onRetry = jest.fn();
  await render(<SyncStrip banner={bannerOf({ failure: { kind: "network" } })} onRetry={onRetry} />);

  const message = screen.getByTestId(TEST_IDS.syncStripError);
  expect(message).toHaveTextContent("Can't reach Trakt. Showing your cached data.");
  // The whole point: the band has a floor and no ceiling, and nothing clamps the
  // line, so the longest contract string wraps rather than losing its second half.
  expect(message).not.toHaveProp("numberOfLines");
  expect(screen.getByTestId(TEST_IDS.syncStrip)).toHaveStyle({ minHeight: 32 });
  expect(screen.getByTestId(TEST_IDS.syncStrip)).not.toHaveStyle({ height: 32 });

  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry).toHaveStyle({ minHeight: TARGET_MIN });

  await user.press(retry);

  expect(onRetry).toHaveBeenCalledTimes(1);
});
