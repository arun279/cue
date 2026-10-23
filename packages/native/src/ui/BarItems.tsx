import { Stack, useRouter } from "expo-router";
import { memo, type ReactElement } from "react";
import { type ColorValue, Platform, Pressable, StyleSheet } from "react-native";
import { Avatar } from "./Avatar";
import { MoreMenuButton } from "./MoreMenuButton";
import { HEADER_TINT } from "./navigation-theme";
import { actionsOf, lookOf, type ToolbarMenuProps, toolbarMenu, useSelectLatest } from "./RowMenu";
import { TEST_IDS } from "./test-ids";
import { TARGET_MIN, useColors } from "./tokens";

const AVATAR = 32;

export const BarItems = memo(function BarItems({
  menu,
}: {
  readonly menu?: ToolbarMenuProps;
}): ReactElement {
  const onSelect = useSelectLatest(menu?.items ?? []);
  return <Items menu={menu} onSelect={onSelect} />;
});

const Items = memo(
  function Items({
    menu,
    onSelect,
  }: {
    readonly menu: ToolbarMenuProps | undefined;
    onSelect(id: string): void;
  }): ReactElement {
    const colors = useColors();
    return (
      <Stack.Toolbar placement="right">
        {menu === undefined ? null : menuItem(menu, onSelect, colors[HEADER_TINT])}
        <Stack.Toolbar.View>
          <AvatarLink />
        </Stack.Toolbar.View>
      </Stack.Toolbar>
    );
  },
  (previous, next) =>
    (previous.menu === undefined ? "" : lookOf(previous.menu)) ===
    (next.menu === undefined ? "" : lookOf(next.menu)),
);

function menuItem(
  menu: ToolbarMenuProps,
  onSelect: (id: string) => void,
  color: ColorValue,
): ReactElement {
  if (Platform.OS === "ios") return toolbarMenu(menu, onSelect);
  return (
    <Stack.Toolbar.View>
      <MoreMenuButton
        title={menu.title}
        label={menu.label}
        icon={menu.icon}
        testID={menu.testID}
        actions={actionsOf(menu.items)}
        onSelect={onSelect}
        color={color}
      />
    </Stack.Toolbar.View>
  );
}

function AvatarLink(): ReactElement {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      testID={TEST_IDS.avatarLink}
      onPress={() => router.push("/profile")}
      style={styles.target}
    >
      <Avatar size={AVATAR} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
