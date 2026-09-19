import { airingGrammar } from "@cue/core/domain/calendar";
import type { OnTheWayDay } from "@cue/core/domain/on-the-way";
import { useRouter } from "expo-router";
import { Fragment, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { AiringRow } from "../../ui/AiringRow";
import { Separator } from "../../ui/Row";
import { SectionHeader } from "../../ui/SectionHeader";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, ROW_TEXT_INSET, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export interface OnTheWayProps {
  readonly days: readonly OnTheWayDay[];
}

/**
 * "On the way": the next 72 hours of scheduled episodes, three rows at most,
 * with no checks because there is nothing to mark yet.
 *
 * It is the same data as the Calendar tab at a different scope, which is summary
 * and detail rather than a second home for an action, and the "Calendar" link in
 * its header is the disclosure to the full 28 days. Omitted entirely when empty.
 */
export function OnTheWay({ days }: OnTheWayProps): ReactElement | null {
  const router = useRouter();
  const colors = useColors();

  if (days.length === 0) return null;

  return (
    <View testID={TEST_IDS.onTheWayList} style={styles.section}>
      <View style={styles.head}>
        <SectionHeader
          label="On the way"
          action={{ label: "Calendar", onPress: () => router.push("/calendar") }}
        />
      </View>
      {days.map((day) => (
        <Fragment key={day.key}>
          <CueText
            variant="meta"
            weight="semibold"
            eyebrow
            accessibilityRole="header"
            style={[styles.dayHeader, { color: colors.muted }]}
          >
            {day.label}
          </CueText>
          {day.rows.map((row, index) => {
            // A summary draws the countdown and leaves the calendar's third
            // line to the calendar.
            const { chip, spoken } = airingGrammar(row, day.offset);
            return (
              <Fragment key={row.ids.trakt}>
                {index === 0 ? null : <Separator inset={ROW_TEXT_INSET} />}
                <View style={styles.row}>
                  <AiringRow
                    row={row}
                    chip={chip}
                    spoken={spoken}
                    minHeight={ROW_MIN_HEIGHT.onTheWay}
                  />
                </View>
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACE.s4 },
  head: { paddingHorizontal: SPACE.s4 },
  dayHeader: { paddingHorizontal: SPACE.s4, paddingTop: SPACE.s2, paddingBottom: SPACE.s1 },
  row: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
});
