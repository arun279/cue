import { resolveBackdrop } from "@cue/core/data/image-source";
import { epCode } from "@cue/core/domain/model/library";
import { toMs } from "@cue/core/domain/time";
import { episodesLeft, watchedPercent } from "@cue/core/format";
import { useMarkControl } from "@cue/core/hooks/useMarkControl";
import type { MarkWatched } from "@cue/core/hooks/useMarkWatched";
import type { UpNextCard } from "@cue/core/hooks/useUpNext";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useShowArt } from "../../hooks/useShowArt";
import { CheckControl } from "../../ui/CheckControl";
import { Poster, plate } from "../../ui/Poster";
import { RowFooter } from "../../ui/RowFooter";
import { TEST_IDS } from "../../ui/test-ids";
import {
  CHECK_SIZE,
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

const AIRED_LAST_NIGHT_MS = 24 * 60 * 60 * 1000;

/** Two gradients, because one flat scrim over a backdrop is either too weak for
 * the text or too strong for the artwork: a bottom-up ramp for the text stack
 * and a leading-edge wash so the eyebrow has something to sit on. */
const SCRIM_DOWN = ["rgba(10,8,6,0)", "rgba(10,8,6,0.35)", "rgba(10,8,6,0.86)"] as const;
const SCRIM_ACROSS = ["rgba(10,8,6,0.4)", "rgba(10,8,6,0)"] as const;

export interface MarqueeCardProps {
  readonly card: UpNextCard;
  readonly mark: MarkWatched;
}

/**
 * The one card on the home screen: the head of the queue over its SHOW backdrop,
 * never the episode still, because stills are spoilers.
 *
 * It earns its place on the eyebrow. Nothing else on this screen says an episode
 * is new, and the queue row below carries poster, title, code, progress and
 * count without ever mentioning recency. It is also the largest target for the
 * app's most repeated action.
 *
 * Above the scrim threshold it stops being a scrim card and becomes a plain
 * surface with the poster inline, which is the shape it already renders for a
 * show with no backdrop: text over artwork is the composition that fails first
 * at the largest text sizes, so the card changes shape rather than clipping.
 */
export function MarqueeCard({ card, mark }: MarqueeCardProps): ReactElement {
  const { entry, item } = card;
  const router = useRouter();
  const colors = useColors();
  const control = useMarkControl(entry, mark);
  const art = useShowArt(entry.showId);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= REFLOW_FONT_SCALE;

  // Null above the threshold, which is what turns the card into its plain
  // surface composition: the same shape it draws for a show with no backdrop.
  const backdrop = fontScale < SCRIM_FONT_SCALE ? resolveBackdrop(art.backdrops) : null;
  const airedMs = toMs(item.episode.firstAired);
  const now = Date.now();
  const scrim = backdrop !== null;
  const code = epCode(item.episode.season, item.episode.number);
  const left = episodesLeft(entry.aired, entry.completed);
  const note = left > 0 ? `${left} left` : null;
  const eyebrow =
    airedMs !== null && airedMs <= now && now - airedMs <= AIRED_LAST_NIGHT_MS
      ? "Aired last night"
      : "Continue";
  const onImage = scrim ? PALETTE.onImage.dark : colors.fg;
  const onImageQuiet = scrim ? PALETTE.onImage2.dark : colors.ink2;

  return (
    <View
      testID={TEST_IDS.marqueeCard}
      style={[styles.card, { backgroundColor: scrim ? plate(entry.title) : colors.surface }]}
    >
      {scrim ? (
        <>
          <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} />
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
        accessibilityLabel={[eyebrow, entry.title, code, item.episode.title, note]
          .filter(Boolean)
          .join(", ")}
        onPress={() => router.push(`/show/${entry.showId}`)}
        style={styles.body}
      >
        {scrim ? null : (
          <Poster title={entry.title} posters={art.posters} width={POSTER_WIDTH.marquee} />
        )}
        <View style={styles.stack}>
          <CueText variant="micro" weight="bold" eyebrow style={{ color: colors.accent }}>
            {eyebrow}
          </CueText>
          <CueText variant="rowTitle" style={{ color: onImage }}>
            {entry.title}
          </CueText>
          <CueText variant="meta" style={{ color: onImageQuiet }}>
            {code}
            {item.episode.title === null ? "" : ` · ${item.episode.title}`}
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
  // minHeight and no height: above the threshold the card simply grows with its
  // text, like every row on the screen.
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    // The SPACE rule: the body and the check are separate targets.
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
    alignItems: "flex-end",
    gap: SPACE.s3,
    padding: SPACE.s3,
  },
  stack: { flex: 1, minWidth: 0, gap: 2 },
  // Centred beside a card the height of its artwork, and pulled to the top once
  // the text has grown the card past it, so the reach stays short either way.
  checkCentre: { alignSelf: "center", paddingRight: SPACE.s3 },
  checkTop: { alignSelf: "flex-start", paddingRight: SPACE.s3, paddingTop: SPACE.s3 },
});
