import type { ReactElement } from "react";
import Svg, { Path } from "react-native-svg";
import { useColors } from "./tokens";

const SIZE = 20;

const PATH = {
  up: "M6 14.5 12 8.5 18 14.5",
  down: "M6 9.5 12 15.5 18 9.5",
  forward: "M9.5 6 15.5 12 9.5 18",
} as const;

export interface ChevronProps {
  readonly direction: keyof typeof PATH;
}

/** The disclosure mark, in the one shape and weight the app draws it. */
export function Chevron({ direction }: ChevronProps): ReactElement {
  const colors = useColors();

  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      <Path
        d={PATH[direction]}
        fill="none"
        stroke={colors.muted}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
