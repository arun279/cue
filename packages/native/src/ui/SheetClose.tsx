import { Button, Host } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  buttonBorderShape,
  buttonStyle,
  labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { TEST_IDS } from "./test-ids";

export function SheetClose(): ReactElement {
  const router = useRouter();
  return (
    <Host matchContents>
      <Button
        label="Close"
        systemImage="xmark"
        onPress={() => router.back()}
        modifiers={[
          labelStyle("iconOnly"),
          buttonStyle("glass"),
          buttonBorderShape("circle"),
          accessibilityIdentifier(TEST_IDS.sheetClose),
        ]}
      />
    </Host>
  );
}
