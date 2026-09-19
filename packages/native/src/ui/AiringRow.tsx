import type { CalendarRow } from "@cue/core/domain/calendar";
import { epCode } from "@cue/core/domain/model/library";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Badge } from "./Badge";
import { Poster } from "./Poster";
import { Row } from "./Row";
import { POSTER_WIDTH, useColors } from "./tokens";
import { CueText } from "./type";

export interface AiringRowProps {
  readonly row: CalendarRow;
  /** The countdown: a time today, `Nd` for a later day, nothing once aired. */
  readonly chip: string | null;
  /** The third line, where the screen draws one: the air time and the network. */
  readonly line?: string | null;
  /** What the row says about its air time, which the chip alone cannot carry. */
  readonly spoken: string;
  readonly minHeight: number;
  readonly testID?: string;
}

/**
 * One scheduled episode, shared by "On the way" and the Calendar so the two
 * scopes of the same read cannot drift apart on what a row is. It carries no
 * check: an episode that has not aired cannot be marked, and one that has is
 * already in the queue, which is the one home for that action.
 */
export function AiringRow({
  row,
  chip,
  line,
  spoken,
  minHeight,
  testID,
}: AiringRowProps): ReactElement {
  const router = useRouter();
  const colors = useColors();
  const code = epCode(row.season, row.number);

  return (
    <Row
      label={[row.showTitle, code, row.episodeTitle, spoken].filter(Boolean).join(", ")}
      minHeight={minHeight}
      onPress={() => router.push(`/show/${row.showId}`)}
      testID={testID}
      leading={<Poster title={row.showTitle} posters={row.posters} width={POSTER_WIDTH.onTheWay} />}
      trailing={chip === null ? undefined : <Badge label={chip} />}
    >
      <CueText variant="rowTitleSecondary" style={{ color: colors.fg }}>
        {row.showTitle}
      </CueText>
      <CueText variant="meta" style={{ color: colors.ink2 }}>
        {code}
        {row.episodeTitle === null ? "" : ` · ${row.episodeTitle}`}
      </CueText>
      {line == null ? null : (
        <CueText variant="caption" style={{ color: colors.muted }}>
          {line}
        </CueText>
      )}
    </Row>
  );
}
