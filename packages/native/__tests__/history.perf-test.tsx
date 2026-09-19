import { fireEvent } from "@testing-library/react-native";
import { type ReactElement, useState } from "react";
import { configure, measureRenders } from "reassure";
import { HistoryRow } from "../src/screens/history/HistoryRow";
import { historyEntry } from "./support/history";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);
jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());

const entry = historyEntry();

function RewatchedRow(): ReactElement {
  const [plays, setPlays] = useState(3);
  return <HistoryRow entry={entry} plays={plays} index={0} onRemove={() => setPlays(2)} />;
}

test("history row removes one play", async () => {
  await measureRenders(<RewatchedRow />, {
    scenario: async (screen) => fireEvent.press(screen.getByTestId("history-row-0-check")),
  });
});
