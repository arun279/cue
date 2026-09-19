import { type ReactElement, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
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
  const { fontScale, height } = useWindowDimensions();
  const cell = { width: `${100 / (fontScale > 1.3 ? 3 : 6)}%` } as const;
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim }]}
        onPress={onClose}
      />
      <View
        testID={TEST_IDS.historyJumpSheet}
        accessibilityViewIsModal
        style={[styles.sheet, { backgroundColor: colors.overlay, maxHeight: height * 0.8 }]}
      >
        <View style={styles.head}>
          <CueText variant="sectionHeading" accessibilityRole="header" style={{ color: colors.fg }}>
            Jump to
          </CueText>
          <Button label="Close" variant="link" onPress={onClose} />
        </View>
        <ScrollView
          style={styles.body}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SPACE.s2 }]}
        >
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
              <View key={value} style={[styles.cell, cell]}>
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
              <View key={label} style={[styles.cell, cell]}>
                <HistoryChoice
                  label={label}
                  selected={scope.year === year && scope.month === i + 1}
                  testID={TEST_IDS.historyJumpMonth(i + 1)}
                  onPress={() => onPick(year, i + 1)}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { justifyContent: "flex-end" },
  sheet: {
    paddingHorizontal: SPACE.s4,
    paddingTop: SPACE.s4,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  body: { flexShrink: 1 },
  list: { gap: SPACE.s2 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.s2 },
  cell: { paddingHorizontal: SPACE.s1 },
});
