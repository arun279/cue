import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { type CalendarRow, episodeLine } from "@/core/domain/calendar";
import { Badge } from "./Badge";
import { Poster } from "./Poster";
import { Row } from "./Row";
import { POSTER_WIDTH, TITLE_LINES, useColors } from "./tokens";
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
  const episode = episodeLine(row);

  return (
    <Row
      label={[row.showTitle, episode.spoken, episode.detail, spoken].filter(Boolean).join(", ")}
      minHeight={minHeight}
      onPress={() => router.push(`/show/${row.showId}`)}
      testID={testID}
      leading={<Poster title={row.showTitle} posters={row.posters} width={POSTER_WIDTH.onTheWay} />}
      trailing={chip === null ? undefined : <Badge label={chip} />}
    >
      <CueText variant="rowTitleSecondary" numberOfLines={TITLE_LINES} style={{ color: colors.fg }}>
        {row.showTitle}
      </CueText>
      <CueText variant="meta" style={{ color: colors.ink2 }}>
        {episode.code}
        {episode.detail === null ? "" : ` · ${episode.detail}`}
      </CueText>
      {line == null ? null : (
        <CueText variant="caption" style={{ color: colors.muted }}>
          {line}
        </CueText>
      )}
    </Row>
  );
}
