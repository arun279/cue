import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { usePullTrace } from "../../src/ui/harness";
import { HARNESS_IDS } from "../../src/ui/harness-ids";

function PulledList({ refreshing }: { readonly refreshing: boolean }): ReactElement {
  const trace = usePullTrace(refreshing);
  return (
    <>
      {trace.marker}
      <ScrollView testID="list" {...trace.handlers} />
    </>
  );
}

const at = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y } } });

it("records where a pull starts and ends and when the refresh turns on and off", async () => {
  const { rerender } = await render(<PulledList refreshing={false} />);
  const list = screen.getByTestId("list");

  await fireEvent(list, "scrollBeginDrag", at(-168));
  await rerender(<PulledList refreshing />);
  await fireEvent(list, "scrollEndDrag", at(-433));
  await rerender(<PulledList refreshing={false} />);

  expect(
    screen.getByTestId(HARNESS_IDS.pullTrace).props["accessibilityLabel"].replace(/ \+\d+;/g, ";"),
  ).toBe("refreshing false; drag y -168; refreshing true; release y -433; refreshing false; ");
});
