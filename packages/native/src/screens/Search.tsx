import { useSearch } from "@cue/core/hooks/useSearch";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";

/**
 * Search, over the shared debounced hook. The field is a plain `TextInput` for
 * now; the platform's own search affordance is `headerSearchBarOptions`, which
 * is `UISearchController`, and adopting it belongs with the visual layer rather
 * than with the wiring.
 */
export function Search(): ReactElement {
  const search = useSearch();

  return (
    <View testID={TEST_IDS.screenSearch}>
      <Text accessibilityRole="header">Search</Text>
      <TextInput
        testID={TEST_IDS.searchInput}
        accessibilityLabel="Search shows and movies"
        value={search.input}
        onChangeText={search.setInput}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        testID={TEST_IDS.searchResults}
        data={search.hits}
        keyExtractor={(hit) => hit.key}
        renderItem={({ item }) => (
          <Link
            href={item.type === "movie" ? `/movie/${item.traktId}` : `/show/${item.traktId}`}
            testID={TEST_IDS.searchRow(item.traktId)}
          >
            {item.title}
          </Link>
        )}
      />
    </View>
  );
}
