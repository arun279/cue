import type { ReactElement } from "react";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

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
