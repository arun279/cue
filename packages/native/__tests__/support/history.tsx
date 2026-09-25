import type { HistoryEntry } from "@cue/core/domain/history";
import type { ReactElement } from "react";
import { TextInput } from "react-native";
import { expoRouterModule, router } from "./native-ui";

export const historyRouter = { ...router, setParams: jest.fn() };
export const historyParams: { current: Record<string, string> } = { current: {} };

export function historyRouterModule() {
  const Stack = (): null => null;
  Stack.Screen = ({
    options,
  }: {
    readonly options: {
      readonly headerSearchBarOptions?: {
        readonly onChangeText: (event: { nativeEvent: { text: string } }) => void;
      };
    };
  }): ReactElement | null =>
    options.headerSearchBarOptions === undefined ? null : (
      <TextInput
        accessibilityLabel="Filter by title"
        onChangeText={(text) =>
          options.headerSearchBarOptions?.onChangeText({ nativeEvent: { text } })
        }
      />
    );
  return {
    ...expoRouterModule(),
    Stack,
    useRouter: () => historyRouter,
    useLocalSearchParams: () => historyParams.current,
  };
}

export function historyEntry(
  overrides: Partial<Omit<HistoryEntry, "type" | "season" | "number">> = {},
): HistoryEntry {
  return {
    historyId: 3,
    watchedAt: "2026-08-21T20:00:00.000Z",
    type: "movie",
    mediaId: 9,
    ids: { trakt: 9 },
    title: "Winter Ledger",
    year: 2019,
    season: null,
    number: null,
    episodeTitle: null,
    posters: [],
    tmdbId: null,
    ...overrides,
  };
}

export const HISTORY = [
  historyEntry(),
  historyEntry({ historyId: 1, watchedAt: "2026-08-21T18:00:00.000Z" }),
  historyEntry({ historyId: 2, watchedAt: "2026-08-21T19:00:00.000Z" }),
];
