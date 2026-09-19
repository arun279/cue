import { type ReactElement, useState } from "react";
import { useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

/** Where a long overview folds: about three lines of the role at the default
 * content size. */
const FOLD = 240;

export function Overview({ text }: { readonly text: string | null }): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const colors = useColors();
  if (text === null) return null;
  const long = text.length > FOLD;
  return (
    <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
      {long && !expanded ? `${text.slice(0, FOLD).trimEnd()}… ` : `${text} `}
      {long && (
        <CueText
          variant="rowTitleSecondary"
          weight="semibold"
          accessibilityRole="button"
          style={{ color: colors.accentInk }}
          onPress={() => setExpanded(!expanded)}
        >
          {expanded ? "Less" : "More"}
        </CueText>
      )}
    </CueText>
  );
}
