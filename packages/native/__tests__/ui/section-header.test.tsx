import { render, screen, userEvent } from "@testing-library/react-native";
import { SectionHeader } from "../../src/ui/SectionHeader";
import { TARGET_MIN } from "../../src/ui/tokens";

it("is a real heading, which is what the rotor and TalkBack traverse", async () => {
  await render(<SectionHeader label="On the way" />);

  expect(screen.getByRole("header", { name: "On the way" })).toBeOnTheScreen();
  expect(screen.getByRole("header")).toHaveStyle({ fontFamily: "Inter_600SemiBold" });
});

it("draws its link as a target at the floor and runs it from a tap", async () => {
  const user = userEvent.setup();
  const onPress = jest.fn();
  await render(
    <SectionHeader
      label="On the way"
      action={{ label: "Calendar", onPress, testID: "section-link" }}
    />,
  );

  const link = screen.getByRole("button", { name: "Calendar" });
  expect(link).toHaveStyle({ minHeight: TARGET_MIN });

  await user.press(link);

  expect(onPress).toHaveBeenCalledTimes(1);
});

it("draws no link when there is nowhere to go", async () => {
  await render(<SectionHeader label="On the way" />);

  expect(screen.queryByRole("button")).toBeNull();
});
