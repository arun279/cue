import { parseHistorySearch } from "@cue/core/url/search-params";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HistoryChoice } from "../../src/screens/history/HistoryChoice";
import { MONTHS } from "../../src/screens/history/model";
import { Button } from "../../src/ui/Button";
import { TEST_IDS } from "../../src/ui/test-ids";
import { SPACE, useColors } from "../../src/ui/tokens";
import { CueText } from "../../src/ui/type";

export default function HistoryMonth(): ReactElement {
  const scope = parseHistorySearch(useLocalSearchParams());
  const [year, setYear] = useState(scope.year ?? new Date().getFullYear());
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i);
  if (scope.year !== undefined && !years.includes(scope.year)) years.push(scope.year);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pick = (pickedYear?: number, month?: number) =>
    router.dismissTo({
      pathname: "/(account)/history",
      params: {
        type: scope.type ?? "",
        year: pickedYear === undefined ? "" : String(pickedYear),
        month: month === undefined ? "" : String(month),
      },
    });
  return (
    <View
      testID={TEST_IDS.historyJumpSheet}
      style={[
        styles.sheet,
        { backgroundColor: colors.bg, paddingBottom: insets.bottom + SPACE.s2 },
      ]}
    >
      <CueText variant="sectionHeading" accessibilityRole="header" style={{ color: colors.fg }}>
        Jump to
      </CueText>
      <Button
        label="Recent"
        variant="link"
        testID={TEST_IDS.historyJumpRecent}
        onPress={() => pick()}
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
      <CueText variant="meta" eyebrow style={{ color: colors.muted }}>{`Month of ${year}`}</CueText>
      <Button
        label={`All of ${year}`}
        variant="link"
        testID={TEST_IDS.historyJumpAll}
        onPress={() => pick(year)}
      />
      <View style={styles.grid}>
        {MONTHS.map((label, i) => (
          <View key={label} style={styles.cell}>
            <HistoryChoice
              label={label}
              selected={scope.year === year && scope.month === i + 1}
              testID={TEST_IDS.historyJumpMonth(i + 1)}
              onPress={() => pick(year, i + 1)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: SPACE.s4, gap: SPACE.s2 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.s2 },
  cell: { width: `${100 / 6}%`, paddingHorizontal: SPACE.s1 },
});
