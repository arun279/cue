import { usePrefs } from "@cue/core/prefs/prefs-store";
import { Redirect, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { parseId, parseSeason } from "../../../../../../../src/route-params";
import { EpisodeSheet } from "../../../../../../../src/screens/EpisodeSheet";
import { AppIdle } from "../../../../../../../src/ui/AppIdle";
import { SnackbarHost } from "../../../../../../../src/ui/SnackbarHost";

export default function EpisodeRoute(): ReactElement {
  const enabled = usePrefs((state) => state.showsEnabled);
  const params = useLocalSearchParams<{ showId: string; season: string; episode: string }>();
  const showId = parseId(params.showId);
  const season = parseSeason(params.season);
  const episode = parseId(params.episode);
  if (showId === null || season === null || episode === null) {
    return <Redirect href="/+not-found" />;
  }
  if (!enabled) return <Redirect href={`/show/${showId}`} />;
  return (
    <View style={styles.route}>
      <EpisodeSheet showId={showId} season={season} episode={episode} />
      <SnackbarHost placement="presentation" />
      <AppIdle />
    </View>
  );
}

const styles = StyleSheet.create({ route: { flex: 1 } });
