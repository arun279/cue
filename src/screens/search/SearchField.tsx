import type { ReactElement } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { PlatformIcon } from "../../ui/PlatformIcon";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { roleStyle } from "../../ui/type";

const BAR_HEIGHT = 56;

export interface SearchFieldProps {
  readonly value: string;
  readonly placeholder: string;
  onChangeText(text: string): void;
}

export function SearchField({ value, placeholder, onChangeText }: SearchFieldProps): ReactElement {
  const colors = useColors();
  return (
    <View style={[styles.bar, { backgroundColor: colors.elevated }]}>
      <PlatformIcon name="search" color={colors.ink2} />
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
        style={[roleStyle("rowTitle", "regular"), styles.input, { color: colors.fg }]}
      />
      {value.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          android_ripple={{ borderless: true, radius: TARGET_MIN / 2 }}
          style={styles.clear}
        >
          <PlatformIcon name="close" color={colors.ink2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    paddingLeft: SPACE.s4,
    marginHorizontal: SPACE.s4,
    marginVertical: SPACE.s2,
    gap: SPACE.s4,
  },
  input: { flex: 1, height: BAR_HEIGHT },
  clear: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACE.s1,
  },
});
