import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { Button } from "../../ui/Button";
import { useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function Overview({ text }: { readonly text: string | null }): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const colors = useColors();
  if (text === null) return null;
  const long = text.length > 240;
  return (
    <View>
      <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
        {long && !expanded ? `${text.slice(0, 240).trimEnd()}…` : text}
      </CueText>
      {long && (
        <Button
          label={expanded ? "Less" : "More"}
          variant="link"
          onPress={() => setExpanded(!expanded)}
        />
      )}
    </View>
  );
}
