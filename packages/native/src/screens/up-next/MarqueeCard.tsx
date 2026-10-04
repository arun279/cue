import { resolveBackdrop } from "@cue/core/data/image-source";
import { type EpisodeRef, epCode } from "@cue/core/domain/model/library";
import { toMs } from "@cue/core/domain/time";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { CheckControl } from "../../ui/CheckControl";
import { Poster, plate } from "../../ui/Poster";
import { RowFooter } from "../../ui/RowFooter";
import { TEST_IDS } from "../../ui/test-ids";
import {
  CHECK_SIZE,
  HAIRLINE,
  PALETTE,
  POSTER_WIDTH,
  RADIUS,
  RAIL,
  REFLOW_FONT_SCALE,
  ROW_MIN_HEIGHT,
  SCRIM_FONT_SCALE,
  SPACE,
  useColors,
} from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { UpNextCard } from "./model";

const AIRED_LAST_NIGHT_MS = 24 * 60 * 60 * 1000;

const SCRIM_DOWN = ["rgba(10,8,6,0)", "rgba(10,8,6,0.35)", "rgba(10,8,6,0.86)"] as const;
const SCRIM_ACROSS = ["rgba(10,8,6,0.4)", "rgba(10,8,6,0)"] as const;

export interface MarqueeCardProps {
  readonly card: UpNextCard;
  readonly episode: EpisodeRef;
  readonly mark: MarkWatched;
}

export function MarqueeCard({ card, episode, mark }: MarqueeCardProps): ReactElement {
  const { entry } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const art = useShowArt(entry.showId);
  const [failedBackdrop, setFailedBackdrop] = useState<string | null>(null);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= REFLOW_FONT_SCALE;

  const backdrop = fontScale < SCRIM_FONT_SCALE ? resolveBackdrop(art.backdrops) : null;
  const airedMs = toMs(episode.firstAired);
  const now = Date.now();
  const scrim = backdrop !== null && backdrop !== failedBackdrop;
  const code = epCode(episode.season, episode.number);
  const left = episodesLeft(entry.aired, entry.completed);
  const note = left > 0 ? `${left} left` : null;
  const eyebrow =
    airedMs !== null && airedMs <= now && now - airedMs <= AIRED_LAST_NIGHT_MS
      ? "Aired last night"
      : "Continue";
  const onImage = scrim ? PALETTE.onImage.dark : colors.fg;
  const onImageQuiet = scrim ? PALETTE.onImage2.dark : colors.ink2;
  const eyebrowInk = scrim ? PALETTE.onImage2.dark : colors.accentInk;

  return (
    <View
      testID={TEST_IDS.marqueeCard}
      style={[
        styles.card,
        scrim
          ? { backgroundColor: plate(entry.title), borderWidth: 0 }
          : {
              backgroundColor: colors.surface,
              borderWidth: HAIRLINE,
              borderColor: colors.border,
            },
      ]}
    >
      {scrim ? (
        <>
          <Image
            testID={TEST_IDS.marqueeBackdrop}
            source={{ uri: backdrop }}
            onError={() => setFailedBackdrop(backdrop)}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={SCRIM_ACROSS}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.4, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={SCRIM_DOWN}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : null}
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={[eyebrow, entry.title, code, episode.title, note]
          .filter(Boolean)
          .join(", ")}
        onPress={() => router.push(`/show/${entry.showId}`)}
        style={[styles.body, scrim ? styles.bodyBottom : styles.bodyTop]}
      >
        {scrim ? null : (
          <Poster title={entry.title} posters={art.posters} width={POSTER_WIDTH.marquee} />
        )}
        <View style={styles.stack}>
          <CueText variant="micro" weight="bold" eyebrow style={{ color: eyebrowInk }}>
            {eyebrow}
          </CueText>
          <CueText variant="rowTitle" style={{ color: onImage }}>
            {entry.title}
          </CueText>
          <CueText variant="meta" style={{ color: onImageQuiet }}>
            {code}
            {episode.title === null ? "" : ` · ${episode.title}`}
          </CueText>
          <RowFooter
            percent={watchedPercent(entry.completed, entry.aired)}
            note={note}
            rail={RAIL.marquee}
            color={onImage}
          />
        </View>
      </Pressable>
      <View style={stacked ? styles.checkTop : styles.checkCentre}>
        <CheckControl
          checked={control.state !== "unwatched"}
          disabled={control.state === "advancing"}
          pending={control.pending}
          onImage={scrim}
          label={control.label}
          size={CHECK_SIZE.marquee}
          onPress={control.onPress}
          testID={TEST_IDS.marqueeMark}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: SPACE.s2,
    minHeight: ROW_MIN_HEIGHT.marquee,
    marginBottom: SPACE.s3,
    borderRadius: RADIUS.card,
    overflow: "hidden",
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: SPACE.s3,
    padding: SPACE.s3,
  },
  bodyBottom: { alignItems: "flex-end" },
  bodyTop: { alignItems: "flex-start" },
  stack: { flex: 1, minWidth: 0, gap: 2 },
  checkCentre: { alignSelf: "center", paddingRight: SPACE.s3 },
  checkTop: { alignSelf: "flex-start", paddingRight: SPACE.s3, paddingTop: SPACE.s3 },
});
