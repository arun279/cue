import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { initialsOf } from "@/core/domain/image-source";
import { userProfileQuery } from "@/core/queries/user";
import { useRuntime } from "@/core/runtime/runtime";
import { PlatformIcon } from "./PlatformIcon";
import { MONOGRAM_LEADING, plate } from "./Poster";
import { TEST_IDS } from "./test-ids";
import { PALETTE, RADIUS, useColors } from "./tokens";
import { CueText } from "./type";

const INITIALS_SIZE = 0.4;
const GLYPH_SIZE = 0.6;

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
        <PlatformIcon name="person" color={colors.muted} size={size * GLYPH_SIZE} />
      )}
      {photo && photo !== failed ? (
        <Image
          key={photo}
          testID={TEST_IDS.avatarPhoto}
          source={{ uri: photo }}
          resizeMethod="resize"
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
