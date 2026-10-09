import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  barOptions,
  useEpisodeSheetOptions,
  useMonthJumpSheetOptions,
} from "../../src/ui/navigation-theme";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { useColors } from "../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "profile" };

export default function AccountLayout(): ReactElement {
  const router = useRouter();
  const sheet = useEpisodeSheetOptions();
  const monthJump = useMonthJumpSheetOptions();
  const colors = useColors();

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ ...barOptions, headerTransparent: Platform.OS === "ios" }}>
        <Stack.Screen name="profile" options={{ title: "Profile" }}>
          {Platform.OS === "ios" && (
            <Stack.Toolbar placement="right">
              <Stack.Toolbar.Button
                variant="done"
                accessibilityLabel="Done"
                tintColor={colors.accent}
                style={{ color: colors.accentFg }}
                onPress={() => router.dismissAll()}
              >
                Done
              </Stack.Toolbar.Button>
            </Stack.Toolbar>
          )}
        </Stack.Screen>
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
