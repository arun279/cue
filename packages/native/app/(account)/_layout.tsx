import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AppIdle } from "../../src/ui/harness";
import { barOptions, TRANSPARENT_SCREEN, useOpaqueScreen } from "../../src/ui/navigation-theme";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { useColors } from "../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "profile" };

export default function AccountLayout(): ReactElement {
  const router = useRouter();
  const colors = useColors();
  const opaque = useOpaqueScreen();

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ ...barOptions, ...opaque, headerTransparent: Platform.OS === "ios" }}>
        <Stack.Screen
          name="profile"
          options={{
            ...TRANSPARENT_SCREEN,
            title: "Profile",
            ...(Platform.OS === "android" && {
              headerBackIcon: { type: "image", source: { uri: "cue_header_close" } },
            }),
          }}
        >
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
        <Stack.Screen name="show/[showId]" options={{ title: "Show", headerTransparent: false }} />
        <Stack.Screen
          name="movie/[movieId]"
          options={{ title: "Movie", headerTransparent: false }}
        />
      </Stack>
      <SnackbarHost placement="presentation" />
      <AppIdle />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
