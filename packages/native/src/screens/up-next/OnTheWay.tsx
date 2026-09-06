import type { CalendarRow } from "@cue/core/domain/calendar";
import { epCode } from "@cue/core/domain/model/library";
import type { OnTheWayDay } from "@cue/core/domain/on-the-way";
import { localTimeZone } from "@cue/core/domain/time";
import { useRouter } from "expo-router";
import { Fragment, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Badge } from "../../ui/Badge";
import { Poster } from "../../ui/Poster";
import { Row, Separator } from "../../ui/Row";
import { SectionHeader } from "../../ui/SectionHeader";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, ROW_MIN_HEIGHT, ROW_TEXT_INSET, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

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
          {day.rows.map((row, index) => (
            <Fragment key={row.ids.trakt}>
              {index === 0 ? null : <Separator inset={ROW_TEXT_INSET} />}
              <AiringRow row={row} offset={day.offset} />
            </Fragment>
          ))}
        </Fragment>
      ))}
    </View>
  );
}

function AiringRow({
  row,
  offset,
}: {
  readonly row: CalendarRow;
  readonly offset: number;
}): ReactElement {
  const router = useRouter();
  const colors = useColors();
  const code = epCode(row.season, row.number);
  const time = timeFmt.format(Date.parse(row.firstAired));
  // Today's rows say the hour; a later day says how far off it is, which is the
  // same grammar the calendar row uses.
  const when = offset > 0 ? `${offset}d` : time;

  return (
    <View style={styles.row}>
      <Row
        label={[row.showTitle, code, row.episodeTitle, time].filter(Boolean).join(", ")}
        minHeight={ROW_MIN_HEIGHT.onTheWay}
        onPress={() => router.push(`/show/${row.showId}`)}
        leading={
          <Poster title={row.showTitle} posters={row.posters} width={POSTER_WIDTH.onTheWay} />
        }
        trailing={<Badge label={when} />}
      >
        <CueText variant="rowTitleSecondary" style={{ color: colors.fg }}>
          {row.showTitle}
        </CueText>
        <CueText variant="meta" style={{ color: colors.ink2 }}>
          {code}
          {row.episodeTitle === null ? "" : ` · ${row.episodeTitle}`}
        </CueText>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACE.s4 },
  head: { paddingHorizontal: SPACE.s4 },
  dayHeader: { paddingHorizontal: SPACE.s4, paddingTop: SPACE.s2, paddingBottom: SPACE.s1 },
  row: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s2 },
});
