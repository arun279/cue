import { jumpMonths, jumpRange, jumpYears } from "@cue/core/domain/history";
import { firstPlayQuery } from "@cue/core/queries/history";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import {
  type NativeStackNavigationProp,
  Stack,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { type ReactElement, useState } from "react";
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parseHistorySearch } from "../../route-params";
import { Button } from "../../ui/Button";
import { SheetClose } from "../../ui/SheetClose";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { HistoryChoice } from "./HistoryChoice";
import { MONTHS } from "./model";

const TITLE = "Jump to";

interface NavigatorTree {
  readonly key?: string;
  readonly index?: number;
  readonly routes: readonly { readonly key?: string; readonly state?: NavigatorTree }[];
}

const focusedScreen = (state: NavigatorTree): { source?: string; target?: string } => {
  const route = state.routes[state.index ?? 0];
  return route?.state ? focusedScreen(route.state) : { source: route?.key, target: state.key };
};

export function MonthJump(): ReactElement {
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const scope = parseHistorySearch(useLocalSearchParams());
  const firstPlay = useQuery(firstPlayQuery(useRuntime()));
  const range = jumpRange(firstPlay.data ?? null, Date.now());
  const [year, setYear] = useState(scope.year ?? range.last.year);
  const years = jumpYears(range);
  if (scope.year !== undefined && !years.includes(scope.year)) years.push(scope.year);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const cell = { width: `${100 / (fontScale > 1.3 ? 3 : 6)}%` } as const;
  const pick = (pickedYear?: number, month?: number) => {
    const state = navigation.getState();
    navigation.dispatch({
      type: "SET_PARAMS",
      payload: { params: { type: scope.type, year: pickedYear, month } },
      ...focusedScreen({ ...state, index: state.index - 1 }),
    });
    router.back();
  };
  return (
    <ScrollView
      testID={TEST_IDS.historyJumpSheet}
      contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + SPACE.s2 }]}
    >
      <Stack.Screen options={{ title: TITLE }} />
      {Platform.OS === "ios" ? (
        <SheetClose />
      ) : (
        <View style={styles.bar}>
          <CueText
            variant="sectionHeading"
            accessibilityRole="header"
            style={[styles.title, { color: colors.fg }]}
          >
            {TITLE}
          </CueText>
          <SheetClose />
        </View>
      )}
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
      <CueText variant="meta" eyebrow style={{ color: colors.muted }}>{`Month of ${year}`}</CueText>
      <Button
        label={`All of ${year}`}
        variant="link"
        testID={TEST_IDS.historyJumpAll}
        onPress={() => pick(year)}
      />
      <View style={styles.grid}>
        {jumpMonths(range, year).map((month) => (
          <View key={month} style={[styles.cell, cell]}>
            <HistoryChoice
              label={MONTHS[month - 1] ?? ""}
              selected={scope.year === year && scope.month === month}
              testID={TEST_IDS.historyJumpMonth(month)}
              onPress={() => pick(year, month)}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: SPACE.s2, paddingHorizontal: SPACE.s4, paddingTop: SPACE.s4 },
  bar: { flexDirection: "row", alignItems: "center", gap: SPACE.s2 },
  title: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.s2 },
  cell: { paddingHorizontal: SPACE.s1 },
});
