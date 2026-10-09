import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import "./support/screen-mocks";
import Settings from "../src/screens/Settings";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture } from "./support/account";

const mockBuild: { channel: string | null; calls: unknown[][]; offline: boolean } = {
  channel: "production",
  calls: [],
  offline: false,
};

jest.mock("expo-updates", () => ({
  get channel() {
    return mockBuild.channel;
  },
  setUpdateRequestHeadersOverride: (headers: unknown) =>
    mockBuild.calls.push(["override", headers]),
  checkForUpdateAsync: async () => {
    mockBuild.calls.push(["check"]);
    if (mockBuild.offline) throw new Error("offline");
    return { isAvailable: true };
  },
  fetchUpdateAsync: async () => mockBuild.calls.push(["fetch"]),
  reloadAsync: async () => mockBuild.calls.push(["reload"]),
}));

beforeEach(() => {
  mockBuild.channel = "production";
  mockBuild.calls = [];
  mockBuild.offline = false;
});
afterEach(() => jest.restoreAllMocks());

const longPressVersion = () => fireEvent(screen.getByTestId(TEST_IDS.settingsVersion), "longPress");

const confirm = async (alert: jest.SpyInstance) => {
  alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.();
  await waitFor(() =>
    expect(mockBuild.calls.at(-1)?.[0]).toBe(mockBuild.offline ? "check" : "reload"),
  );
};

it("moves a production install to the preview channel, then fetches and restarts", async () => {
  const alert = jest.spyOn(Alert, "alert");
  await accountFixture().paint(<Settings />);
  expect(screen.getByTestId(TEST_IDS.settingsVersion)).toHaveTextContent("1.2.3 (45)");

  longPressVersion();
  expect(alert.mock.calls.at(-1)?.[0]).toBe("Preview updates");
  expect(alert.mock.calls.at(-1)?.[2]?.[1]?.text).toBe("Turn on");
  await confirm(alert);

  expect(mockBuild.calls).toEqual([
    ["override", { "expo-channel-name": "preview" }],
    ["check"],
    ["fetch"],
    ["reload"],
  ]);
});

it("shows a preview install as such and returns it to the build's own channel", async () => {
  mockBuild.channel = "preview";
  const alert = jest.spyOn(Alert, "alert");
  await accountFixture().paint(<Settings />);
  expect(screen.getByTestId(TEST_IDS.settingsVersion)).toHaveTextContent("1.2.3 (45) · preview");

  longPressVersion();
  expect(alert.mock.calls.at(-1)?.[2]?.[1]?.text).toBe("Turn off");
  await confirm(alert);

  expect(mockBuild.calls[0]).toEqual(["override", null]);
  expect(mockBuild.calls.at(-1)).toEqual(["reload"]);
});

it("offers nothing on a build that carries no channel", async () => {
  mockBuild.channel = null;
  const alert = jest.spyOn(Alert, "alert");
  await accountFixture().paint(<Settings />);

  longPressVersion();

  expect(alert).not.toHaveBeenCalled();
});

it("keeps the switch for the next start when the update server is out of reach", async () => {
  mockBuild.offline = true;
  const alert = jest.spyOn(Alert, "alert");
  await accountFixture().paint(<Settings />);

  longPressVersion();
  await confirm(alert);

  expect(mockBuild.calls).toEqual([["override", { "expo-channel-name": "preview" }], ["check"]]);
  expect(
    await screen.findByText("Couldn't check for updates. The switch applies when Cue next starts."),
  ).toBeVisible();
});
