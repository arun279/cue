import { render, renderHook, screen, userEvent } from "@testing-library/react-native";
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
