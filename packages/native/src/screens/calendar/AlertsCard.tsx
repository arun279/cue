import type { AlertsCard as Card } from "@cue/core/hooks/useAlertsCard";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { PlatformIcon } from "../../ui/PlatformIcon";
import { HAIRLINE, RADIUS, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export const ALERTS_HINT =
  "Alerts for new episodes of shows you watch. Cue plans them four weeks ahead each time you open it.";

export function AlertsCard({ card }: { readonly card: Card }): ReactElement {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.head}>
        <PlatformIcon name="alerts" color={colors.muted} />
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
        {ALERTS_HINT}
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
