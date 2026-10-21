import { Stack, useRouter } from "expo-router";
import type { ReactElement } from "react";

export function SheetClose(): ReactElement {
  const router = useRouter();
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
    </Stack.Toolbar>
  );
}
