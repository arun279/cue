import type { ReactElement } from "react";
import { PlatformIcon } from "./PlatformIcon";
import { useColors } from "./tokens";

const ICON = {
  up: "collapse",
  down: "expand",
  forward: "forward",
  back: "back",
  picker: "picker",
  recall: "recall",
} as const;

export interface ChevronProps {
  readonly direction: keyof typeof ICON;
}

export function Chevron({ direction }: ChevronProps): ReactElement {
  const colors = useColors();
  return <PlatformIcon name={ICON[direction]} color={colors.muted} indicator />;
}
