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
const INDICATOR_SIZE = Platform.OS === "ios" ? 15 : ICON_SIZE;

const SYMBOL_REPLACE: ImageProps["transition"] = { effect: "sf:replace", duration: 200 };

export interface PlatformIconProps {
  readonly name: IconName;
  readonly color: ColorValue;
  readonly indicator?: boolean;
  readonly testID?: string;
}

export function PlatformIcon({
  name,
  color,
  indicator = false,
  testID,
}: PlatformIconProps): ReactElement {
  const size = indicator ? INDICATOR_SIZE : ICON_SIZE;
  if (Platform.OS === "ios")
    return (
      <SymbolImage
        testID={testID}
        source={`sf:${SYMBOLS[name]}`}
        transition={SYMBOL_REPLACE}
        accessible={false}
        style={{ width: size, height: size, color, fontWeight: indicator ? "600" : undefined }}
      />
    );
  return (
    <Image
      testID={testID}
      source={DRAWABLES?.[name]}
      accessible={false}
      style={{ width: size, height: size, tintColor: color }}
    />
  );
}
