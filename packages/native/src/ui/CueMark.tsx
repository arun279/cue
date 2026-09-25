import type { ReactElement } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { PALETTE, SPACE } from "./tokens";

export function CueMark(): ReactElement {
  return (
    <Svg width={SPACE.s8} height={SPACE.s8} viewBox="0 0 512 512">
      <Rect width={512} height={512} rx={112} fill={PALETTE.bg.dark} />
      <Path
        d="M153.4 169.8A134 134 0 1 1 153.4 342.2"
        fill="none"
        stroke={PALETTE.fg.dark}
        strokeWidth={62}
        strokeLinecap="round"
      />
      <Circle cx={162.8} cy={264} r={44} fill={PALETTE.accent.dark} />
    </Svg>
  );
}
