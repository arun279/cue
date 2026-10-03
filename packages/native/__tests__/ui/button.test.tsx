import { render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { Button } from "../../src/ui/Button";

it("keeps a bar item's label to the bar and offers it in the Large Content Viewer", async () => {
  await render(<Button label="Done" variant="link" bar onPress={jest.fn()} />);
  const button = screen.getByRole("button", { name: "Done" });

  expect(button).toHaveProp("accessibilityShowsLargeContentViewer", true);
  expect(button).toHaveProp("accessibilityLargeContentTitle", "Done");
  expect(screen.getByText("Done").props["maxFontSizeMultiplier"]).toBe(
    Platform.OS === "ios" ? 36 / 22 : undefined,
  );
});

it("lets a button in the content grow with the text", async () => {
  await render(<Button label="Retry" onPress={jest.fn()} />);

  expect(screen.getByText("Retry")).not.toHaveProp("maxFontSizeMultiplier");
  expect(screen.getByRole("button", { name: "Retry" })).not.toHaveProp(
    "accessibilityShowsLargeContentViewer",
    true,
  );
});
