import { Redirect, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { parseId } from "../../../../../../../src/route-params";
import { EpisodeSheet } from "../../../../../../../src/screens/EpisodeSheet";
import { SnackbarHost } from "../../../../../../../src/ui/SnackbarHost";

export default function EpisodeRoute(): ReactElement {
  const params = useLocalSearchParams<{ showId: string; season: string; episode: string }>();
  const showId = parseId(params.showId);
  const season = parseId(params.season);
  const episode = parseId(params.episode);
  if (showId === null || season === null || episode === null) {
    return <Redirect href="/+not-found" />;
  }
  return (
    <View style={styles.route}>
      <EpisodeSheet showId={showId} season={season} episode={episode} />
      {/* The sheet's own host. On iOS this route is a separate presentation, so
          a snackbar drawn at the root would sit behind it, and the mark on this
          screen is the one whose Undo the sheet exists to keep reachable. */}
      <SnackbarHost placement="presentation" />
    </View>
  );
}

const styles = StyleSheet.create({ route: { flex: 1 } });
