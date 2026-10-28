import { useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { usePrefs } from "@/core/prefs/prefs-store";
import { parseId, parseSeason } from "../../../../../src/route-params";
import { EpisodeSheet } from "../../../../../src/screens/EpisodeSheet";
import NotFound from "../../../../../src/screens/NotFound";
import { EmptyState } from "../../../../../src/ui/EmptyState";
import { SheetClose } from "../../../../../src/ui/SheetClose";
import { SnackbarHost } from "../../../../../src/ui/SnackbarHost";
import { SPACE } from "../../../../../src/ui/tokens";

export default function EpisodeRoute(): ReactElement {
  const enabled = usePrefs((state) => state.showsEnabled);
  const params = useLocalSearchParams<{ showId: string; season: string; episode: string }>();
  const showId = parseId(params.showId);
  const season = parseSeason(params.season);
  const episode = parseId(params.episode);
  if (showId === null || season === null || episode === null) {
    return <NotFound />;
  }
  if (!enabled)
    return (
      <View style={styles.off}>
        <View style={styles.bar}>
          <SheetClose />
        </View>
        <EmptyState
          headline="TV shows are turned off."
          body="Turn TV shows back on in Settings to see this episode."
        />
      </View>
    );
  return (
    <View style={styles.route}>
      <EpisodeSheet showId={showId} season={season} episode={episode} />
      <SnackbarHost placement="sheet" />
    </View>
  );
}

const styles = StyleSheet.create({
  route: { flex: 1 },
  off: { flex: 1, padding: SPACE.s4 },
  bar: { alignItems: "flex-end" },
});
