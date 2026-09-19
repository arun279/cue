import { artHue, initialsOf, resolvePoster } from "@cue/core/data/image-source";
import { type ReactElement, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { PALETTE, RADIUS } from "./tokens";
import { CueText } from "./type";

const POSTER_RATIO = 3 / 2;

/**
 * The monogram is artwork like the plate under it, so it is drawn from the
 * plate's own width rather than from the type scale: a plate is the same size
 * at every content size, and letters that grow when it cannot run off its
 * edges. A quarter of the width leaves the plate's edges clear on both axes at
 * the two letters `initialsOf` returns at most.
 */
export const MONOGRAM_SIZE = 0.25;
const MONOGRAM_LEADING = 1.25;

export interface PosterProps {
  readonly title: string;
  readonly posters?: readonly string[] | null;
  /** A step on the 2:3 scale from `POSTER_WIDTH`; the height follows. */
  readonly width: number;
}

/**
 * Artwork, which is not type: a poster is the same size at every content size.
 *
 * The designed no-artwork block is always the backing layer, so a title with no
 * Trakt poster reads as deliberately art-less rather than as a broken image, and
 * a URL that fails to load degrades back to it silently. The plate's tint is
 * derived from the title, so the same show is the same color in both apps.
 */
export function Poster({ title, posters, width }: PosterProps): ReactElement {
  const [broken, setBroken] = useState(false);
  const resolved = resolvePoster({ title, traktPosters: posters });
  const url = resolved.source === "placeholder" || broken ? null : resolved.url;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.poster,
        { width, height: width * POSTER_RATIO, backgroundColor: plate(title) },
      ]}
    >
      <CueText
        variant="caption"
        weight="bold"
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.initials,
          {
            fontSize: width * MONOGRAM_SIZE,
            lineHeight: width * MONOGRAM_SIZE * MONOGRAM_LEADING,
          },
        ]}
      >
        {initialsOf(title)}
      </CueText>
      {url === null ? null : (
        <Image
          key={url}
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          onError={() => setBroken(true)}
        />
      )}
    </View>
  );
}

/** Theme invariant, like every other on-image token: a plate is always dark and
 * always carries light ink. */
export function plate(seed: string): string {
  return `hsl(${artHue(seed)} 40% 20%)`;
}

const styles = StyleSheet.create({
  poster: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.poster,
    overflow: "hidden",
  },
  initials: { color: PALETTE.onImage2.dark },
});
