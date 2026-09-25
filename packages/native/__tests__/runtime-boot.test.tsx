import { useRuntimeBoot } from "@cue/core/app/boot";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { hideAsync } from "expo-splash-screen";
import { Text } from "react-native";
import { RuntimeBoot } from "../src/screens/RuntimeBoot";
import { TARGET_MIN } from "../src/ui/tokens";

const INSETS = { top: 59, bottom: 34, left: 0, right: 0 };

jest.mock("expo-splash-screen", () => ({ hideAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@cue/core/app/boot", () => ({ useRuntimeBoot: jest.fn() }));
jest.mock("@cue/core/auth/store", () => ({
  useAuth: (select: (state: { endSession: () => void }) => unknown) =>
    select({ endSession: () => {} }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => INSETS }));

type BootState = ReturnType<typeof useRuntimeBoot>;
const retry = jest.fn();

async function bootInto(state: Omit<BootState, "retry">): Promise<void> {
  jest.mocked(useRuntimeBoot).mockReturnValue({ ...state, retry });
  await render(
    <RuntimeBoot deps={{} as Parameters<typeof RuntimeBoot>[0]["deps"]}>
      <Text>queue</Text>
    </RuntimeBoot>,
  );
}

beforeEach(() => jest.clearAllMocks());

it("keeps the splash over a runtime that is still building, and draws nothing of its own", async () => {
  await bootInto({ runtime: null, failed: false });

  expect(hideAsync).not.toHaveBeenCalled();
  expect(screen.queryByText(/./)).toBeNull();
});

it("lets the splash go onto the app once the runtime is built", async () => {
  await bootInto({ runtime: {} as NonNullable<BootState["runtime"]>, failed: false });

  expect(screen.getByText("queue")).toBeOnTheScreen();
  expect(hideAsync).toHaveBeenCalledTimes(1);
});

it("lets the splash go onto a retry that clears the system bars", async () => {
  await bootInto({ runtime: null, failed: true });

  expect(hideAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("runtime-error")).toHaveStyle({
    paddingTop: INSETS.top,
    paddingBottom: INSETS.bottom,
  });
  const retryButton = screen.getByRole("button", { name: "Retry" });
  expect(retryButton).toHaveStyle({ minHeight: TARGET_MIN });

  await fireEvent.press(retryButton);
  expect(retry).toHaveBeenCalledTimes(1);
});
