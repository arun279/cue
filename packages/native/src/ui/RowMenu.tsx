import {
  type MenuAction,
  type MenuComponentProps,
  type MenuComponentRef,
  MenuView,
} from "@expo/ui/community/menu";
import { type ReactElement, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
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
  readonly destructive?: boolean;
  readonly image?: MenuAction["image"];
  /** Draws the platform's own checkmark, which is how a menu states a choice. */
  readonly selected?: boolean;
}

export interface RowMenuProps {
  /** The subject, which the menu titles itself with and the trigger is named for. */
  readonly title: string;
  readonly items: readonly RowMenuItem[];
  readonly testID?: string;
  /** A trigger of the caller's own, long pressed unless it says otherwise. */
  readonly children?: ReactElement;
  readonly openOnLongPress?: boolean;
}

/**
 * The quick actions for one row, in the platform's own menu: a SwiftUI menu on
 * iOS and a Compose `DropdownMenu` on Android.
 *
 * It exists because the plain queue row had no non-gesture path to Stop from Up
 * Next at all, which is a WCAG 2.5.1 gap, and because a context menu's items
 * have to be reachable from the main interface too.
 */
export function RowMenu({
  title,
  items,
  testID,
  children,
  openOnLongPress,
}: RowMenuProps): ReactElement {
  const colors = useColors();
  const byId = new Map(items.map((item) => [item.id, item.onPress]));
  const unavailable = Platform.OS === "ios" ? "hidden" : "disabled";
  const actions: MenuAction[] = [...items]
    .sort((a, b) => Number(a.destructive === true) - Number(b.destructive === true))
    .map(
      (item): MenuAction => ({
        id: item.id,
        title: item.label,
        image: item.image,
        state: item.selected === undefined ? undefined : item.selected ? "on" : "off",
        attributes: {
          ...(item.available === false ? { [unavailable]: true } : {}),
          ...(Platform.OS === "ios" && item.destructive ? { destructive: true } : {}),
        },
      }),
    );
  const onPressAction: NonNullable<MenuComponentProps["onPressAction"]> = ({ nativeEvent }) =>
    byId.get(nativeEvent.event)?.();

  if (Platform.OS === "android" && children !== undefined && openOnLongPress !== false)
    return (
      <AndroidLongPressMenu
        title={title}
        testID={testID}
        actions={actions}
        onPressAction={onPressAction}
      >
        {children}
      </AndroidLongPressMenu>
    );

  return (
    <MenuView
      title={title}
      testID={testID}
      shouldOpenOnLongPress={openOnLongPress ?? children !== undefined}
      actions={actions}
      onPressAction={onPressAction}
    >
      {children ?? (
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
      )}
    </MenuView>
  );
}

function AndroidLongPressMenu({
  title,
  testID,
  actions,
  onPressAction,
  children,
}: Pick<MenuComponentProps, "title" | "testID" | "actions" | "onPressAction"> & {
  readonly children: ReactElement;
}): ReactElement {
  const menu = useRef<MenuComponentRef>(null);
  return (
    <View>
      <Pressable
        accessible={false}
        focusable={false}
        testID={testID === undefined ? undefined : `${testID}-trigger`}
        onLongPress={() => menu.current?.show()}
      >
        {children}
      </Pressable>
      <MenuView
        ref={menu}
        title={title}
        testID={testID}
        actions={actions}
        onPressAction={onPressAction}
        style={styles.menuAnchor}
      >
        <View style={styles.menuAnchorTarget} />
      </MenuView>
    </View>
  );
}

const styles = StyleSheet.create({
  menuAnchor: { position: "absolute", top: 0, right: 0 },
  menuAnchorTarget: { width: 1, height: 1 },
  trigger: {
    flexShrink: 0,
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
