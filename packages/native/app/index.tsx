import type { ReactElement } from "react";
import { Text, View } from "react-native";

/** The scaffold's one screen, so the router has a route. The composition root
 * and the tab tree replace it. */
export default function Index(): ReactElement {
  return (
    <View>
      <Text accessibilityRole="header">Cue</Text>
    </View>
  );
}
