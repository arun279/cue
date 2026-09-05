import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Button } from "react-native";

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
  const router = useRouter();

  return (
    <Stack>
      <Stack.Screen
        name="profile"
        options={{
          title: "Profile",
          headerRight: () => (
            <Button testID="close-account" title="Done" onPress={() => router.dismissAll()} />
          ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="history" options={{ title: "History" }} />
    </Stack>
  );
}
