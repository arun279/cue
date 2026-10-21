import { type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import { type Href, Link } from "expo-router";
import { cloneElement, type ReactElement, useEffect, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { TEST_IDS } from "../../ui/test-ids";
import { TARGET_MIN, useColors } from "../../ui/tokens";

export interface TileAction {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  onPress(): void;
}

const MORE = Platform.OS === "android" ? require("../../ui/more-vert.xml") : null;
const ICON = 24;
const INSET = (TARGET_MIN - ICON) / 2;

interface TileContent {
  readonly testID?: string;
  readonly label: string;
}

// On iOS the actions are the system context menu: a UIKit interaction on the link,
// not a hosted SwiftUI view per tile.
export function TileLink({
  href,
  title,
  actions,
  children,
}: {
  readonly href: Href;
  readonly title: string;
  readonly actions: readonly TileAction[];
  readonly children: ReactElement<TileContent>;
}): ReactElement {
  if (Platform.OS !== "ios" || actions.length === 0)
    return <MenuLink href={href} title={title} actions={actions} trigger={children} />;
  // A link with a menu drops its trigger from the iOS accessibility tree (expo/expo#46875),
  // so the tile is exposed by a wrapper that VoiceOver activates through to the link.
  return (
    <View
      accessible
      accessibilityRole="link"
      accessibilityLabel={children.props.label}
      testID={children.props.testID}
      {...tileActionProps(actions)}
    >
      <MenuLink
        href={href}
        title={title}
        actions={actions}
        trigger={cloneElement(children, { testID: undefined })}
      />
    </View>
  );
}

function MenuLink({
  href,
  title,
  actions,
  trigger,
}: {
  readonly href: Href;
  readonly title: string;
  readonly actions: readonly TileAction[];
  readonly trigger: ReactElement;
}): ReactElement {
  return (
    <Link href={href} push asChild>
      <Link.Trigger>{trigger}</Link.Trigger>
      {actions.length === 0 ? null : (
        <Link.Menu title={title}>
          {actions.map((action) => (
            <Link.MenuAction
              key={action.id}
              destructive={action.destructive}
              onPress={action.onPress}
            >
              {action.label}
            </Link.MenuAction>
          ))}
        </Link.Menu>
      )}
    </Link>
  );
}

// The dropdown mounts only while open, so the grid carries no Compose host per tile.
export function TileMore({
  title,
  actions,
}: {
  readonly title: string;
  readonly actions: readonly TileAction[];
}): ReactElement | null {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const menu = useRef<MenuComponentRef>(null);
  useEffect(() => {
    if (open) menu.current?.show();
  }, [open]);

  if (Platform.OS !== "android" || actions.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`More actions for ${title}`}
      onPress={() => setOpen(true)}
      style={styles.more}
    >
      <Image source={MORE} style={[styles.icon, { tintColor: colors.ink2 }]} />
      {open ? (
        <MenuView
          ref={menu}
          testID={TEST_IDS.quickActions}
          title={title}
          actions={actions.map((action) => ({ id: action.id, title: action.label }))}
          onPressAction={({ nativeEvent }) =>
            actions.find((action) => action.id === nativeEvent.event)?.onPress()
          }
          onCloseMenu={() => setOpen(false)}
          style={styles.anchor}
        >
          <View style={styles.anchorTarget} />
        </MenuView>
      ) : null}
    </Pressable>
  );
}

export function tileActionProps(actions: readonly TileAction[]) {
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions.map((action) => ({ name: action.id, label: action.label })),
    onAccessibilityAction: ({ nativeEvent }: AccessibilityActionEvent) =>
      actions.find((action) => action.id === nativeEvent.actionName)?.onPress(),
  };
}

const styles = StyleSheet.create({
  more: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    marginTop: -INSET,
    marginRight: -INSET,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { width: ICON, height: ICON },
  anchor: { position: "absolute", top: 0, right: 0 },
  anchorTarget: { width: 1, height: 1 },
});
