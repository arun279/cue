import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { SnackbarHost } from "../../src/ui/SnackbarHost";

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
 * `initialRouteName` is what builds Profile under a cold deep link into Settings
 * or History, which is what deletes the web app's per-route back fallbacks.
 */
export const unstable_settings = { initialRouteName: "profile" };

export default function AccountLayout(): ReactElement {
  return (
    <View style={styles.root}>
      <Stack>
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="history" options={{ title: "History" }} />
      </Stack>
      <SnackbarHost placement="presentation" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
