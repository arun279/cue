import { queryKeys } from "@cue/core/data/query-keys";
import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { queryClient } from "../../src/platform/query-persister";
import { useSnackbarTrace } from "../../src/ui/snackbar-trace";

jest.mock("../../src/platform/query-persister", () => ({
  queryClient: new (require("@tanstack/react-query").QueryClient)(),
}));

function Probe(): ReactElement {
  return <Text testID="trace">{useSnackbarTrace()}</Text>;
}

it("tells a dismissal after a queue refetch apart from one at the timeout", async () => {
  const now = jest.spyOn(performance, "now").mockReturnValue(1_000);
  await render(<Probe />);

  await act(async () => {
    showSnack({
      message: "Severance S2 E3 marked",
      actions: [{ label: "Undo", onPress: () => {} }],
    });
    queryClient.setQueryData(queryKeys.library(), { entries: [] });
    now.mockReturnValue(1_840);
    await queryClient.fetchQuery({
      queryKey: queryKeys.library(),
      queryFn: () => ({ entries: [] }),
    });
    now.mockReturnValue(16_000);
    dismissSnack();
    await queryClient.refetchQueries({ queryKey: queryKeys.library() });
  });

  expect(screen.getByTestId("trace")).toHaveTextContent(
    /^Snackbar \d+ "Severance S2 E3 marked" \[Undo\]; queue refetched \+840 ms; dismissed \+15000 ms$/,
  );
});
