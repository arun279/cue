import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { type Href, Link, Stack } from "expo-router";
import { memo, type ReactElement, useCallback, useLayoutEffect, useRef } from "react";
import { type AccessibilityRole, Platform, StyleSheet, View } from "react-native";
import { MoreMenuButton } from "./MoreMenuButton";
import { HEADER_TINT } from "./navigation-theme";
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

declare module "expo-router/build/layouts/stack-utils/toolbar/StackToolbarMenu/types" {
  interface StackToolbarMenuProps {
    readonly testID?: string;
  }
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

export type RowMenuProps = MenuBase &
  (
    | { readonly children?: ReactElement; readonly item?: undefined }
    | {
        readonly children: (trigger: ReactElement | null, itemTestID?: string) => ReactElement;
        readonly item: ListItem;
      }
  );

const UNAVAILABLE = Platform.OS === "ios" ? "hidden" : "disabled";

const destructiveLast = (items: readonly RowMenuItem[]): RowMenuItem[] =>
  [...items].sort((a, b) => Number(a.destructive === true) - Number(b.destructive === true));

const actionsOf = (items: readonly RowMenuItem[]): MenuAction[] =>
  destructiveLast(items).map(
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
  );

const select = (items: readonly RowMenuItem[], id: string): void =>
  items.find((item) => item.id === id)?.onPress();

type HeaderMenuProps = Pick<MenuBase, "title" | "items"> & { readonly testID: string };

export function HeaderMenu({ title, items, testID }: HeaderMenuProps): ReactElement {
  const latest = useRef(items);
  useLayoutEffect(() => {
    latest.current = items;
  });
  const onSelect = useCallback((id: string) => select(latest.current, id), []);
  return <HeaderMenuItems title={title} items={items} testID={testID} onSelect={onSelect} />;
}

const lookOf = ({ title, items, testID }: HeaderMenuProps): string =>
  JSON.stringify([title, testID, items.map(({ onPress: _, ...look }) => look)]);

const HeaderMenuItems = memo(
  function HeaderMenuItems({
    title,
    items,
    testID,
    onSelect,
  }: HeaderMenuProps & { onSelect(id: string): void }): ReactElement {
    const colors = useColors();
    if (Platform.OS === "android")
      return (
        <Stack.Toolbar placement="right" asChild>
          <MoreMenuButton
            title={title}
            testID={testID}
            actions={actionsOf(items)}
            onSelect={onSelect}
            color={colors[HEADER_TINT]}
          />
        </Stack.Toolbar>
      );
    return (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon="ellipsis"
          accessibilityLabel={`More actions for ${title}`}
          testID={testID}
          title={title}
        >
          {destructiveLast(items).map((item) => (
            <Stack.Toolbar.MenuAction
              key={item.id}
              icon={item.image}
              isOn={item.selected}
              destructive={item.destructive}
              {...(item.available === false ? { [UNAVAILABLE]: true } : {})}
              onPress={() => onSelect(item.id)}
            >
              {item.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    );
  },
  (previous, next) => lookOf(previous) === lookOf(next),
);

export function RowMenu(props: RowMenuProps): ReactElement {
  const { title, items, testID } = props;
  if (props.item === undefined)
    return props.children === undefined && Platform.OS === "android" ? (
      <More title={title} items={items} testID={testID} />
    ) : (
      <MenuView
        title={title}
        testID={testID}
        actions={actionsOf(items)}
        onPressAction={({ nativeEvent }) => select(items, nativeEvent.event)}
        shouldOpenOnLongPress={false}
      >
        {props.children ?? <MoreIcon title={title} />}
      </MenuView>
    );
  if (Platform.OS === "ios")
    return (
      <LinkMenu title={title} items={items} item={props.item}>
        {props.children(null)}
      </LinkMenu>
    );
  return props.children(<More title={title} items={items} testID={testID} />, props.item.testID);
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

// A link with a menu drops its trigger from the accessibility tree (expo/expo#46875), so this
// wrapper is the item's accessible element; the item keeps its own press.
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

function More({ title, items, testID }: MenuBase): ReactElement {
  const colors = useColors();
  return (
    <MoreMenuButton
      title={title}
      testID={testID}
      actions={actionsOf(items)}
      onSelect={(id) => select(items, id)}
      color={colors.ink2}
      style={styles.trigger}
    />
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
  trigger: {
    flexShrink: 0,
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
