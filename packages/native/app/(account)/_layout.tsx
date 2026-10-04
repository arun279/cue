import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Button } from "../../src/ui/Button";
import {
  barOptions,
  useEpisodeSheetOptions,
  useMonthJumpSheetOptions,
} from "../../src/ui/navigation-theme";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { TEST_IDS } from "../../src/ui/test-ids";

export const unstable_settings = { initialRouteName: "profile" };

export default function AccountLayout(): ReactElement {
  const router = useRouter();
  const sheet = useEpisodeSheetOptions();
  const monthJump = useMonthJumpSheetOptions();

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ ...barOptions, headerTransparent: Platform.OS === "ios" }}>
        <Stack.Screen
          name="profile"
          options={{
            title: "Profile",
            headerRight: () => (
              <Button
                label="Done"
                variant="link"
                bar
                testID={TEST_IDS.closeAccount}
                onPress={() => router.dismissAll()}
              />
            ),
          }}
        />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="history" options={{ title: "History" }} />
        <Stack.Screen name="history-jump" options={monthJump} />
        <Stack.Screen
          name="movie/[movieId]"
          options={{ title: "Movie", headerTransparent: false }}
        />
        <Stack.Screen name="show/[showId]/episode/[season]/[episode]" options={sheet} />
      </Stack>
      <SnackbarHost placement="presentation" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
