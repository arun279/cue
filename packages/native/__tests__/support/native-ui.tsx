/**
 * Stand-ins for the three platform edges a screen test cannot drive: the router,
 * the platform menu, and the swipeable's own pan gesture.
 *
 * Each one keeps the library's documented contract and nothing more, so a test
 * over them is a test of Cue's wiring rather than of the library. The libraries
 * themselves are proved on a simulator, where there is a layout and a finger.
 */

import type { ReactElement, ReactNode } from "react";
import { TEST_IDS } from "../../src/ui/test-ids";

export const router = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  dismissTo: jest.fn(),
};

/** The drag the last-rendered swipeable reports, so a test can move a row the
 * way a finger does and watch what the reveal makes of it. */
export const drag: { translation: { value: number } | null } = { translation: null };

interface ScreenProps {
  readonly options?: {
    readonly headerSearchBarOptions?: {
      readonly placeholder?: string;
      onChangeText?(event: { nativeEvent: { text: string } }): void;
    };
  };
}

/** The testID both search fields answer to: Android's, which the screen draws
 * itself, and the stand-in below for iOS's header field, which takes no
 * `testID` of its own. That is why the iOS flows reach it by its placeholder
 * and why a screen test needs a stand-in at all. */
export const SEARCH_FIELD = TEST_IDS.searchField;

export function expoRouterModule() {
  const { createElement } = require("react") as typeof import("react");
  const { Text, TextInput } = require("react-native") as typeof import("react-native");
  const Stack = (): null => null;
  // `headerSearchBarOptions` is a UISearchController, which this runner does not
  // have. The stand-in is a plain field carrying the same placeholder and the
  // same change callback, so a test types what a finger types and nothing else
  // about the screen is stubbed.
  Stack.Screen = ({ options }: ScreenProps): ReactElement | null => {
    const bar = options?.headerSearchBarOptions;
    if (bar === undefined) return null;
    return createElement(TextInput, {
      testID: SEARCH_FIELD,
      placeholder: bar.placeholder,
      onChangeText: (text: string) => bar.onChangeText?.({ nativeEvent: { text } }),
    });
  };
  // The two library themes are data the app reads and reshapes, so the mock
  // carries the shape rather than a stand-in: a theme missing its colors is a
  // crash at the root rather than a wrong color.
  const theme = (dark: boolean) => ({
    dark,
    colors: {
      primary: "",
      background: "",
      card: "",
      text: "",
      border: "",
      notification: "",
    },
    fonts: {},
  });
  return {
    Stack,
    Link: Text,
    useRouter: () => router,
    DarkTheme: theme(true),
    DefaultTheme: theme(false),
    ThemeProvider: ({ children }: { readonly children: ReactNode }) => children,
  };
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
            testID: action.id ?? action.title,
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

/** The three platform edges every perf harness stubs the same way: the pull
 * gesture, the preference backing store, and the window insets. */
export function pullToRefreshModule() {
  return { usePullToRefresh: () => ({ pull: jest.fn(), refreshing: false, sync: jest.fn() }) };
}

export function preferenceStorageModule() {
  return {
    preferenceStorage: { getItem: () => null, setItem: jest.fn(), clearNamespace: jest.fn() },
  };
}

export function safeAreaModule() {
  return { useSafeAreaInsets: () => ({ bottom: 0 }) };
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
