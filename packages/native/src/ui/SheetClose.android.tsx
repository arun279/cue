import { Host, Icon, IconButton } from "@expo/ui/jetpack-compose";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { useColors } from "./tokens";

export function SheetClose(): ReactElement {
  const router = useRouter();
  const colors = useColors();
  return (
    <Host matchContents>
      <IconButton onClick={() => router.back()}>
        <Icon source={require("./close.xml")} tint={colors.ink2} contentDescription="Close" />
      </IconButton>
    </Host>
  );
}
