import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SPACE, useColors } from "../ui/tokens";

export default function NotFound(): ReactElement {
  const router = useRouter();
  const colors = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ title: "Not found" }} />
      <EmptyState centered headline="That link doesn't go anywhere in Cue.">
        <Button label="Go to Up Next" onPress={() => router.navigate("/")} />
      </EmptyState>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, paddingHorizontal: SPACE.s4 } });
