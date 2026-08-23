import { epCode } from "@cue/core/domain/model/library";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useUpNext } from "@cue/core/hooks/useUpNext";
import type { ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

/**
 * Up Next, over the shared hook and nothing else. Unstyled on purpose: the
 * visual layer is its own piece of work, and what this has to prove first is
 * that the whole read path, the persisted cache, the write queue and the mark
 * surfaces already work on this target without a line of new logic.
 */
export function UpNext(): ReactElement {
  const { queue, isLoading, isError, hasData } = useUpNext();
  const marking = useMarkWatched();

  if (isLoading) return <Text testID="up-next-skeleton">Loading your queue…</Text>;
  if (isError && !hasData) return <Text testID="up-next-error">Couldn't load your queue.</Text>;

  return (
    <View testID="screen-up-next">
      <Text accessibilityRole="header">Up Next</Text>
      <FlatList
        testID="up-next-list"
        data={queue}
        keyExtractor={(card) => String(card.entry.showId)}
        ListEmptyComponent={<Text testID="up-next-empty">Nothing queued.</Text>}
        renderItem={({ item: card }) => (
          <View testID="up-next-card">
            <Text>{card.entry.title}</Text>
            <Text>{epCode(card.item.episode.season, card.item.episode.number)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mark ${card.entry.title} watched`}
              testID={`mark-watched-${card.entry.showId}`}
              onPress={() => void marking.mark(card.entry)}
            >
              <Text>Mark watched</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
