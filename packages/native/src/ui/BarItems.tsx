import { Stack, useRouter } from "expo-router";
import { memo, type ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Avatar } from "./Avatar";
import { TEST_IDS } from "./test-ids";
import { TARGET_MIN } from "./tokens";

const AVATAR = 32;

export const BarItems = memo(function BarItems(): ReactElement {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.View>
        <AvatarLink />
      </Stack.Toolbar.View>
    </Stack.Toolbar>
  );
});

function AvatarLink(): ReactElement {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      testID={TEST_IDS.avatarLink}
      onPress={() => router.push("/profile")}
      style={styles.target}
    >
      <Avatar size={AVATAR} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
