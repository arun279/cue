import { type ReactElement, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../ui/Button";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { HistoryChoice } from "./HistoryChoice";
import { MONTHS } from "./model";

export function MonthJump({
  scope,
  onPick,
  onClose,
}: {
  readonly scope: { readonly year?: number; readonly month?: number };
  onPick(year?: number, month?: number): void;
  onClose(): void;
}): ReactElement {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(scope.year ?? currentYear);
  const years = Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i);
  if (scope.year !== undefined && !years.includes(scope.year)) years.push(scope.year);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim }]}
        onPress={onClose}
      />
      <View
        testID={TEST_IDS.historyJumpSheet}
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { backgroundColor: colors.bg, paddingBottom: insets.bottom + SPACE.s2 },
        ]}
      >
        <View style={styles.head}>
          <CueText variant="sectionHeading" accessibilityRole="header" style={{ color: colors.fg }}>
            Jump to
          </CueText>
          <Button label="Close" variant="link" onPress={onClose} />
        </View>
        <Button
          label="Recent"
          variant="link"
          testID={TEST_IDS.historyJumpRecent}
          onPress={() => onPick()}
        />
        <CueText variant="meta" eyebrow style={{ color: colors.muted }}>
          Year
        </CueText>
        <View style={styles.grid}>
          {years.map((value) => (
            <View key={value} style={styles.cell}>
              <HistoryChoice
                label={String(value)}
                selected={value === year}
                testID={TEST_IDS.historyJumpYear(value)}
                onPress={() => setYear(value)}
              />
            </View>
          ))}
        </View>
        <CueText
          variant="meta"
          eyebrow
          style={{ color: colors.muted }}
        >{`Month of ${year}`}</CueText>
        <Button
          label={`All of ${year}`}
          variant="link"
          testID={TEST_IDS.historyJumpAll}
          onPress={() => onPick(year)}
        />
        <View style={styles.grid}>
          {MONTHS.map((label, i) => (
            <View key={label} style={styles.cell}>
              <HistoryChoice
                label={label}
                selected={scope.year === year && scope.month === i + 1}
                testID={TEST_IDS.historyJumpMonth(i + 1)}
                onPress={() => onPick(year, i + 1)}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { justifyContent: "flex-end" },
  sheet: {
    padding: SPACE.s4,
    gap: SPACE.s2,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.s2 },
  cell: { width: `${100 / 6}%`, paddingHorizontal: SPACE.s1 },
});
