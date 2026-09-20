import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { type AuthState, AuthStoreProvider } from "@cue/core/auth/store";
import { HapticsProvider } from "@cue/core/ports/haptics";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Clipboard, Linking, Platform } from "react-native";
import "./support/screen-mocks";
import { Onboarding } from "../src/screens/Onboarding";
import { spyHaptics } from "./support/up-next";

const haptics = spyHaptics();
const deviceCode = { userCode: "AB12CD34", verificationUrl: "https://trakt.test/activate" };

async function paint(state: Partial<AuthState> = {}) {
  const store = createAuthStore({
    crypto: { newId: jest.fn(), randomBytes: jest.fn(), digest: jest.fn() },
    tokenStore: { read: async () => null, write: jest.fn(), clear: jest.fn() },
    clientId: "test-client",
    redirectUri: "cue://auth/callback",
    redirect: jest.fn(),
    redirectHandoff: { read: () => null, write: jest.fn(), clear: jest.fn() },
    native: true,
    traktBaseUrl: undefined,
  });
  store.setState({
    phase: "onboarding",
    native: true,
    connectStatus: "idle",
    deviceCode: null,
    errorMessage: null,
    ...state,
    connectWithDeviceCode: jest.fn(async () => store.setState({ connectStatus: "connecting" })),
  });
  await render(
    <AuthStoreProvider value={store}>
      <HapticsProvider value={haptics}>
        <Onboarding />
      </HapticsProvider>
    </AuthStoreProvider>,
  );
  return store;
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it("offers one connect action and disables it while connecting", async () => {
  const store = await paint();

  expect(screen.getByRole("header", { name: "Cue" })).toBeOnTheScreen();
  expect(screen.getByText("Your shows. One tap ahead.")).toBeOnTheScreen();
  expect(
    screen.getByText("Powered by Trakt. Your data lives in your Trakt account."),
  ).toBeOnTheScreen();
  expect(screen.getAllByRole("button")).toHaveLength(1);

  await fireEvent.press(screen.getByRole("button", { name: "Connect Trakt" }));

  const connecting = screen.getByRole("button", { name: "Connecting…" });
  expect(connecting).toBeDisabled();
  await fireEvent.press(connecting);
  expect(store.getState().connectWithDeviceCode).toHaveBeenCalledTimes(1);
});

it("announces a connection error and lets the reader try again", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  const errorMessage = "Couldn't reach Trakt. Check your connection and try again.";
  const store = await paint({ connectStatus: "error", errorMessage });

  expect(screen.getByRole("alert")).toHaveTextContent(errorMessage);
  if (Platform.OS === "android") {
    expect(screen.getByRole("alert")).toHaveProp("accessibilityLiveRegion", "assertive");
  } else {
    expect(announce).toHaveBeenCalledWith(errorMessage);
  }
  await fireEvent.press(screen.getByRole("button", { name: "Connect Trakt" }));
  expect(store.getState().connectWithDeviceCode).toHaveBeenCalledTimes(1);
});

it("opens the supplied activation URL and returns to idle when cancelled", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  await paint({ connectStatus: "connecting", deviceCode });

  expect(screen.getByRole("header", { name: "Enter this code on Trakt" })).toBeOnTheScreen();
  expect(screen.getByTestId("device-code-value")).toHaveTextContent("AB12CD34");
  const waiting = screen.getByText("Waiting for you to approve in Trakt…");
  if (Platform.OS === "android") {
    expect(waiting).toHaveProp("accessibilityLiveRegion", "polite");
  } else {
    expect(announce).toHaveBeenCalledWith("Waiting for you to approve in Trakt…");
  }
  await fireEvent.press(screen.getByRole("link", { name: "Enter it at trakt.tv/activate" }));
  expect(open).toHaveBeenCalledWith(deviceCode.verificationUrl);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Connect Trakt" })).toBeEnabled();
  expect(screen.queryByText("AB12CD34")).toBeNull();
});

it("copies from the whole code card and confirms each tap for two seconds", async () => {
  jest.useFakeTimers();
  const copy = jest.spyOn(Clipboard, "setString").mockImplementation(() => {});
  await paint({ connectStatus: "connecting", deviceCode });

  expect(screen.getByText("Tap to copy")).toBeOnTheScreen();
  const card = screen.getByRole("button", { name: "Copy code AB12CD34" });
  await fireEvent.press(card);
  expect(copy).toHaveBeenCalledWith("AB12CD34");
  expect(haptics.selection).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1999));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  await fireEvent.press(card);
  await act(() => jest.advanceTimersByTime(1999));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.getByText("Tap to copy")).toBeOnTheScreen();
  expect(screen.queryByText("Copied")).toBeNull();
});

it("does not carry copy feedback into a new connection attempt", async () => {
  jest.useFakeTimers();
  jest.spyOn(Clipboard, "setString").mockImplementation(() => {});
  const store = await paint({ connectStatus: "connecting", deviceCode });
  await fireEvent.press(screen.getByRole("button", { name: "Copy code AB12CD34" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  await act(() => store.setState({ deviceCode }));

  expect(screen.getByText("Tap to copy")).toBeOnTheScreen();
  expect(screen.queryByText("Copied")).toBeNull();
});
