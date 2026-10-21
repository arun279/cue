import {
  type MenuAction,
  type MenuComponentProps,
  type MenuComponentRef,
  MenuView,
} from "@expo/ui/community/menu";
import { Stack } from "expo-router";
import { type ReactElement, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { PlatformIcon } from "./PlatformIcon";
import { TARGET_MIN, useColors } from "./tokens";

export interface RowMenuItem {
  readonly id: string;
  readonly label: string;
  // iOS context menus hide unavailable actions; Compose's DropdownMenuItem disables them.
  readonly available?: boolean;
  readonly onPress: () => void;
  readonly destructive?: boolean;
  readonly image?: MenuAction["image"];
  readonly selected?: boolean;
}

export interface RowMenuProps {
  readonly title: string;
  readonly items: readonly RowMenuItem[];
  readonly testID?: string;
  readonly children?: ReactElement | ((trigger: ReactElement | null) => ReactElement);
  readonly contentWidth?: number;
}

const UNAVAILABLE = Platform.OS === "ios" ? "hidden" : "disabled";
const RIPPLE = { borderless: true, radius: TARGET_MIN / 2 } as const;

const destructiveLast = (items: readonly RowMenuItem[]): RowMenuItem[] =>
  [...items].sort((a, b) => Number(a.destructive === true) - Number(b.destructive === true));

export function HeaderMenu({ title, items }: Pick<RowMenuProps, "title" | "items">): ReactElement {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        icon={Platform.OS === "ios" ? "ellipsis" : require("./more-vert.xml")}
        accessibilityLabel={`More actions for ${title}`}
        title={title}
      >
        {destructiveLast(items).map((item) => (
          <Stack.Toolbar.MenuAction
            key={item.id}
            icon={item.image}
            isOn={item.selected}
            destructive={item.destructive}
            {...(item.available === false ? { [UNAVAILABLE]: true } : {})}
            onPress={item.onPress}
          >
            {item.label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

export function RowMenu({
  title,
  items,
  testID,
  children,
  contentWidth,
}: RowMenuProps): ReactElement {
  const byId = new Map(items.map((item) => [item.id, item.onPress]));
  const menu: MenuProps = {
    title,
    testID,
    actions: destructiveLast(items).map(
      (item): MenuAction => ({
        id: item.id,
        title: item.label,
        image: item.image,
        state: item.selected === undefined ? undefined : item.selected ? "on" : "off",
        attributes: {
          ...(item.available === false ? { [UNAVAILABLE]: true } : {}),
          ...(Platform.OS === "ios" && item.destructive ? { destructive: true } : {}),
        },
      }),
    ),
    onPressAction: ({ nativeEvent }) => byId.get(nativeEvent.event)?.(),
  };

  if (typeof children !== "function")
    return children === undefined ? (
      <MoreButton menu={menu} />
    ) : (
      <MenuView {...menu} shouldOpenOnLongPress={false}>
        {children}
      </MenuView>
    );

  if (Platform.OS === "android") return children(<MoreButton menu={menu} />);

  // iOS hosts the content in SwiftUI and sizes it only from its own min and max widths (expo/expo#50216).
  return (
    <MenuView {...menu} shouldOpenOnLongPress>
      <View style={{ minWidth: contentWidth, maxWidth: contentWidth }}>{children(null)}</View>
    </MenuView>
  );
}

type MenuProps = Pick<MenuComponentProps, "title" | "testID" | "actions" | "onPressAction">;

function MoreButton({ menu }: { readonly menu: MenuProps }): ReactElement {
  const colors = useColors();
  const ref = useRef<MenuComponentRef>(null);
  const icon = <PlatformIcon name="more" color={colors.ink2} />;
  const label = `More actions for ${menu.title}`;

  return (
    <MenuView ref={ref} {...menu} shouldOpenOnLongPress={false}>
      {Platform.OS === "android" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          android_ripple={RIPPLE}
          onPress={() => ref.current?.show()}
          style={styles.trigger}
        >
          {icon}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          style={styles.trigger}
        >
          {icon}
        </View>
      )}
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
