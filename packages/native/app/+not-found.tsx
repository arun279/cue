import { Link, Stack } from "expo-router";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { TEST_IDS } from "../src/ui/test-ids";

/** Where a deep link nothing matches lands, with a way back into the app. */
export default function NotFound(): ReactElement {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View testID={TEST_IDS.screenNotFound}>
        <Text accessibilityRole="alert">That link doesn't go anywhere in Cue.</Text>
        <Link href="/" testID={TEST_IDS.notFoundHome}>
          Go to Up Next
        </Link>
      </View>
    </>
  );
}
