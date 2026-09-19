import type { HistoryEntry } from "@cue/core/domain/history";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Badge } from "../../ui/Badge";
import { CheckControl } from "../../ui/CheckControl";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { RowMenu } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { entryDetail, type HistoryRowModel } from "./model";

export function HistoryRow({
  entry,
  plays,
  index,
  onRemove,
}: HistoryRowModel & {
  readonly index: number;
  onRemove(entry: HistoryEntry): void;
}): ReactElement {
  const colors = useColors();
  const router = useRouter();
  const open = () =>
    router.push(
      entry.type === "movie"
        ? `/(account)/movie/${entry.mediaId}`
        : `/(account)/show/${entry.mediaId}/episode/${entry.season ?? 0}/${entry.number ?? 0}`,
    );
  const remove = () => onRemove(entry);
  const items = [
    { id: "open", label: entry.type === "movie" ? "Go to movie" : "Go to episode", onPress: open },
    { id: "remove", label: "Remove this play", destructive: true, onPress: remove },
  ];
  const { fontScale } = useWindowDimensions();
  const time = new Date(entry.watchedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <RowMenu title={entry.title} items={items}>
      <Row
        testID={TEST_IDS.historyRow(index)}
        label={`${entry.title}, ${entryDetail(entry)}, ${time}, ${plays} ${plays === 1 ? "play" : "plays"}`}
        minHeight={ROW_MIN_HEIGHT.history}
        onPress={open}
        leading={
          <View style={styles.leading}>
            <CueText
              variant="caption"
              tabularNums
              style={[{ width: 62 * fontScale }, { color: colors.muted }]}
            >
              {time}
            </CueText>
            <Poster title={entry.title} posters={entry.posters} width={SPACE.s6} />
          </View>
        }
        trailing={
          <>
            {plays > 1 ? <Badge label={`×${plays}`} /> : null}
            <CheckControl
              checked
              size={TARGET_MIN}
              label={`Remove ${entry.title} ${entryDetail(entry)} play`}
              onPress={remove}
              testID={TEST_IDS.historyCheck(index)}
            />
            <RowMenu title={entry.title} items={items} testID={TEST_IDS.historyMenu(index)} />
          </>
        }
      >
        <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
          <CueText variant="rowTitleSecondary" weight="semibold" style={{ color: colors.fg }}>
            {entry.title}
          </CueText>
          {` · ${entryDetail(entry)}`}
        </CueText>
      </Row>
    </RowMenu>
  );
}

const styles = StyleSheet.create({
  leading: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
});
