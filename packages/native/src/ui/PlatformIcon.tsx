import { type ImageProps, Image as SymbolImage } from "expo-image";
import type { ReactElement } from "react";
import { type ColorValue, Image, Platform } from "react-native";

const SYMBOLS = {
  checked: "checkmark.circle.fill",
  unchecked: "circle",
  more: "ellipsis",
  external: "arrow.up.right",
  expand: "chevron.down",
  search: "magnifyingglass",
  close: "xmark",
} as const;

type IconName = keyof typeof SYMBOLS;

const DRAWABLES: Record<IconName, number> | null =
  Platform.OS === "android"
    ? {
        checked: require("./check-circle.xml"),
        unchecked: require("./check-circle-outline.xml"),
        more: require("./more-vert.xml"),
        external: require("./open-in-new.xml"),
        expand: require("./expand-more.xml"),
        search: require("./search.xml"),
        close: require("./close.xml"),
      }
    : null;

const ICON_SIZE = Platform.OS === "ios" ? 22 : 24;

const SYMBOL_REPLACE: ImageProps["transition"] = { effect: "sf:replace", duration: 200 };

export interface PlatformIconProps {
  readonly name: IconName;
  readonly color: ColorValue;
  readonly testID?: string;
}

export function PlatformIcon({ name, color, testID }: PlatformIconProps): ReactElement {
  if (Platform.OS === "ios")
    return (
      <SymbolImage
        testID={testID}
        source={`sf:${SYMBOLS[name]}`}
        transition={SYMBOL_REPLACE}
        accessible={false}
        style={{ width: ICON_SIZE, height: ICON_SIZE, color }}
      />
    );
  return (
    <Image
      testID={testID}
      source={DRAWABLES?.[name]}
      accessible={false}
      style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: color }}
    />
  );
}
