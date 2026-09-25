import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Button } from "../../src/ui/Button";
import { barOptions } from "../../src/ui/navigation-theme";
import { SnackbarHost } from "../../src/ui/SnackbarHost";
import { TEST_IDS } from "../../src/ui/test-ids";
import { useColors } from "../../src/ui/tokens";

/**
 * Profile, Settings and History as one full-screen modal stack over the tabs.
 *
 * The presentation is declared where the group is presented, in the root stack.
 * A modal rather than a route inside whichever tab happened to be selected,
 * because a modal always has a real parent and always dismisses back to exactly
 * where the user was. Full-screen rather than the default, because expo-router's
 * `"modal"` resolves to a page sheet on iOS, and this is a task area with three
 * screens and its own back stack rather than a scoped peek at the parent; it
 * would also make the month-jump sheet inside History a sheet over a sheet.
 *
 * `initialRouteName` builds Profile under a cold deep link into Settings or
 * History, preserving a real back destination.
 */
export const unstable_settings = { initialRouteName: "profile" };

export default function AccountLayout(): ReactElement {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={styles.root}>
      {/* Every account screen scrolls, so on iOS its bar floats over the
          content and the scroll view insets itself below it. */}
      <Stack screenOptions={{ ...barOptions(colors.bg), headerTransparent: Platform.OS === "ios" }}>
        <Stack.Screen
          name="profile"
          options={{
            title: "Profile",
            headerRight: () => (
              <Button
                label="Done"
                variant="link"
                testID={TEST_IDS.closeAccount}
                onPress={() => router.dismissAll()}
              />
            ),
          }}
        />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="history" options={{ title: "History" }} />
        {/* Movie detail's states are not all scroll views, so its bar stays in
            the layout rather than floating over artwork. */}
        <Stack.Screen
          name="movie/[movieId]"
          options={{ title: "Movie", headerTransparent: false }}
        />
        <Stack.Screen
          name="show/[showId]/episode/[season]/[episode]"
          options={{
            presentation: "formSheet",
            headerShown: false,
            sheetAllowedDetents: [0.65, 0.92],
            sheetGrabberVisible: true,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </Stack>
      <SnackbarHost placement="presentation" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
