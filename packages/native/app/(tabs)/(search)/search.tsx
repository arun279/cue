import { useSearchInput } from "@cue/core/hooks/useSearchInput";
import { searchQuery } from "@cue/core/queries/discover";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { type ReactElement, useEffect } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { TEST_IDS } from "../../../src/ui/test-ids";

/**
 * Search, over the shared debounced hook. The field is a plain `TextInput` for
 * now; the platform's own search affordance is `headerSearchBarOptions`, which
 * is `UISearchController`, and adopting it belongs with the visual layer rather
 * than with the wiring.
 */
export default function Search(): ReactElement {
  const runtime = useRuntime();
  const search = useSearchInput();
  const query = useQuery({
    ...searchQuery(runtime, search.query),
    enabled: search.query.length > 0,
  });

  useEffect(() => {
    if (query.isSuccess) search.remember(search.query);
  }, [query.isSuccess, search.query, search.remember]);

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
        data={query.data ?? []}
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
