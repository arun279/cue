import { Image, type ImageProps } from "expo-image";
import type { ReactElement } from "react";
import { type ColorValue, Platform } from "react-native";
import Svg, { Path } from "react-native-svg";

// iOS draws SF Symbols; Android draws the Material Icons path data, as its vector drawables do.
const ICONS = {
  checked: {
    ios: "checkmark.circle.fill",
    android:
      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  },
  unchecked: {
    ios: "circle",
    android:
      "M16.59 7.58L10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
  },
  more: {
    ios: "ellipsis",
    android:
      "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  },
  external: {
    ios: "arrow.up.right",
    android:
      "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  },
  expand: { ios: "chevron.down", android: "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" },
  search: {
    ios: "magnifyingglass",
    android:
      "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  },
  close: {
    ios: "xmark",
    android:
      "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  },
} as const;

type IconName = keyof typeof ICONS;

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
      <Image
        testID={testID}
        source={`sf:${ICONS[name].ios}`}
        transition={SYMBOL_REPLACE}
        accessible={false}
        style={{ width: ICON_SIZE, height: ICON_SIZE, color }}
      />
    );
  return (
    <Svg testID={testID} width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
      <Path d={ICONS[name].android} fill={color} />
    </Svg>
  );
}
