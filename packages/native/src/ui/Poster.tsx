import { artHue, initialsOf, resolvePoster } from "@cue/core/data/image-source";
import { type ReactElement, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { PALETTE, RADIUS } from "./tokens";
import { CueText } from "./type";

const POSTER_RATIO = 3 / 2;

export const MONOGRAM_SIZE = 0.25;
export const MONOGRAM_LEADING = 1.25;

export interface PosterProps {
  readonly title: string;
  readonly posters?: readonly string[] | null;
  readonly width: number;
}

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
