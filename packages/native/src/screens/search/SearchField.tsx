import type { ReactElement } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { GLYPH, Glyph } from "../../ui/Glyph";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../../ui/tokens";

/** Material 3's search bar: 56 dp tall, a 28 dp corner, and a 24 dp leading icon. */
const HEIGHT = 56;
const ICON = 24;

export interface SearchFieldProps {
  readonly value: string;
  readonly placeholder: string;
  onChangeText(text: string): void;
}

/**
 * Android's search, owned by the screen and always on it rather than behind a
 * header action: the Material 3 search bar on the surface container, which is
 * what Search is on Android when searching is the point of the page.
 */
export function SearchField({ value, placeholder, onChangeText }: SearchFieldProps): ReactElement {
  const colors = useColors();
  return (
    <View style={[styles.bar, { backgroundColor: colors.elevated }]}>
      <Glyph path={GLYPH.search} color={colors.ink2} size={ICON} />
      <TextInput
        testID={TEST_IDS.searchField}
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        cursorColor={colors.accentInk}
        style={[styles.input, { color: colors.fg }]}
      />
      {value.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          style={styles.clear}
        >
          <Glyph path={GLYPH.close} color={colors.ink2} size={ICON} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    paddingLeft: SPACE.s4,
    marginHorizontal: SPACE.s4,
    marginVertical: SPACE.s2,
    gap: SPACE.s4,
  },
  input: { flex: 1, height: HEIGHT, fontSize: 16, fontFamily: "Inter_400Regular" },
  clear: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACE.s1,
  },
});
