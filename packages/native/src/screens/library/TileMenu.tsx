import { type Href, Link } from "expo-router";
import { cloneElement, type ReactElement } from "react";
import { type AccessibilityActionEvent, Platform, StyleSheet, View } from "react-native";
import { MoreMenuButton } from "../../ui/MoreMenuButton";
import { TEST_IDS } from "../../ui/test-ids";
import { TARGET_MIN, useColors } from "../../ui/tokens";

export interface TileAction {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  onPress(): void;
}

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

export function TileMore({
  title,
  actions,
}: {
  readonly title: string;
  readonly actions: readonly TileAction[];
}): ReactElement | null {
  const colors = useColors();
  if (Platform.OS !== "android" || actions.length === 0) return null;
  return (
    <MoreMenuButton
      title={title}
      color={colors.ink2}
      testID={TEST_IDS.quickActions}
      actions={actions.map((action) => ({ id: action.id, title: action.label }))}
      onSelect={(id) => actions.find((action) => action.id === id)?.onPress()}
      style={styles.more}
    />
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
  more: { marginTop: -INSET, marginRight: -INSET },
});
