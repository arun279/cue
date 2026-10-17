import { fireEvent } from "@testing-library/react-native";
import { type ReactElement, useState } from "react";
import { configure, measureRenders } from "reassure";
import { EpisodeBody } from "../src/screens/EpisodeSheet";
import { SeasonRow } from "../src/screens/show-detail/SeasonRow";
import { TEST_IDS } from "../src/ui/test-ids";
import { detail, detailSeason } from "./support/detail";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);
jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

const season = detailSeason();
const noop = (): void => {};

function ExpandableSeason(): ReactElement {
  const [expanded, setExpanded] = useState(false);
  return (
    <SeasonRow
      showId={8803}
      season={season}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onConfirm={noop}
      onMark={noop}
      onOpen={noop}
    />
  );
}

function MarkableSheet(): ReactElement {
  const [watched, setWatched] = useState(false);
  return (
    <EpisodeBody
      detail={{ ...detail, watched, stills: [] }}
      guarded={false}
      plays={watched ? 1 : 0}
      onMark={() => setWatched(true)}
    />
  );
}

test("season row expands", async () => {
  await measureRenders(<ExpandableSeason />, {
    scenario: async (screen) => fireEvent.press(screen.getByTestId(TEST_IDS.seasonTrigger(2))),
  });
});

test("episode sheet mark", async () => {
  await measureRenders(<MarkableSheet />, {
    scenario: async (screen) => fireEvent.press(screen.getByRole("switch")),
  });
});
