import { initialsOf } from "@cue/core/data/image-source";
import { userProfileQuery } from "@cue/core/queries/user";
import { useRuntime } from "@cue/core/runtime/runtime";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { MONOGRAM_LEADING, plate } from "./Poster";
import { TEST_IDS } from "./test-ids";
import { PALETTE, RADIUS, useColors } from "./tokens";
import { CueText } from "./type";

const INITIALS_SIZE = 0.4;
const GLYPH_SIZE = 0.6;

/**
 * The signed-in account's face: the Trakt photo over the same monogram plate a
 * poster without artwork draws, so an account with no photo, or one that fails
 * to load, reads as the person's initials. Before the profile has loaded there
 * is no name to draw, so the plate holds a person glyph.
 */
export function Avatar({ size }: { readonly size: number }): ReactElement {
  const profile = useQuery(userProfileQuery(useRuntime())).data;
  const [failed, setFailed] = useState<string | null>(null);
  const colors = useColors();
  const photo = profile?.avatar;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          backgroundColor: profile ? plate(profile.displayName) : colors.elevated,
        },
      ]}
    >
      {profile ? (
        <CueText
          variant="caption"
          weight="bold"
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            styles.initials,
            { fontSize: size * INITIALS_SIZE, lineHeight: size * INITIALS_SIZE * MONOGRAM_LEADING },
          ]}
        >
          {initialsOf(profile.displayName)}
        </CueText>
      ) : (
        <Svg width={size * GLYPH_SIZE} height={size * GLYPH_SIZE} viewBox="0 0 24 24">
          <Circle cx="12" cy="8" r="4" fill={colors.muted} />
          <Path d="M5 21a7 7 0 0 1 14 0" fill={colors.muted} />
        </Svg>
      )}
      {photo && photo !== failed ? (
        <Image
          key={photo}
          testID={TEST_IDS.avatarPhoto}
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(photo)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  initials: { color: PALETTE.onImage2.dark },
});
