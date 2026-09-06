import { render, screen } from "@testing-library/react-native";
import { StyleSheet, type ViewStyle } from "react-native";
import { Marker } from "../../src/ui/Marker";

/**
 * The one property every marker exists for: bounds.
 *
 * A view with no frame is absent from every accessibility hierarchy, so a wait
 * marked by one is a wait no end-to-end run can name: the dump comes back with
 * no application content in it, and a launch that stopped and a launch that
 * crashed look the same from outside.
 */
it("draws a frame a hierarchy dump can find", async () => {
  await render(<Marker testID="a-gate" />);

  const frame = StyleSheet.flatten<ViewStyle>(screen.getByTestId("a-gate").props["style"]);
  expect(frame?.width).toBeGreaterThan(0);
  expect(frame?.height).toBeGreaterThan(0);
});
