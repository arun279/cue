import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge } from "../../ui/Badge";
import { PlatformIcon } from "../../ui/PlatformIcon";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export interface LapsedHeaderProps {
  readonly count: number;
  readonly expanded: boolean;
  onToggle(): void;
}

export function LapsedHeader({ count, expanded, onToggle }: LapsedHeaderProps): ReactElement {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`Haven't watched lately, ${count}`}
      testID={TEST_IDS.lapsedDrawerToggle}
      onPress={onToggle}
      android_ripple={{ color: colors.separator }}
      style={styles.header}
    >
      <CueText
        variant="meta"
        weight="semibold"
        eyebrow
        style={[styles.label, { color: colors.muted }]}
      >
        Haven't watched lately
      </CueText>
      <Badge label={String(count)} />
      <View style={expanded && styles.expanded}>
        <PlatformIcon name="expand" color={colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    minHeight: ROW_MIN_HEIGHT.footer,
    paddingHorizontal: SPACE.s4,
    marginTop: SPACE.s2,
  },
  label: { flex: 1, minWidth: 0 },
  expanded: { transform: [{ rotate: "180deg" }] },
});
