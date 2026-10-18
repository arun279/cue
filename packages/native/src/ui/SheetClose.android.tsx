import { Host, Icon, IconButton } from "@expo/ui/jetpack-compose";
import { testID } from "@expo/ui/jetpack-compose/modifiers";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { TEST_IDS } from "./test-ids";
import { useColors } from "./tokens";

export function SheetClose(): ReactElement {
  const router = useRouter();
  const colors = useColors();
  return (
    <Host matchContents>
      <IconButton onClick={() => router.back()} modifiers={[testID(TEST_IDS.sheetClose)]}>
        <Icon source={require("./close.xml")} tint={colors.ink2} contentDescription="Close" />
      </IconButton>
    </Host>
  );
}
