import "./support/detail-mocks";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ShowDetail } from "../src/screens/ShowDetail";
import { ContinueBar } from "../src/screens/show-detail/ContinueBar";
import { RelatedShows } from "../src/screens/show-detail/RelatedShows";
import { ShowAbout, ShowHero } from "../src/screens/show-detail/ShowHero";
import { ShowMenu } from "../src/screens/show-detail/ShowMenu";
import { Chevron } from "../src/ui/Chevron";
import { TEST_IDS } from "../src/ui/test-ids";
import { DetailHarness } from "./support/detail";
import { resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

/** A module with the named exports wrapped in mocks that count their calls. */
const counted = (path: string, names: readonly string[]) => {
  const actual = jest.requireActual(path);
  return {
    ...actual,
    ...Object.fromEntries(names.map((name) => [name, jest.fn(actual[name])])),
  };
};
jest.mock("../src/screens/show-detail/ShowHero", () =>
  counted("../src/screens/show-detail/ShowHero", ["ShowHero", "ShowAbout"]),
);
jest.mock("../src/screens/show-detail/ContinueBar", () =>
  counted("../src/screens/show-detail/ContinueBar", ["ContinueBar"]),
);
jest.mock("../src/screens/show-detail/RelatedShows", () =>
  counted("../src/screens/show-detail/RelatedShows", ["RelatedShows"]),
);
jest.mock("../src/screens/show-detail/ShowMenu", () =>
  counted("../src/screens/show-detail/ShowMenu", ["ShowMenu"]),
);
// Each season row draws one chevron, the only one on show detail, so its calls count row renders.
jest.mock("../src/ui/Chevron", () => counted("../src/ui/Chevron", ["Chevron"]));

const screenParts = { ShowHero, ShowAbout, ContinueBar, RelatedShows, ShowMenu };
const seasonRows = () => jest.mocked(Chevron).mock.calls.map(([{ direction }]) => direction);

beforeEach(resetSharedStores);

it("renders only the season it opens or closes, leaving the rest of show detail alone", async () => {
  await render(
    <DetailHarness>
      <ShowDetail showId={8803} />
    </DetailHarness>,
  );
  await screen.findByTestId(TEST_IDS.seasonTrigger(1));
  await act(async () => {});
  jest.clearAllMocks();

  await fireEvent.press(screen.getByTestId(TEST_IDS.seasonTrigger(1)));

  expect(screen.getByTestId(TEST_IDS.episodeRow(880311))).toBeOnTheScreen();
  expect(seasonRows()).toEqual(["up"]);
  for (const part of Object.values(screenParts)) expect(part).not.toHaveBeenCalled();

  jest.clearAllMocks();
  await fireEvent.press(screen.getByTestId(TEST_IDS.seasonTrigger(1)));

  expect(screen.queryByTestId(TEST_IDS.episodeRow(880311))).toBeNull();
  expect(seasonRows()).toEqual(["down"]);
});
