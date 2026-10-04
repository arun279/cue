import { useHaptics } from "@cue/core/ports/haptics";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { Chip, ChipKey } from "./model";

const CHIP_HEIGHT = 34;
const CHIP_SLOP = { top: 5, bottom: 5, left: 0, right: 0 };

export interface ChipRailProps {
  readonly chips: readonly Chip[];
  readonly selected: ChipKey;
  onSelect(key: ChipKey): void;
}

export function ChipRail({ chips, selected, onSelect }: ChipRailProps): ReactElement {
  const colors = useColors();
  const haptics = useHaptics();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {chips.map((chip) => {
        const on = chip.key === selected;
        return (
          <Pressable
            key={chip.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${chip.label}, ${chip.count}`}
            testID={chip.testID}
            hitSlop={CHIP_SLOP}
            onPress={() => {
              haptics.selection();
              onSelect(chip.key);
            }}
            style={[
              styles.chip,
              {
                backgroundColor: on ? colors.accent : colors.elevated,
                borderColor: on ? colors.accentFillStroke : colors.border,
              },
            ]}
          >
            <CueText
              variant="rowTitleSecondary"
              style={{ color: on ? colors.accentFg : colors.fg }}
            >
              {chip.label}
            </CueText>
            <CueText
              variant="micro"
              tabularNums
              style={{ color: on ? colors.accentFg : colors.muted }}
            >
              {chip.count}
            </CueText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: "row", gap: SPACE.s2, paddingHorizontal: SPACE.s4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: SPACE.s3,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
  },
});
