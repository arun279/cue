import {
  type MenuAction,
  type MenuComponentProps,
  type MenuComponentRef,
  MenuView,
} from "@expo/ui/community/menu";
import { type Href, Link, Stack } from "expo-router";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { type AccessibilityRole, Platform, Pressable, StyleSheet, View } from "react-native";
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

interface ListItem {
  readonly href: Href;
  readonly label: string;
  readonly testID?: string;
  readonly role?: AccessibilityRole;
}

interface MenuBase {
  readonly title: string;
  readonly items: readonly RowMenuItem[];
  readonly testID?: string;
}

/**
 * An element child is the trigger of a tap menu; without one the trigger is the platform's more
 * icon. A function child makes a list item's menu: iOS
 * opens it by long press on the item, Android passes the more icon for the item to place, with
 * the id the item's own element keeps.
 */
export type RowMenuProps = MenuBase &
  (
    | { readonly children?: ReactElement; readonly item?: undefined }
    | {
        readonly children: (trigger: ReactElement | null, itemTestID?: string) => ReactElement;
        readonly item: ListItem;
      }
  );

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

export function RowMenu(props: RowMenuProps): ReactElement {
  const { title, items, testID } = props;
  if (props.item === undefined)
    return props.children === undefined && Platform.OS === "android" ? (
      <MoreButton title={title} items={items} testID={testID} />
    ) : (
      <MenuView {...menuProps(title, items, testID)} shouldOpenOnLongPress={false}>
        {props.children ?? <MoreIcon title={title} />}
      </MenuView>
    );
  if (Platform.OS === "ios")
    return (
      <LinkMenu title={title} items={items} item={props.item}>
        {props.children(null)}
      </LinkMenu>
    );
  return props.children(
    <MoreButton title={title} items={items} testID={testID} />,
    props.item.testID,
  );
}

type MenuProps = Pick<MenuComponentProps, "title" | "testID" | "actions" | "onPressAction">;

function menuProps(title: string, items: readonly RowMenuItem[], testID?: string): MenuProps {
  const byId = new Map(items.map((item) => [item.id, item.onPress]));
  return {
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
}

export function itemActions(
  items: readonly Pick<RowMenuItem, "id" | "label" | "available" | "onPress">[],
) {
  const available = items.filter((item) => item.available !== false);
  return {
    accessibilityActions: available.map(({ id, label }) => ({ name: id, label })),
    onAccessibilityAction: ({ nativeEvent }: { nativeEvent: { actionName: string } }) =>
      available.find((item) => item.id === nativeEvent.actionName)?.onPress(),
  };
}

/**
 * The system context menu on iOS: a UIKit interaction that expo-router's link attaches to the
 * item, rather than a SwiftUI host per row (expo/expo#47883, expo/expo#49528). The link's own
 * navigation is unused; the item keeps its press. A link with a menu drops its trigger from the
 * accessibility tree (expo/expo#46875), so this wrapper is the item's accessible element.
 */
function LinkMenu({
  title,
  items,
  item: { href, label, testID, role = "button" },
  children,
}: Pick<MenuBase, "title" | "items"> & {
  readonly item: ListItem;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <View
      accessible
      accessibilityRole={role}
      accessibilityLabel={label}
      testID={testID}
      {...itemActions(items)}
    >
      <Link href={href} asChild>
        <Link.Trigger>
          <View
            collapsable={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {children}
          </View>
        </Link.Trigger>
        <Link.Menu title={title}>
          {destructiveLast(items).map((entry) => (
            <Link.MenuAction
              key={entry.id}
              destructive={entry.destructive}
              hidden={entry.available === false}
              onPress={entry.onPress}
            >
              {entry.label}
            </Link.MenuAction>
          ))}
        </Link.Menu>
      </Link>
    </View>
  );
}

// The dropdown mounts only while it is open, so a list carries no menu host per row.
function MoreButton({ title, items, testID }: MenuBase): ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const ref = useRef<MenuComponentRef>(null);
  useEffect(() => {
    if (open) ref.current?.show();
  }, [open]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`More actions for ${title}`}
      android_ripple={RIPPLE}
      testID={testID}
      onPress={() => setOpen(true)}
      style={styles.trigger}
    >
      <PlatformIcon name="more" color={colors.ink2} />
      {open ? (
        <MenuView
          ref={ref}
          {...menuProps(title, items)}
          shouldOpenOnLongPress={false}
          onCloseMenu={() => setOpen(false)}
          style={styles.anchor}
        >
          <View style={styles.anchorTarget} />
        </MenuView>
      ) : null}
    </Pressable>
  );
}

function MoreIcon({ title }: Pick<MenuBase, "title">): ReactElement {
  const colors = useColors();
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`More actions for ${title}`}
      style={styles.trigger}
    >
      <PlatformIcon name="more" color={colors.ink2} />
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: "absolute", top: 0, right: 0 },
  anchorTarget: { width: 1, height: 1 },
  trigger: {
    flexShrink: 0,
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
