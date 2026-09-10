import { showRelatedQuery } from "@cue/core/queries/shows";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Poster } from "../../ui/Poster";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function RelatedShows({ showId }: { readonly showId: number }): ReactElement | null {
  const runtime = useRuntime();
  const query = useQuery(showRelatedQuery(runtime, showId));
  const router = useRouter();
  const colors = useColors();
  if (query.data === undefined || query.data.length === 0) return null;
  return (
    <View style={{ padding: SPACE.s4, gap: SPACE.s3 }}>
      <CueText variant="meta" accessibilityRole="header" style={{ color: colors.muted }}>
        More like this
      </CueText>
      <ScrollView horizontal contentContainerStyle={{ gap: SPACE.s4 }}>
        {query.data.slice(0, 6).map((show) => (
          <Pressable
            key={show.key}
            accessibilityRole="button"
            accessibilityLabel={show.title}
            style={{ width: 104, gap: SPACE.s2 }}
            onPress={() => router.push(`/show/${show.traktId}`)}
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
