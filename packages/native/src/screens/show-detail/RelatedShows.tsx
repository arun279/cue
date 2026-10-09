import type { SearchHit } from "@cue/core/data/trakt/search";
import { showRelatedQuery } from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Poster } from "../../ui/Poster";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function RelatedShows({ showId }: { readonly showId: number }): ReactElement | null {
  const runtime = useRuntime();
  const query = useQuery(showRelatedQuery(runtime, showId));
  return <RelatedTitles titles={query.data ?? []} />;
}

export function RelatedTitles({
  titles,
}: {
  readonly titles: readonly SearchHit[];
}): ReactElement | null {
  const router = useRouter();
  const colors = useColors();
  if (titles.length === 0) return null;
  return (
    <View style={{ padding: SPACE.s4, gap: SPACE.s3 }}>
      <CueText variant="meta" accessibilityRole="header" style={{ color: colors.muted }}>
        More like this
      </CueText>
      <ScrollView horizontal contentContainerStyle={{ gap: SPACE.s4 }}>
        {titles.slice(0, 6).map((show) => (
          <Pressable
            key={show.key}
            testID={
              show.type === "movie"
                ? TEST_IDS.movieCard(show.traktId)
                : TEST_IDS.showCard(show.traktId)
            }
            accessibilityRole="button"
            accessibilityLabel={show.title}
            style={{ width: 104, gap: SPACE.s2 }}
            onPress={() => router.push(`/${show.type}/${show.traktId}`)}
          >
            <Poster title={show.title} posters={show.posters} width={104} />
            <CueText variant="caption" style={{ color: colors.fg }}>
              {show.title}
            </CueText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
