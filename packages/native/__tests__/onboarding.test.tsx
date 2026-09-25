import { createAuthStore } from "@cue/core/auth/create-auth-store";
import { type AuthState, AuthStoreProvider } from "@cue/core/auth/store";
import { HapticsProvider } from "@cue/core/ports/haptics";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { setStringAsync } from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import "./support/screen-mocks";
import { Onboarding } from "../src/screens/Onboarding";
import { spyHaptics } from "./support/up-next";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));

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

it("shows a connection error and lets the reader try again", async () => {
  const errorMessage = "Couldn't reach Trakt. Check your connection and try again.";
  const store = await paint({ connectStatus: "error", errorMessage });

  expect(screen.getByRole("alert")).toHaveTextContent(errorMessage);
  await fireEvent.press(screen.getByRole("button", { name: "Connect Trakt" }));
  expect(store.getState().connectWithDeviceCode).toHaveBeenCalledTimes(1);
});

it("names and opens the supplied activation URL and returns to idle when cancelled", async () => {
  await paint({ connectStatus: "connecting", deviceCode });

  expect(screen.getByRole("header", { name: "Enter this code on Trakt" })).toBeOnTheScreen();
  expect(within(screen.getByTestId("device-code-value")).getByText("AB12CD34")).toBeOnTheScreen();
  expect(screen.getByText("Waiting for you to approve in Trakt…")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("link", { name: "Enter it at trakt.test/activate" }));
  expect(openBrowserAsync).toHaveBeenCalledWith(deviceCode.verificationUrl);
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Connect Trakt" })).toBeEnabled();
  expect(screen.queryByText("AB12CD34")).toBeNull();
});

it("copies from the whole code card and confirms each tap for two seconds", async () => {
  jest.useFakeTimers();
  await paint({ connectStatus: "connecting", deviceCode });

  expect(screen.getByText("Tap to copy")).toBeOnTheScreen();
  const card = screen.getByRole("button", { name: "Copy code AB12CD34" });
  await fireEvent.press(card);
  expect(setStringAsync).toHaveBeenCalledWith("AB12CD34");
  expect(haptics.selection).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1000));
  await fireEvent.press(card);
  await act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText("Copied")).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByText("Tap to copy")).toBeOnTheScreen();
  expect(screen.queryByText("Copied")).toBeNull();
});
