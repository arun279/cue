import type { AlertsCard as Card } from "@cue/core/hooks/useAlertsCard";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Button } from "../../ui/Button";
import { HAIRLINE, RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

const GLYPH = 22;

/** Makes the case for alerts before the OS asks, once, above the first day group. */
export function AlertsCard({ card }: { readonly card: Card }): ReactElement {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Svg width={GLYPH} height={GLYPH} viewBox="0 0 24 24">
          <Path
            d="M12 3.4a5.6 5.6 0 0 0-5.6 5.6v3.3l-1.4 2.8a.7.7 0 0 0 .63 1.01h12.74a.7.7 0 0 0 .63-1.01l-1.4-2.8V9A5.6 5.6 0 0 0 12 3.4ZM9.9 18.7a2.2 2.2 0 0 0 4.2 0"
            fill="none"
            stroke={colors.muted}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <CueText
          variant="rowTitle"
          weight="semibold"
          accessibilityRole="header"
          style={[styles.title, { color: colors.fg }]}
        >
          Alerts for new episodes
        </CueText>
      </View>
      <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
        An alert for each show you are watching when a new episode is out, scheduled on this phone.
        Cue plans four weeks ahead each time you open it.
      </CueText>
      <View style={styles.actions}>
        <Button label="Not now" variant="link" onPress={card.dismiss} />
        <Button label="Turn on alerts" onPress={() => void card.turnOn()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: SPACE.s2,
    marginTop: SPACE.s2,
    padding: SPACE.s4,
    borderRadius: RADIUS.card,
    borderWidth: HAIRLINE,
  },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
  title: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: SPACE.s2 },
});
