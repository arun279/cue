import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { AccountScreen } from "../../src/screens/account/Rows";
import { HARNESS_IDS } from "../../src/ui/harness-ids";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const event = (velocity: number, target = 200) => ({
  nativeEvent: {
    velocity: { x: 0, y: velocity },
    contentOffset: { x: 0, y: 200 },
    targetContentOffset: { x: 0, y: target },
  },
});

afterEach(() => jest.useRealTimers());

it("waits for the scroll completion event and retains its receipt through another drag", async () => {
  jest.useFakeTimers();
  await render(
    <AccountScreen testID="account">
      <Text>Settings</Text>
    </AccountScreen>,
  );
  const scroll = screen.getByTestId("account");
  await fireEvent(scroll, "scrollBeginDrag", event(1));
  expect(screen.getByTestId(HARNESS_IDS.scrollStarted)).toHaveAccessibleName("1");
  await fireEvent(scroll, "scrollEndDrag", event(1, 300));
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).not.toHaveAccessibleName(
    /scroll 1 done;/,
  );
  await fireEvent(scroll, "momentumScrollBegin", event(1));
  await fireEvent(scroll, "momentumScrollEnd", event(0));
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).toHaveAccessibleName(/scroll 1 done;/);
  await fireEvent(scroll, "scrollBeginDrag", event(1));
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).toHaveAccessibleName(/scroll 1 done;/);
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).not.toHaveAccessibleName(
    /scroll 2 done;/,
  );
});

it("handles a release without deceleration using the platform's terminal event", async () => {
  await render(
    <AccountScreen testID="account">
      <Text>Settings</Text>
    </AccountScreen>,
  );
  const scroll = screen.getByTestId("account");
  await fireEvent(scroll, "scrollBeginDrag", event(0));
  await fireEvent(scroll, "scrollEndDrag", event(0));
  if (Platform.OS === "android") {
    expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).not.toHaveAccessibleName(
      /scroll 1 done;/,
    );
    await fireEvent(scroll, "momentumScrollBegin", event(1));
    await fireEvent(scroll, "momentumScrollEnd", event(0));
  }
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).toHaveAccessibleName(/scroll 1 done;/);
});

it("counts an iOS drag that will rest where it ended as done whatever its velocity, and records it", async () => {
  await render(
    <AccountScreen testID="account">
      <Text>Settings</Text>
    </AccountScreen>,
  );
  const scroll = screen.getByTestId("account");
  await fireEvent(scroll, "scrollBeginDrag", event(2.5));
  await fireEvent(scroll, "scrollEndDrag", event(2.5));
  const completed = screen.getByTestId(HARNESS_IDS.scrollCompleted);
  expect(completed).toHaveAccessibleName(/; drag 1 ended at 200 toward 200 at 2\.5;/);
  if (Platform.OS === "ios") expect(completed).toHaveAccessibleName(/scroll 1 done;/);
  else expect(completed).not.toHaveAccessibleName(/scroll 1 done;/);
});

it("does not credit an interrupted scroll's completion to the next drag", async () => {
  await render(
    <AccountScreen testID="account">
      <Text>Settings</Text>
    </AccountScreen>,
  );
  const scroll = screen.getByTestId("account");
  await fireEvent(scroll, "scrollBeginDrag", event(1));
  await fireEvent(scroll, "scrollEndDrag", event(1, 300));
  await fireEvent(scroll, "momentumScrollBegin", event(1));
  await fireEvent(scroll, "scrollBeginDrag", event(1));
  await fireEvent(scroll, "momentumScrollEnd", event(0));
  expect(screen.getByTestId(HARNESS_IDS.scrollCompleted)).not.toHaveAccessibleName(
    /scroll 2 done;/,
  );
});
