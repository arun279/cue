import { useSearch } from "@cue/core/hooks/useSearch";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, TextInput, View } from "react-native";

/**
 * Search, over the shared debounced hook. The field is a plain `TextInput` for
 * now; the platform's own search affordance is `headerSearchBarOptions`, which
 * is `UISearchController`, and adopting it belongs with the visual layer rather
 * than with the wiring.
 */
export function Search(): ReactElement {
  const search = useSearch();

  return (
    <View testID="screen-search">
      <Text accessibilityRole="header">Search</Text>
      <TextInput
        testID="search-input"
        accessibilityLabel="Search shows and movies"
        value={search.input}
        onChangeText={search.setInput}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        testID="search-results"
        data={search.hits}
        keyExtractor={(hit) => hit.key}
        renderItem={({ item }) => (
          <Link
            href={item.type === "movie" ? `/movie/${item.traktId}` : `/show/${item.traktId}`}
            testID="search-row"
          >
            {item.title}
          </Link>
        )}
      />
    </View>
  );
}
