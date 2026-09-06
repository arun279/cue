import { render, screen, userEvent } from "@testing-library/react-native";
import { useWindowDimensions, View } from "react-native";
import { CheckControl } from "../../src/ui/CheckControl";
import { Row, Separator } from "../../src/ui/Row";
import { ROW_MIN_HEIGHT } from "../../src/ui/tokens";
import { CueText } from "../../src/ui/type";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

const dimensions = jest.mocked(useWindowDimensions);

function atFontScale(fontScale: number): void {
  dimensions.mockReturnValue({ width: 402, height: 874, scale: 3, fontScale });
}

beforeEach(() => atFontScale(1));

function queueRow() {
  return (
    <Row
      label="The Quiet Frontier, S2 E10, The Long Way, 1 left"
      minHeight={ROW_MIN_HEIGHT.queue}
      leading={<View testID="poster" />}
      trailing={
        <CheckControl
          checked={false}
          label="Mark The Long Way watched"
          onPress={jest.fn()}
          testID="row-mark"
        />
      }
      onPress={jest.fn()}
      testID="queue-row"
    >
      <CueText variant="rowTitle" weight="semibold">
        The Quiet Frontier
      </CueText>
    </Row>
  );
}

it("is two accessibility elements: the body under one composed label, the control beside it", async () => {
  await render(queueRow());

  const body = screen.getByRole("button", {
    name: "The Quiet Frontier, S2 E10, The Long Way, 1 left",
  });
  expect(body).toBe(screen.getByTestId("queue-row"));
  expect(body).not.toContainElement(screen.getByTestId("row-mark"));
  expect(screen.getByRole("switch", { name: "Mark The Long Way watched" })).toBeOnTheScreen();
});

it("grows from a minimum rather than taking a height", async () => {
  await render(queueRow());

  expect(screen.getByTestId("queue-row")).toHaveStyle({ minHeight: ROW_MIN_HEIGHT.queue });
  expect(screen.getByTestId("queue-row")).not.toHaveStyle({ height: ROW_MIN_HEIGHT.queue });
});

it("carries the tap to the whole body", async () => {
  const user = userEvent.setup();
  const onPress = jest.fn();
  await render(
    <Row label="History" minHeight={ROW_MIN_HEIGHT.footer} onPress={onPress} testID="footer-row">
      <CueText variant="rowTitle">History</CueText>
    </Row>,
  );

  await user.press(screen.getByTestId("footer-row"));

  expect(onPress).toHaveBeenCalledTimes(1);
});

it("moves the trailing controls below the text column at the accessibility sizes", async () => {
  const { rerender } = await render(queueRow());
  const row = () => screen.getByTestId("queue-row").parent;
  expect(row()).toHaveStyle({ flexDirection: "row" });

  atFontScale(1.6);
  await rerender(queueRow());

  expect(row()).toHaveStyle({ flexDirection: "column" });
});

it("draws the separator as a hairline in the platform separator, inset where asked", async () => {
  await render(<Separator inset={60} />);

  expect(screen.root).toHaveStyle({ marginLeft: 60 });
});
