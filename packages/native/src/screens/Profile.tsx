import { useStats } from "@cue/core/hooks/useStats";
import { useUserProfile } from "@cue/core/hooks/useUserProfile";
import { Link } from "expo-router";
import type { ReactElement } from "react";
import { Text, View } from "react-native";

/** Profile: the account the session belongs to, and the two ways out of it. */
export function Profile(): ReactElement {
  const profile = useUserProfile();
  const { stats } = useStats();

  return (
    <View testID="screen-profile">
      <Text accessibilityRole="header">{profile?.displayName ?? "Profile"}</Text>
      {stats !== undefined && (
        <Text testID="profile-episode-count">{`${stats.episodes.watched} episodes watched`}</Text>
      )}
      <Link href="/history" testID="profile-to-history">
        History
      </Link>
      <Link href="/settings" testID="profile-to-settings">
        Settings
      </Link>
    </View>
  );
}
