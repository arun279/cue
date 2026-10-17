import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { type ReactElement, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge } from "../../ui/Badge";
import { Chevron } from "../../ui/Chevron";
import { Separator } from "../../ui/Row";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_TEXT_INSET, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { UpNextCard } from "./model";
import { QueueRow } from "./QueueRow";

const TRIGGER_HEIGHT = 52;

export interface LapsedDrawerProps {
  readonly cards: readonly UpNextCard[];
  readonly mark: MarkWatched;
  onStop(card: UpNextCard): void;
}

export function LapsedDrawer({ cards, mark, onStop }: LapsedDrawerProps): ReactElement | null {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

  if (cards.length === 0) return null;

  return (
    <View style={styles.drawer}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Haven't watched lately, ${cards.length}`}
        testID={TEST_IDS.lapsedDrawerToggle}
        onPress={() => setExpanded((open) => !open)}
        style={styles.trigger}
      >
        <CueText variant="rowTitle" style={[styles.label, { color: colors.fg }]}>
          Haven't watched lately
        </CueText>
        <Badge label={String(cards.length)} />
        <Chevron direction={expanded ? "up" : "down"} />
      </Pressable>
      {expanded
        ? cards.map((card, index) => (
            <View key={card.entry.showId}>
              {index === 0 ? null : <Separator inset={ROW_TEXT_INSET} />}
              <QueueRow card={card} mark={mark} variant="lapsed" onStop={() => onStop(card)} />
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: { paddingTop: SPACE.s2 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.s2,
    minHeight: TRIGGER_HEIGHT,
    paddingHorizontal: SPACE.s4,
  },
  label: { flex: 1, minWidth: 0 },
});
