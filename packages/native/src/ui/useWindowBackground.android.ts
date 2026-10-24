import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { useColors } from "./tokens";

export function useWindowBackground(): void {
  const { bg } = useColors();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(bg);
  }, [bg]);
}
