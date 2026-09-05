import { epCode } from "@cue/core/domain/model/library";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { type UpNextCard, useUpNext } from "@cue/core/hooks/useUpNext";
import { readFailureBody } from "@cue/core/sync-contract";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

/** One row's check, over the shared grammar: green only through the undo
 * window, then the advanced row, with a quiet indicator while the mark is still
 * on its way to Trakt. Its own component so the hook has a stable home per card.
 *
 * `advancing` is checked and disabled, not a pressable with a no-op: the next
 * episode is a client projection until a real read names it, and a target that
 * answers nothing is worse than one that is honestly unavailable. Every string
 * comes from the contract; nothing here writes copy. */
function Row({ card }: { readonly card: UpNextCard }): ReactElement {
  const mark = useMarkWatched();
  const control = useMarkControl(card.entry, mark);
  const inert = control.state === "advancing";
  return (
    <View testID="up-next-card">
      <Text>{card.entry.title}</Text>
      <Text>{epCode(card.item.episode.season, card.item.episode.number)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={control.label}
        accessibilityState={{ checked: control.state !== "unwatched", disabled: inert }}
        disabled={inert}
        testID={`mark-watched-${card.entry.showId}`}
        onPress={control.onPress}
      >
        <Text testID={`mark-state-${card.entry.showId}`}>{control.state}</Text>
      </Pressable>
      {control.pending && <View testID={`mark-pending-${card.entry.showId}`} />}
    </View>
  );
}

/**
 * Up Next, over the shared hooks and nothing else. Unstyled on purpose: the
 * visual layer is its own piece of work, and what this has to prove first is
 * that the whole read path, the persisted cache, the write queue and the sync
 * contract already work on this target without a line of new logic.
 */
export function UpNext(): ReactElement {
  const view = useUpNext();
  const banner = useSyncBanner(view);

  if (view.isLoading) return <Text testID="up-next-skeleton">Loading your queue…</Text>;
  if (view.isError && !view.hasData) {
    return (
      <View testID="up-next-error">
        <Text>Couldn't load your queue.</Text>
        <Text>{readFailureBody(view.failure)}</Text>
      </View>
    );
  }

  return (
    <View testID="screen-up-next">
      <Text accessibilityRole="header">Up Next</Text>
      {/* Ambient, so it is announced politely rather than asserted: an outage
          note must not interrupt what a screen reader is already reading. */}
      {banner !== null && (
        <Text accessibilityLiveRegion="polite" testID="sync-strip">
          {banner.message}
        </Text>
      )}
      {/* The account area is behind the header avatar on every tab root; this is
          that entry point before the header exists. */}
      <Link href="/profile" testID="open-account">
        Profile
      </Link>
      <FlatList
        testID="up-next-list"
        data={view.queue}
        keyExtractor={(card) => String(card.entry.showId)}
        ListEmptyComponent={<Text testID="up-next-empty">Nothing queued.</Text>}
        renderItem={({ item: card }) => <Row card={card} />}
      />
    </View>
  );
}
