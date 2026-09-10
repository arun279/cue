import { userProfileQuery, userStatsQuery } from "@cue/core/queries/user";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { TEST_IDS } from "../../src/ui/test-ids";

/** Profile: the account the session belongs to, and the two ways out of it. */
export default function Profile(): ReactElement {
  const runtime = useRuntime();
  const profile = useQuery(userProfileQuery(runtime)).data;
  const stats = useQuery(userStatsQuery(runtime)).data;

  return (
    <View testID={TEST_IDS.screenProfile}>
      <Text accessibilityRole="header">{profile?.displayName ?? "Profile"}</Text>
      {stats !== undefined && (
        <Text
          testID={TEST_IDS.profileEpisodeCount}
        >{`${stats.episodes.watched} episodes watched`}</Text>
      )}
      <Link href="/history" testID={TEST_IDS.profileToHistory}>
        History
      </Link>
      <Link href="/settings" testID={TEST_IDS.profileToSettings}>
        Settings
      </Link>
    </View>
  );
}
