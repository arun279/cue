import { resolveBackdrop } from "@cue/core/data/image-source";
import { Image } from "expo-image";
import { type ReactElement, type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { Overview } from "./Overview";
import type { ShowHeader } from "./useShowDetail";

export function ShowHero({ header }: { readonly header: ShowHeader }): ReactElement {
  return (
    <DetailHero
      header={header}
      facts={[
        header.year,
        header.status,
        header.network,
        header.runtime === null ? null : `${header.runtime} min`,
      ]}
    >
      <Overview text={header.overview} />
    </DetailHero>
  );
}

export function DetailHero({
  header,
  facts,
  children,
}: {
  readonly header: { readonly title: string; readonly backdrops: readonly string[] };
  readonly facts: readonly (string | number | null)[];
  readonly children?: ReactNode;
}): ReactElement {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  const backdrop = resolveBackdrop(header.backdrops);
  return (
    <View>
      {backdrop !== null && !failed && (
        <Image
          source={backdrop}
          contentFit="cover"
          style={styles.backdrop}
          onError={() => setFailed(true)}
        />
      )}
      <View style={styles.body}>
        <CueText variant="detailTitle" accessibilityRole="header" style={{ color: colors.fg }}>
          {header.title}
        </CueText>
        <CueText variant="meta" style={{ color: colors.ink2 }}>
          {facts.filter(Boolean).join(" · ")}
        </CueText>
        {children}
      </View>
    </View>
  );
}

export function ShowAbout({ header }: { readonly header: ShowHeader }): ReactElement {
  const colors = useColors();
  return (
    <View style={styles.body}>
      <CueText variant="meta" accessibilityRole="header" style={{ color: colors.muted }}>
        About
      </CueText>
      {header.genres.length > 0 && (
        <CueText variant="meta" style={{ color: colors.ink2 }}>
          {header.genres.join(" · ")}
        </CueText>
      )}
      <CueText variant="meta" style={{ color: colors.muted }}>
        You've watched {header.completed} of {header.aired}
        {header.runtime === null
          ? ""
          : ` · ${Math.round((header.completed * header.runtime) / 60)} hr`}
      </CueText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { height: 214, width: "100%" },
  body: { padding: SPACE.s4, gap: SPACE.s2 },
});
