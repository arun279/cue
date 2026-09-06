import { MenuView } from "@expo/ui/community/menu";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { TARGET_MIN, useColors } from "./tokens";

const DOT_R = 1.9;
const GLYPH = 20;

interface RowMenuItem {
  readonly id: string;
  readonly label: string;
  /** Unavailable items are hidden on iOS and disabled on Android, because the
   * platforms answer this in opposite directions: an iOS context menu "displays
   * only the actions that are relevant", and Compose's `DropdownMenuItem` takes
   * an `enabled` parameter for exactly this. */
  readonly available?: boolean;
  readonly onPress: () => void;
}

export interface RowMenuProps {
  /** The subject, which the menu titles itself with and the trigger is named for. */
  readonly title: string;
  readonly items: readonly RowMenuItem[];
  readonly testID?: string;
}

/**
 * The quick actions for one row, in the platform's own menu: a SwiftUI menu on
 * iOS and a Compose `DropdownMenu` on Android.
 *
 * It exists because the plain queue row had no non-gesture path to Stop from Up
 * Next at all, which is a WCAG 2.5.1 gap, and because a context menu's items
 * have to be reachable from the main interface too.
 */
export function RowMenu({ title, items, testID }: RowMenuProps): ReactElement {
  const colors = useColors();
  const byId = new Map(items.map((item) => [item.id, item.onPress]));
  const unavailable = Platform.OS === "ios" ? "hidden" : "disabled";

  return (
    <MenuView
      title={title}
      testID={testID}
      actions={items.map((item) => ({
        id: item.id,
        title: item.label,
        attributes: item.available === false ? { [unavailable]: true } : undefined,
      }))}
      onPressAction={({ nativeEvent }) => byId.get(nativeEvent.event)?.()}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${title}`}
        style={styles.trigger}
      >
        <Svg width={GLYPH} height={GLYPH} viewBox="0 0 24 24">
          {[5, 12, 19].map((offset) => (
            <Circle
              key={offset}
              cx={Platform.OS === "ios" ? offset : 12}
              cy={Platform.OS === "ios" ? 12 : offset}
              r={DOT_R}
              fill={colors.muted}
            />
          ))}
        </Svg>
      </View>
    </MenuView>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexShrink: 0,
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
