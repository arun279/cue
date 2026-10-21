import { parseHistorySearch } from "@cue/core/url/search-params";
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
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(scope.year ?? currentYear);
  const years = Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i);
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
        {MONTHS.map((label, i) => (
          <View key={label} style={[styles.cell, cell]}>
            <HistoryChoice
              label={label}
              selected={scope.year === year && scope.month === i + 1}
              testID={TEST_IDS.historyJumpMonth(i + 1)}
              onPress={() => pick(year, i + 1)}
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
