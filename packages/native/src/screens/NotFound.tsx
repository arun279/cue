import { Stack } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { enterFromOutside } from "../enter-from-outside";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SPACE } from "../ui/tokens";

export default function NotFound(): ReactElement {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Not found" }} />
      <EmptyState centered headline="That link doesn't go anywhere in Cue.">
        <Button label="Go to Up Next" onPress={() => void enterFromOutside("/")} />
      </EmptyState>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1, paddingHorizontal: SPACE.s4 } });
