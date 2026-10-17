import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { MonthJump } from "../../src/screens/history/MonthJump";
import { SheetPresented } from "../../src/ui/harness";

export default function MonthJumpRoute(): ReactElement {
  return (
    <View style={styles.route}>
      <MonthJump />
      <SheetPresented />
    </View>
  );
}

const styles = StyleSheet.create({ route: { flex: 1 } });
