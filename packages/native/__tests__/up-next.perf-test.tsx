import { fireEvent } from "@testing-library/react-native";
import { useState } from "react";
import { configure, measureRenders } from "reassure";
import { CheckControl } from "../src/ui/CheckControl";
import { TEST_IDS } from "../src/ui/test-ids";
import { cardOf, entry, viewOf } from "./support/up-next";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: Text };
});
jest.mock("@cue/core/hooks/useMarkWatched", () => ({
  useMarkWatched: () => ({
    mark: jest.fn(),
    reverse: jest.fn(),
    reArm: jest.fn(),
    justMarkedAt: () => null,
  }),
}));
jest.mock("@cue/core/hooks/useMarkControl", () => ({
  useMarkControl: () => {
    const { useState } = require("react");
    const [state, setState] = useState("unwatched");
    return {
      state,
      pending: false,
      label: "Mark Harbor Lights S3 E6 watched",
      onPress: () => setState("watched"),
    };
  },
}));
jest.mock("@cue/core/hooks/useSyncBanner", () => ({ useSyncBanner: () => null }));
jest.mock("@cue/core/hooks/useUpNext", () => ({ useUpNext: () => mockView }));

const card = cardOf(false);
const mockView = viewOf();

const { default: UpNext, QueueRow } = require("../app/(tabs)/(up-next)");

function InteractiveCheckControl() {
  const [checked, setChecked] = useState(false);
  return (
    <CheckControl
      checked={checked}
      label="Mark Salt Air watched"
      testID={TEST_IDS.markWatched(entry.showId)}
      onPress={() => setChecked(true)}
    />
  );
}

test("queue row", async () => {
  await measureRenders(<QueueRow card={card} />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});

test("check control", async () => {
  await measureRenders(<InteractiveCheckControl />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});

test("Up Next screen", async () => {
  await measureRenders(<UpNext />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});
