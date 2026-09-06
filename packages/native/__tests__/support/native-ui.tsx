/**
 * Stand-ins for the four platform edges a screen test cannot drive: a
 * virtualized list that never gets a layout pass, the router, the platform menu,
 * and the swipeable's own pan gesture.
 *
 * Each one keeps the library's documented contract and nothing more, so a test
 * over them is a test of Cue's wiring rather than of the library. The libraries
 * themselves are proved on a simulator, where there is a layout and a finger.
 */

import type { ReactElement, ReactNode } from "react";

interface RefreshProps {
  readonly testID?: string;
  readonly refreshing: boolean;
  onRefresh(): void;
}

interface ListProps<T> {
  readonly data?: readonly T[];
  readonly testID?: string;
  readonly refreshControl?: { readonly props: RefreshProps };
  renderItem(info: { item: T; index: number }): ReactNode;
  keyExtractor(item: T, index: number): string;
  readonly ListHeaderComponent?: ReactNode;
  readonly ListFooterComponent?: ReactNode;
  readonly ItemSeparatorComponent?: () => ReactElement;
}

/**
 * Renders every row, because what the screen tests are about is which sections
 * and states are composed, not which of them a window happened to reach.
 *
 * The refresh control comes back as a plain view carrying its own props: the
 * platform control renders as a native `RCTRefreshControl` that keeps none of
 * them, so a test could otherwise neither find it nor release a pull on it.
 */
export function flashListModule() {
  const { createElement, Fragment } = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  function FlashList<T>(props: ListProps<T>): ReactElement {
    const { data = [], ItemSeparatorComponent } = props;
    return createElement(
      View,
      { testID: props.testID },
      props.refreshControl === undefined
        ? null
        : createElement(View, { ...props.refreshControl.props }),
      props.ListHeaderComponent,
      ...data.map((item, index) =>
        createElement(
          Fragment,
          { key: props.keyExtractor(item, index) },
          index > 0 && ItemSeparatorComponent !== undefined
            ? createElement(ItemSeparatorComponent)
            : null,
          props.renderItem({ item, index }),
        ),
      ),
      props.ListFooterComponent,
    );
  }

  return { FlashList };
}

export const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

/** The drag the last-rendered swipeable reports, so a test can move a row the
 * way a finger does and watch what the reveal makes of it. */
export const drag: { translation: { value: number } | null } = { translation: null };

export function expoRouterModule() {
  const { Text } = require("react-native") as typeof import("react-native");
  const Stack = (): null => null;
  Stack.Screen = (): null => null;
  return { Stack, Link: Text, useRouter: () => router };
}

interface MenuProps {
  readonly title: string;
  readonly testID?: string;
  readonly actions: readonly { id?: string; title: string; attributes?: object }[];
  onPressAction(event: { nativeEvent: { event: string } }): void;
  readonly children: ReactNode;
}

/** The trigger, plus one target per action, so a test can select an item the way
 * a reader does rather than by reaching into the menu's props. */
export function menuModule() {
  const { createElement } = require("react") as typeof import("react");
  const { Pressable, Text, View } = require("react-native") as typeof import("react-native");

  function MenuView(props: MenuProps): ReactElement {
    return createElement(
      View,
      { testID: props.testID },
      props.children,
      ...props.actions.map((action) =>
        createElement(
          Pressable,
          {
            key: action.id ?? action.title,
            testID: `menu-${action.id ?? action.title}`,
            accessibilityLabel: action.title,
            accessibilityState: { disabled: hidden(action) },
            onPress: () =>
              props.onPressAction({ nativeEvent: { event: action.id ?? action.title } }),
          },
          createElement(Text, null, action.title),
        ),
      ),
    );
  }

  return { MenuView };
}

function hidden(action: { attributes?: object }): boolean {
  const attributes = action.attributes as { hidden?: boolean; disabled?: boolean } | undefined;
  return attributes?.hidden === true || attributes?.disabled === true;
}

interface SwipeableProps {
  readonly testID?: string;
  readonly leftThreshold?: number;
  readonly rightThreshold?: number;
  readonly children: ReactNode;
  onSwipeableWillOpen?(direction: string): void;
  onSwipeableOpenStartDrag?(direction: string): void;
  renderLeftActions?(progress: unknown, translation: unknown, methods: unknown): ReactNode;
  renderRightActions?(progress: unknown, translation: unknown, methods: unknown): ReactNode;
}

/**
 * The row, its two reveals, and one target per direction standing in for a
 * release past the threshold.
 *
 * The direction each target reports is the library's own: dragging RIGHT opens
 * the LEFT panel and reports `right`. That inversion is the thing most likely to
 * be read the wrong way round, so the stand-in reproduces it exactly.
 */
export function swipeableModule() {
  const { createElement, Fragment } = require("react") as typeof import("react");
  const { Pressable, View } = require("react-native") as typeof import("react-native");
  const { useSharedValue } = require("react-native-reanimated") as {
    useSharedValue: <T>(value: T) => { value: T };
  };

  function Swipeable(props: SwipeableProps): ReactElement {
    const translation = useSharedValue(0);
    const progress = useSharedValue(0);
    drag.translation = translation;
    const methods = { close: () => {}, openLeft: () => {}, openRight: () => {}, reset: () => {} };
    const release = (direction: string) => () => {
      props.onSwipeableOpenStartDrag?.(direction);
      props.onSwipeableWillOpen?.(direction);
    };

    return createElement(
      View,
      { testID: props.testID },
      createElement(
        Fragment,
        null,
        props.renderLeftActions?.(progress, translation, methods),
        props.renderRightActions?.(progress, translation, methods),
      ),
      props.children,
      createElement(Pressable, {
        testID: `${props.testID}-drag-right`,
        accessibilityLabel: `drag ${props.testID} right past ${props.leftThreshold}`,
        onPress: release("right"),
      }),
      createElement(Pressable, {
        testID: `${props.testID}-drag-left`,
        accessibilityLabel: `drag ${props.testID} left past ${props.rightThreshold}`,
        onPress: release("left"),
      }),
    );
  }

  return {
    __esModule: true,
    default: Swipeable,
    SwipeDirection: { LEFT: "left", RIGHT: "right" },
  };
}
