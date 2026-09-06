import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { EmptyState } from "../../src/ui/EmptyState";
import { TEST_IDS } from "../../src/ui/test-ids";

it("leads with a heading and carries whatever action it is given", async () => {
  await render(
    <EmptyState
      headline="Nothing queued"
      body="Start a show and it turns up here."
      testID={TEST_IDS.upNextEmptyNothingQueued}
    >
      <Text>Find something to watch</Text>
    </EmptyState>,
  );

  expect(screen.getByRole("header", { name: "Nothing queued" })).toBeOnTheScreen();
  expect(screen.getByText("Start a show and it turns up here.")).toBeOnTheScreen();
  expect(screen.getByText("Find something to watch")).toBeOnTheScreen();
  expect(screen.getByTestId(TEST_IDS.upNextEmptyNothingQueued)).toBeOnTheScreen();
});

it("left-aligns emptiness and centers failure, so the two never read the same", async () => {
  await render(
    <>
      <EmptyState headline="Nothing queued" testID="empty" />
      <EmptyState headline="Couldn't load your queue" centered testID="failure" />
    </>,
  );

  expect(screen.getByTestId("empty")).toHaveStyle({ alignItems: "flex-start" });
  expect(screen.getByTestId("failure")).toHaveStyle({ alignItems: "center" });
});

it("draws no body line when there is nothing more to say", async () => {
  await render(<EmptyState headline="Nothing queued" testID="empty" />);

  expect(screen.getByTestId("empty").children).toHaveLength(1);
});
