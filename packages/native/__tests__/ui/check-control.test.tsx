import { fireEvent, render, renderHook, screen, userEvent } from "@testing-library/react-native";
import { CheckControl } from "../../src/ui/CheckControl";
import { CHECK_SIZE, useColors } from "../../src/ui/tokens";

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

it("draws a target at the floor, and the marquee's larger one when asked", async () => {
  await render(
    <>
      <CheckControl checked={false} label="Row" onPress={jest.fn()} testID="row-check" />
      <CheckControl
        checked={false}
        label="Marquee"
        onPress={jest.fn()}
        size={CHECK_SIZE.marquee}
        testID="marquee-check"
      />
    </>,
  );

  expect(screen.getByTestId("row-check")).toHaveStyle({ width: 48, height: 48 });
  expect(screen.getByTestId("marquee-check")).toHaveStyle({ width: 56, height: 56 });
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

it("merges the checked ring into its fill", async () => {
  const { result } = await renderHook(() => useColors());
  await render(<CheckControl checked label="Mark Salt Air watched" onPress={jest.fn()} />);
  expect(screen.getByRole("switch").children[0]).toHaveStyle({
    backgroundColor: result.current.watched,
    borderColor: result.current.watched,
  });
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
