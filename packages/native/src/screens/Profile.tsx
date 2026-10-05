import { type WatchTotals, watchTotals } from "@cue/core/data/trakt/watch-totals";
import { humanizeWatchMinutes } from "@cue/core/domain/time";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { combineStatus } from "@cue/core/queries/freshness";
import { libraryQuery, movieLibraryQuery } from "@cue/core/queries/library";
import { userProfileQuery } from "@cue/core/queries/user";
import { useRuntime } from "@cue/core/runtime/runtime";
import { readFailureBody } from "@cue/core/sync-contract";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import {
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Chevron } from "../ui/Chevron";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { TEST_IDS } from "../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { AccountScreen, SettingRow } from "./account/Rows";
import { SignOut } from "./account/SignOut";

const AVATAR = 48;

const TILE_BASIS = 96;

function Identity(): ReactElement {
  const profile = useQuery(userProfileQuery(useRuntime())).data;
  const colors = useColors();
  return (
    <View testID={TEST_IDS.profileIdentity} style={styles.identity}>
      <Avatar size={AVATAR} />
      <View style={styles.name}>
        <CueText variant="identity" style={{ color: colors.fg }}>
          {profile?.displayName ?? "Trakt account"}
        </CueText>
        <CueText variant="caption" style={{ color: colors.muted }}>
          {profile ? "Trakt account" : "Connected"}
        </CueText>
      </View>
    </View>
  );
}

function Stats({ totals }: { readonly totals: WatchTotals }): ReactElement {
  const shows = usePrefs((state) => state.showsEnabled);
  const movies = usePrefs((state) => state.moviesEnabled);
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const counts = [
    { label: "Episodes", count: totals.episodes, enabled: shows, id: TEST_IDS.profileEpisodeCount },
    { label: "Movies", count: totals.movies, enabled: movies, id: TEST_IDS.profileStatMovies },
    { label: "Shows", count: totals.shows, enabled: shows, id: TEST_IDS.profileStatShows },
  ].filter((tile) => tile.enabled);
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  if (counts.every((tile) => tile.count === 0))
    return (
      <EmptyState
        testID={TEST_IDS.profileEmpty}
        headline="Nothing tallied yet."
        body="Mark an episode or movie watched and your watch time adds up here."
      >
        <Button label="Find something to watch" onPress={() => router.dismissTo("/search")} />
      </EmptyState>
    );
  return (
    <View style={styles.stats}>
      {totals.minutes === null ? null : <WatchTime minutes={totals.minutes} style={card} />}
      <View style={styles.tiles}>
        {counts.map((tile) => (
          <View
            key={tile.label}
            testID={tile.id}
            accessible
            accessibilityLabel={`${tile.count} ${tile.label.toLowerCase()} watched`}
            style={[...card, styles.tile, { flexBasis: TILE_BASIS * fontScale }]}
          >
            <CueText variant="sectionHeading" tabularNums style={{ color: colors.fg }}>
              {tile.count}
            </CueText>
            <CueText variant="micro" eyebrow style={{ color: colors.muted }}>
              {tile.label}
            </CueText>
          </View>
        ))}
      </View>
    </View>
  );
}

function WatchTime({
  minutes,
  style,
}: {
  readonly minutes: number;
  readonly style: StyleProp<ViewStyle>;
}): ReactElement {
  const colors = useColors();
  const time = humanizeWatchMinutes(minutes);
  return (
    <View testID={TEST_IDS.profileWatchTime} style={style}>
      <CueText variant="micro" eyebrow style={{ color: colors.muted }}>
        Total watch time
      </CueText>
      <CueText variant="identity" style={{ color: colors.fg }}>
        <CueText variant="statHero" tabularNums style={{ color: colors.accentInk }}>
          {time.value}
        </CueText>{" "}
        {time.unit}
      </CueText>
      <CueText variant="meta" style={{ color: colors.muted }}>
        {time.detail}
      </CueText>
    </View>
  );
}

function useWatchTotals() {
  const runtime = useRuntime();
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const moviesEnabled = usePrefs((state) => state.moviesEnabled);
  const shows = useQuery({ ...libraryQuery(runtime), enabled: showsEnabled });
  const movies = useQuery({ ...movieLibraryQuery(runtime), enabled: moviesEnabled });
  const needed = [...(showsEnabled ? [shows] : []), ...(moviesEnabled ? [movies] : [])];
  const ready = needed.every((query) => query.data !== undefined);
  return {
    totals: ready
      ? watchTotals(
          (showsEnabled && shows.data?.entries) || [],
          (moviesEnabled && movies.data?.entries) || [],
        )
      : null,
    status: combineStatus(needed, ready),
    retry: () => {
      for (const query of needed) if (query.isError) void query.refetch();
    },
  };
}

export default function Profile(): ReactElement {
  const { totals, status, retry } = useWatchTotals();
  const router = useRouter();
  return (
    <AccountScreen testID={TEST_IDS.screenProfile}>
      <Identity />
      {totals ? (
        <Stats totals={totals} />
      ) : status.isError ? (
        <EmptyState
          centered
          testID={TEST_IDS.profileError}
          headline="Couldn't load your library"
          body={readFailureBody(status.failure)}
        >
          <Button label="Try again" onPress={retry} />
        </EmptyState>
      ) : (
        <View
          testID={TEST_IDS.profileSkeleton}
          accessible
          accessibilityLabel="Loading stats"
          accessibilityState={{ busy: true }}
          style={styles.stats}
        >
          <Skeleton width="100%" height={112} radius={RADIUS.card} />
          <Skeleton width="100%" height={72} radius={RADIUS.card} />
        </View>
      )}
      <View>
        <SettingRow
          title="History"
          testID={TEST_IDS.profileToHistory}
          onPress={() => router.push("/history")}
          trailing={<Chevron direction="forward" />}
        />
        <SettingRow
          title="Settings"
          testID={TEST_IDS.profileToSettings}
          onPress={() => router.push("/settings")}
          trailing={<Chevron direction="forward" />}
        />
        <SignOut testID={TEST_IDS.profileSignOut} />
      </View>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
  name: { flex: 1, gap: SPACE.s1 },
  stats: { gap: SPACE.s2 },
  card: { padding: SPACE.s4, borderRadius: RADIUS.card, borderWidth: HAIRLINE, gap: SPACE.s1 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.s2 },
  tile: { flexGrow: 1 },
});
