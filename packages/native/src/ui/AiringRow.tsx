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
  readonly chip: string | null;
  readonly line?: string | null;
  readonly spoken: string;
  readonly minHeight: number;
  readonly testID?: string;
}

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
