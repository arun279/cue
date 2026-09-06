import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";

/**
 * A point that draws nothing and carries an id.
 *
 * A zero-sized view has no bounds, so no accessibility hierarchy ever lists it:
 * a launch that stops on one shows an empty tree instead of naming the thing
 * that is holding. A point is the smallest frame a hierarchy dump can find, and
 * it is what makes every wait in this app answerable from outside it.
 */
export function Marker({ testID }: { readonly testID: string }): ReactElement {
  return <View testID={testID} pointerEvents="none" style={styles.marker} />;
}

const styles = StyleSheet.create({
  marker: { position: "absolute", left: 0, bottom: 0, width: 1, height: 1 },
});
