import type { UserStats } from "@cue/core/data/trakt/schemas";
import { humanizeWatchMinutes } from "@cue/core/domain/time";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { queryStatus } from "@cue/core/queries/freshness";
import { userProfileQuery, userStatsQuery } from "@cue/core/queries/user";
import { useRuntime } from "@cue/core/runtime/runtime";
import { readFailureBody } from "@cue/core/sync-contract";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Button } from "../ui/Button";
import { Chevron } from "../ui/Chevron";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton } from "../ui/Skeleton";
import { TEST_IDS } from "../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, useColors, useStacked } from "../ui/tokens";
import { CueText } from "../ui/type";
import { AccountScreen, SettingRow } from "./account/Rows";
import { SignOut } from "./account/SignOut";

function Identity(): ReactElement {
  const profile = useQuery(userProfileQuery(useRuntime())).data;
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const colors = useColors();
  const avatar = profile?.avatar;
  return (
    <View testID={TEST_IDS.profileIdentity} style={styles.identity}>
      {avatar && avatar !== failedAvatar ? (
        <Image
          testID={TEST_IDS.profileAvatar}
          source={{ uri: avatar }}
          style={styles.avatar}
          onError={() => setFailedAvatar(avatar)}
        />
      ) : (
        <View style={[styles.avatar, { backgroundColor: colors.elevated }]}>
          <Svg width={28} height={28} viewBox="0 0 24 24">
            <Circle cx="12" cy="8" r="4" fill={colors.muted} />
            <Path d="M5 21a7 7 0 0 1 14 0" fill={colors.muted} />
          </Svg>
        </View>
      )}
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

function Stats({ stats }: { readonly stats: UserStats }): ReactElement {
  const shows = usePrefs((state) => state.showsEnabled);
  const movies = usePrefs((state) => state.moviesEnabled);
  const colors = useColors();
  const stacked = useStacked();
  const router = useRouter();
  const minutes = (shows ? stats.episodes.minutes : 0) + (movies ? stats.movies.minutes : 0);
  const counts = [
    {
      label: "Episodes",
      count: stats.episodes.watched,
      enabled: shows,
      id: TEST_IDS.profileEpisodeCount,
    },
    {
      label: "Movies",
      count: stats.movies.watched,
      enabled: movies,
      id: TEST_IDS.profileStatMovies,
    },
    { label: "Shows", count: stats.shows.watched, enabled: shows, id: TEST_IDS.profileStatShows },
  ].filter((tile) => tile.enabled);
  const time = humanizeWatchMinutes(minutes);
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
      <View testID={TEST_IDS.profileWatchTime} style={card}>
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
      <View style={[styles.tiles, stacked && styles.stacked]}>
        {counts.map((tile) => (
          <View
            key={tile.label}
            testID={tile.id}
            accessible
            accessibilityLabel={`${tile.count} ${tile.label.toLowerCase()} watched`}
            style={[...card, styles.tile]}
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

export default function Profile(): ReactElement {
  const stats = useQuery(userStatsQuery(useRuntime()));
  const router = useRouter();
  return (
    <AccountScreen testID={TEST_IDS.screenProfile}>
      <Identity />
      {stats.data ? (
        <Stats stats={stats.data} />
      ) : stats.isError ? (
        <EmptyState
          centered
          testID={TEST_IDS.profileError}
          headline="Couldn't load your stats"
          body={readFailureBody(queryStatus(stats, false).failure)}
        >
          <Button label="Try again" onPress={() => void stats.refetch()} />
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
        <SignOut />
      </View>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { flex: 1, gap: SPACE.s1 },
  stats: { gap: SPACE.s2 },
  card: { padding: SPACE.s4, borderRadius: RADIUS.card, borderWidth: HAIRLINE, gap: SPACE.s1 },
  tiles: { flexDirection: "row", gap: SPACE.s2 },
  stacked: { flexDirection: "column" },
  tile: { flex: 1 },
});
