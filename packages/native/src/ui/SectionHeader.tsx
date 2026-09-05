import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

interface SectionHeaderAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
}

export interface SectionHeaderProps {
  readonly label: string;
  /** The trailing link, such as Up Next's "Calendar" beside "On the way". */
  readonly action?: SectionHeaderAction;
  readonly testID?: string;
}

/**
 * A section label, and it is a real heading: the rotor and TalkBack's heading
 * navigation traverse these, which is how a screen reader user moves between
 * the parts of a screen instead of swiping through every row of it.
 */
export function SectionHeader({ label, action, testID }: SectionHeaderProps): ReactElement {
  const colors = useColors();

  return (
    <View style={styles.header} testID={testID}>
      <CueText variant="meta" eyebrow accessibilityRole="header" style={{ color: colors.muted }}>
        {label}
      </CueText>
      {action === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testID}
          onPress={action.onPress}
          style={styles.action}
        >
          <CueText
            variant="rowTitleSecondary"
            weight="semibold"
            style={{ color: colors.accentInk }}
          >
            {action.label}
          </CueText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACE.s2,
    minHeight: TARGET_MIN,
  },
  // The ink stays where it is and the target reaches the floor around it, with
  // the negative margin keeping the label optically aligned with the rows below.
  action: {
    minHeight: TARGET_MIN,
    justifyContent: "center",
    paddingHorizontal: SPACE.s2,
    marginRight: -SPACE.s2,
  },
});
