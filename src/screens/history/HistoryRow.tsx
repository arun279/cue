import { type Href, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import type { HistoryEntry } from "@/core/domain/history";
import { Badge } from "../../ui/Badge";
import { Poster } from "../../ui/Poster";
import { Row } from "../../ui/Row";
import { RowMenu, type RowMenuItem } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, SPACE, TITLE_LINES, useColors } from "../../ui/tokens";
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
  const href: Href =
    entry.type === "movie"
      ? `/movie/${entry.mediaId}`
      : `/show/${entry.mediaId}/episode/${entry.season ?? 0}/${entry.number ?? 0}`;
  const open = () => router.push(href);
  const items: RowMenuItem[] = [
    { id: "open", label: entry.type === "movie" ? "Go to movie" : "Go to episode", onPress: open },
    {
      id: "remove",
      label: "Remove this play",
      destructive: true,
      onPress: () => onRemove(entry),
    },
  ];
  const { fontScale } = useWindowDimensions();
  const time = new Date(entry.watchedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const label = `${entry.title}, ${entryDetail(entry)}, ${time}, ${plays} ${plays === 1 ? "play" : "plays"}`;
  return (
    <RowMenu
      title={entry.title}
      items={items}
      testID={TEST_IDS.historyMenu(index)}
      item={{ href, label, testID: TEST_IDS.historyRow(index) }}
    >
      {(trigger, rowTestID) => (
        <Row
          testID={rowTestID}
          label={label}
          minHeight={ROW_MIN_HEIGHT.history}
          onPress={open}
          actions={items}
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
            plays > 1 || trigger !== null ? (
              <>
                {plays > 1 ? (
                  <Badge label={`×${plays}`} testID={TEST_IDS.historyBadge(index)} />
                ) : null}
                {trigger}
              </>
            ) : undefined
          }
        >
          <CueText
            variant="rowTitleSecondary"
            numberOfLines={TITLE_LINES}
            style={{ color: colors.ink2 }}
          >
            <CueText variant="rowTitleSecondary" weight="semibold" style={{ color: colors.fg }}>
              {entry.title}
            </CueText>
            {` · ${entryDetail(entry)}`}
          </CueText>
        </Row>
      )}
    </RowMenu>
  );
}

const styles = StyleSheet.create({
  leading: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
});
