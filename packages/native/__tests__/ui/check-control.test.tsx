import { fireEvent, render, renderHook, screen, userEvent } from "@testing-library/react-native";
import { Platform, processColor } from "react-native";
import { CheckControl } from "../../src/ui/CheckControl";
import { useColors } from "../../src/ui/tokens";

it("is a switch that carries its state, and says what it does rather than what it is", async () => {
  await render(<CheckControl checked={false} label="Mark Salt Air watched" onPress={jest.fn()} />);

  expect(
    screen.getByRole("switch", { name: "Mark Salt Air watched", checked: false }),
  ).toBeOnTheScreen();
});

it("reports itself checked once it is", async () => {
  await render(<CheckControl checked label="Mark Salt Air watched" onPress={jest.fn()} />);

  expect(screen.getByRole("switch", { checked: true })).toBeOnTheScreen();
});

it("is the platform glyph inside the platform target", async () => {
  await render(<CheckControl checked={false} label="Row" onPress={jest.fn()} testID="check" />);

  const target = Platform.OS === "ios" ? 44 : 48;
  expect(screen.getByTestId("check")).toHaveStyle({ width: target, height: target });
  const icon = screen.getByTestId("check-icon");
  if (Platform.OS === "ios") {
    expect(icon).toHaveProp("source", [{ uri: "sf:/circle" }]);
    expect(icon).toHaveStyle({ width: 22, height: 22 });
  } else {
    expect(icon).toHaveProp("width", 24);
  }
});

it("toggles from its own tap", async () => {
  const user = userEvent.setup();
  const onPress = jest.fn();
  await render(
    <CheckControl checked={false} label="Mark Salt Air watched" onPress={onPress} testID="check" />,
  );

  await user.press(screen.getByTestId("check"));

  expect(onPress).toHaveBeenCalledTimes(1);
});

it("fills the checked glyph in the watched color", async () => {
  const { result } = await renderHook(() => useColors());
  await render(<CheckControl checked label="Watched." onPress={jest.fn()} testID="check" />);

  const icon = screen.getByTestId("check-icon");
  if (Platform.OS === "ios") {
    expect(icon).toHaveProp("source", [{ uri: "sf:/checkmark.circle.fill" }]);
    expect(icon).toHaveProp("tintColor", processColor(result.current.watched));
  } else {
    const glyph = icon.children[0];
    const path = typeof glyph === "string" ? undefined : glyph?.children[0];
    expect(typeof path === "string" ? undefined : path?.props["fill"]).toEqual({
      type: 0,
      payload: processColor(result.current.watched),
    });
  }
});

it("is checked and inert while its next episode is still a guess, with a quiet dot beside it", async () => {
  const onPress = jest.fn();
  await render(
    <CheckControl
      checked
      disabled
      pending
      label="Watched. Not synced yet."
      onPress={onPress}
      testID="check"
    />,
  );

  const check = screen.getByRole("switch", { name: "Watched. Not synced yet." });
  expect(check).toHaveProp("accessibilityState", { checked: true, disabled: true });
  // A target that answers nothing is worse than one that is honestly unavailable.
  fireEvent.press(check);
  expect(onPress).not.toHaveBeenCalled();
  // The dot rides in the label, so it is drawn without being read twice.
  expect(screen.getByTestId("check").parent?.children).toHaveLength(2);
});

it("draws no dot for a mark Trakt has already confirmed", async () => {
  await render(
    <CheckControl checked disabled label="Watched." onPress={jest.fn()} testID="check" />,
  );

  expect(screen.getByTestId("check").parent?.children).toHaveLength(1);
});
