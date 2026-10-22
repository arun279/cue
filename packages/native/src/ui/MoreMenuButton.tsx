import { type MenuAction, type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  type ColorValue,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { PlatformIcon } from "./PlatformIcon";
import { TARGET_MIN } from "./tokens";

const RIPPLE = { borderless: true, radius: TARGET_MIN / 2 } as const;

export interface MoreMenuButtonProps {
  readonly title: string;
  readonly actions: MenuAction[];
  onSelect(id: string): void;
  readonly color: ColorValue;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

// Android's dropdown is a Compose host, so it mounts only while the menu is open.
export function MoreMenuButton({
  title,
  actions,
  onSelect,
  color,
  testID,
  style,
}: MoreMenuButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const menu = useRef<MenuComponentRef>(null);
  useEffect(() => {
    if (open) menu.current?.show();
  }, [open]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`More actions for ${title}`}
      android_ripple={RIPPLE}
      testID={testID}
      onPress={() => setOpen(true)}
      style={[styles.trigger, style]}
    >
      <PlatformIcon name="more" color={color} />
      {open ? (
        <MenuView
          ref={menu}
          title={title}
          actions={actions}
          onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}
          onCloseMenu={() => setOpen(false)}
          style={styles.anchor}
        >
          <View style={styles.anchorTarget} />
        </MenuView>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  anchor: { position: "absolute", top: 0, right: 0 },
  anchorTarget: { width: 1, height: 1 },
});
