import type { ReactElement } from "react";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/** Stroked paths on a 24-unit grid, shared by every control that draws one. */
export const GLYPH = {
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14M16 16l4 4",
  close: "M6 6l12 12M18 6L6 18",
} as const;

export function Glyph({
  path,
  color,
  size = 22,
}: {
  readonly path: string;
  readonly color: ColorValue;
  readonly size?: number;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
